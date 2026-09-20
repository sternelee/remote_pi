import { createConnection, type Socket } from "node:net";
import { getSupervisorUiSockPath } from "./supervisor.js";

/**
 * Plan/58 primitive B — extension-side bridge for `ctx.ui.*` forwarding.
 *
 * The daemon runs Pi as a non-interactive RPC child (`pi --mode rpc`). In that
 * mode every `ctx.ui.select/confirm/input/editor/notify/setStatus/setWidget/
 * setTitle/set_editor_text` call is emitted by Pi as an
 * `extension_ui_request` JSON line on the child's stdout. The supervisor's
 * `RpcChild` parses those and pushes them down the persistent UI socket; this
 * class is the child-side endpoint that receives them, surfaces them to the
 * extension runtime (which forwards them to the paired app over the relay),
 * and writes the app's answer back to the supervisor as a `ui_response`.
 *
 * Lifecycle is defensive by design: the socket may not exist yet (the daemon
 * child can boot before/while the supervisor binds), so every failure is
 * swallowed and a reconnect is scheduled with backoff until `close()` is
 * called explicitly.
 */

/** A frame as parsed by `parseUiRequestLine` (see `rpc_child.ts`). */
export type UiFrame = { type: "extension_ui_request"; id: string } & Record<string, unknown>;

export interface UiResponse {
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/** Opens a connection to `path`. Injectable so tests can supply a stub. */
export type UiConnector = (path: string) => Socket;

export interface SupervisorUiBridgeOptions {
  /** Override the UI socket path (defaults to `getSupervisorUiSockPath()`). */
  sockPath?: string;
  /** Override the socket factory (defaults to `net.createConnection`). */
  connector?: UiConnector;
  /** First reconnect delay; doubles up to `reconnectMaxMs`. Default 500ms. */
  reconnectBaseMs?: number;
  /** Reconnect delay cap. Default 5000ms. */
  reconnectMaxMs?: number;
}

export class SupervisorUiBridge {
  private sock: Socket | null = null;
  private daemonId: string | null = null;
  private cwd: string | undefined;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private buf = "";
  private readonly frameHandlers = new Set<(frame: UiFrame) => void>();
  private readonly sockPath: string;
  private readonly connector: UiConnector;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  constructor(opts: SupervisorUiBridgeOptions = {}) {
    this.sockPath = opts.sockPath ?? getSupervisorUiSockPath();
    this.connector = opts.connector ?? ((path) => createConnection({ path }));
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 5_000;
  }

  /** Open the connection and announce this daemon's identity. Safe to call
   *  when the supervisor isn't up yet — the bridge reconnects in the
   *  background. Calling it again re-targets the bridge (new daemon id). */
  connect(daemonId: string, cwd?: string): void {
    this.closed = false;
    this.daemonId = daemonId;
    this.cwd = cwd;
    this.reconnectAttempt = 0;
    this._open();
  }

  /** Register a handler for inbound `extension_ui_request` frames. */
  onFrame(cb: (frame: UiFrame) => void): void {
    this.frameHandlers.add(cb);
  }

  /** Answer an interactive frame. Never throws when the socket is gone. */
  respond(rpcId: string, response: UiResponse): void {
    const payload: Record<string, unknown> = { op: "ui_response", id: rpcId };
    if (typeof response.value === "string") payload["value"] = response.value;
    if (typeof response.confirmed === "boolean") payload["confirmed"] = response.confirmed;
    if (response.cancelled === true) payload["cancelled"] = true;
    this._write(payload);
  }

  /** Stop reconnecting and drop the connection. Idempotent. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const sock = this.sock;
    this.sock = null;
    this.buf = "";
    if (sock) {
      try { sock.destroy(); } catch { /* already gone */ }
    }
  }

  /** Test-only: true while a socket object is held (not necessarily connected). */
  _hasSocketForTest(): boolean {
    return this.sock !== null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private _open(): void {
    if (this.closed || this.daemonId === null || this.sock !== null) return;
    let sock: Socket;
    try {
      sock = this.connector(this.sockPath);
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      this.reconnectAttempt = 0;
      const hello: Record<string, unknown> = { op: "ui_hello", daemon_id: this.daemonId };
      if (this.cwd !== undefined) hello["cwd"] = this.cwd;
      this._write(hello);
    });
    sock.on("data", (chunk: string) => this._onData(chunk));
    sock.on("error", () => this._onDisconnect(sock));
    sock.on("close", () => this._onDisconnect(sock));
  }

  private _onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      this._handleLine(line);
    }
  }

  private _handleLine(line: string): void {
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { return; }
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, unknown>;
    if (o["op"] !== "ui_request") return;
    const frame = o["frame"];
    if (!isUiFrame(frame)) return;
    for (const cb of this.frameHandlers) {
      try { cb(frame); } catch { /* one bad handler must not kill the bridge */ }
    }
  }

  private _onDisconnect(sock: Socket): void {
    if (this.sock !== sock) return;
    this.sock = null;
    this.buf = "";
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxMs,
    );
    this.reconnectAttempt += 1;
    const timer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, delay);
    // Don't keep the child process alive solely for a reconnect attempt.
    if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
    this.reconnectTimer = timer;
  }

  private _write(payload: Record<string, unknown>): void {
    const sock = this.sock;
    if (!sock) return;
    try {
      sock.write(JSON.stringify(payload) + "\n");
    } catch { /* client gone; a reconnect will resync */ }
  }
}

function isUiFrame(value: unknown): value is UiFrame {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return o["type"] === "extension_ui_request" && typeof o["id"] === "string";
}
