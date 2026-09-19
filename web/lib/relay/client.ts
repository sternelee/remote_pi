/**
 * Relay WebSocket client (app peer side).
 *
 * Mirrors `app/lib/data/transport/ws_transport.dart`:
 *   1. open WS
 *   2. `hello` (pubkey + room_id "main") → `challenge` → `auth` (Ed25519 sig)
 *   3. after auth, two inbound streams:
 *        - `{peer, room?, ct}` outer envelopes → decoded inner messages
 *        - control frames (top-level `type`, no `peer`) → relay control
 *
 * Browser-specific liveness note
 * ------------------------------
 * The relay sends a WS Ping every 25s, but browsers do not expose control
 * frames to JavaScript — the socket answers the ping itself and JS never sees
 * it. So a "nothing arrived for N seconds" watchdog (what the Node extension
 * uses) would fire on a perfectly healthy idle connection.
 *
 * Instead, liveness is measured with the protocol's own `ping`/`pong`:
 *   - after `IDLE_PING_MS` without inbound traffic, send an inner `ping`
 *   - if no frame at all arrives for `DEAD_MS`, force-close so reconnect runs
 * The second rule is what catches a half-open socket (NAT drop, laptop sleep,
 * dead relay) that never fires `close`.
 */

import { signWithIdentity, type StoredIdentity } from "../crypto/ed25519";
import {
  b64Decode,
  b64Encode,
  decodeInner,
  encodeInner,
  encodeOuter,
  isOuterEnvelope,
} from "../protocol/codec";
import { uuid7 } from "../protocol/uuid7";
import type { ClientMessage, ControlInbound, ControlOutbound, ServerMessage } from "../protocol/types";
import { toWsRelayUrl } from "../pairing/qr";

/** Relay closes the socket if auth does not complete in time. */
const AUTH_TIMEOUT_MS = 5_000;
/** Idle before we probe the Pi with a protocol-level ping. */
const IDLE_PING_MS = 25_000;
/** No observable inbound frame for this long ⇒ the socket is dead. */
const DEAD_MS = 90_000;
/** Watchdog granularity. */
const WATCHDOG_TICK_MS = 5_000;

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export type RelayStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "online"
  | "reconnecting"
  | "closed";

export interface RelayHandlers {
  onStatus: (status: RelayStatus, detail?: string) => void;
  onMessage: (message: ServerMessage) => void;
  onControl: (frame: ControlInbound) => void;
  /** Non-fatal protocol problem worth showing (malformed frame, etc). */
  onNotice?: (message: string) => void;
}

export interface RelayClientOptions {
  relayUrl: string;
  identity: StoredIdentity;
  handlers: RelayHandlers;
  /** Room on the Pi side this client addresses. Defaults to `"main"`. */
  activeRoom?: string;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly relayUrl: string;
  private readonly identity: StoredIdentity;
  private readonly handlers: RelayHandlers;

  private activeRoom: string;
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;

  private lastInboundAt = 0;
  private lastPingAt = 0;
  private pendingPingId: string | null = null;
  private onlineWaiters: (() => void)[] = [];
  /**
   * True once the `auth` frame has gone out. Deliberately not derived from
   * `readyState`: an open socket is still pre-auth, and anything sent then is
   * dropped by the relay.
   */
  private authSent = false;

  constructor(options: RelayClientOptions) {
    this.relayUrl = options.relayUrl;
    this.identity = options.identity;
    this.handlers = options.handlers;
    this.activeRoom = options.activeRoom ?? "main";
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Connect and keep the connection alive, reconnecting on failure. */
  start(): void {
    this.closedByUser = false;
    void this.connectOnce();
  }

  /** Permanently stop. Cancels any pending reconnect. */
  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
    this.handlers.onStatus("closed");
  }

  /** Drop the current socket and retry immediately, resetting the backoff. */
  retryNow(): void {
    if (this.closedByUser) return;
    this.attempt = 0;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    void this.connectOnce();
  }

  /**
   * Resolves the first time the socket reaches `online` (auth sent).
   *
   * Callers must await this before their first `send()`: a freshly constructed
   * socket is CONNECTING, and `send()` on it is refused, so anything sent
   * straight after `start()` would be silently dropped.
   */
  whenOnline(timeoutMs = 10_000): Promise<void> {
    if (this.online) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onlineWaiters = this.onlineWaiters.filter((w) => w !== waiter);
        reject(new Error("relay did not come online in time"));
      }, timeoutMs);
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.onlineWaiters.push(waiter);
    });
  }

  /** True once auth has been sent and the socket is usable for routing. */
  private get online(): boolean {
    return this.authSent && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Retarget the Pi-side room addressed by the outer envelope. */
  setActiveRoom(room: string): void {
    this.activeRoom = room || "main";
  }

  getActiveRoom(): string {
    return this.activeRoom;
  }

  // ── outbound ─────────────────────────────────────────────────────────────

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.handlers.onNotice?.("Not connected to the relay — message not sent.");
      return;
    }
    // The Pi side is addressed by (peer, room); `peer` is filled in by the
    // caller through `setPeer`, but the room travels in the envelope.
    this.ws.send(encodeOuter(this.peer, this.activeRoom, encodeInner(message)));
  }

  sendControl(frame: ControlOutbound): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  /** Destination Pi pubkey (standard base64). Set after pairing. */
  private peer = "";

  setPeer(peerB64: string): void {
    this.peer = peerB64;
  }

  getPeer(): string {
    return this.peer;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.reconnectTimer = null;
    this.watchdog = null;
    this.authTimer = null;
  }

  private scheduleReconnect(reason: string): void {
    if (this.closedByUser) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.attempt);
    const delay = Math.round(base * (0.7 + Math.random() * 0.6)); // jitter
    this.attempt += 1;
    this.handlers.onStatus("reconnecting", `${reason} · retry in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => void this.connectOnce(), delay);
  }

  private async connectOnce(): Promise<void> {
    try {
      await this.connectAttempt();
    } catch (err) {
      // `start()` and the reconnect timer call this as a floating promise, so
      // it must never reject — an unhandled rejection here would surface as a
      // console error instead of a reconnect.
      this.handlers.onNotice?.(err instanceof Error ? err.message : "relay connect failed");
      this.scheduleReconnect("connect failed");
    }
  }

  private async connectAttempt(): Promise<void> {
    if (this.closedByUser) return;
    this.clearTimers();
    this.authSent = false;
    this.handlers.onStatus("connecting");

    let url: string;
    try {
      url = toWsRelayUrl(this.relayUrl);
    } catch (err) {
      this.handlers.onStatus("closed", err instanceof Error ? err.message : String(err));
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : "failed to open socket");
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded by a newer socket
      this.ws = null;
      this.authSent = false;
      this.clearTimers();
      this.scheduleReconnect("relay closed the connection");
    };
    ws.onerror = () => {
      // `onclose` always follows; nothing to do but avoid an unhandled event.
    };

    // Resolve the challenge before wiring the steady-state handler, so the
    // pre-auth frame cannot be mistaken for a control frame.
    //
    // `hello` is sent from `onopen`, never straight after the constructor: a
    // freshly constructed WebSocket is still CONNECTING, and calling `send()`
    // on it throws `InvalidStateError` synchronously.
    const challenge = new Promise<string>((resolve, reject) => {
      this.authTimer = setTimeout(
        () => reject(new Error("relay did not send a challenge in time")),
        AUTH_TIMEOUT_MS,
      );
      ws.onopen = () => {
        // 1. hello — standard base64, canonical "main" room (app is a client).
        try {
          ws.send(
            JSON.stringify({
              type: "hello",
              pubkey: this.identity.publicKeyB64,
              room_id: "main",
            } satisfies ControlOutbound),
          );
        } catch (err) {
          reject(err instanceof Error ? err : new Error("failed to send hello"));
          return;
        }
        this.handlers.onStatus("authenticating");
      };
      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (frame.type === "challenge" && typeof frame.nonce === "string") {
            resolve(frame.nonce);
          } else {
            reject(new Error(`expected challenge, got "${String(frame.type)}"`));
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error("malformed challenge frame"));
        }
      };
    });

    let nonce: string;
    try {
      nonce = await challenge;
    } catch (err) {
      this.handlers.onNotice?.(err instanceof Error ? err.message : "auth failed");
      this.closeSocket(ws);
      return; // onclose drives the reconnect
    }
    if (this.authTimer) clearTimeout(this.authTimer);

    let signature: Uint8Array;
    try {
      signature = await signWithIdentity(this.identity, b64Decode(nonce));
    } catch (err) {
      this.handlers.onNotice?.(err instanceof Error ? err.message : "failed to sign challenge");
      this.closeSocket(ws);
      return;
    }

    // 2. auth
    try {
      ws.send(JSON.stringify({ type: "auth", sig: b64Encode(signature) } satisfies ControlOutbound));
    } catch (err) {
      this.handlers.onNotice?.(err instanceof Error ? err.message : "failed to send auth");
      this.closeSocket(ws);
      return;
    }

    // Only now is the connection usable: the relay routes nothing before auth.
    this.authSent = true;

    // Steady state: the relay never acks auth. A rejected handshake closes the
    // socket within ~100ms, which the `onclose` handler turns into a reconnect.
    ws.onmessage = (event) => this.handleFrame(event.data);

    this.attempt = 0;
    this.lastInboundAt = Date.now();
    this.pendingPingId = null;
    this.handlers.onStatus("online");
    const waiters = this.onlineWaiters;
    this.onlineWaiters = [];
    for (const waiter of waiters) waiter();
    this.startWatchdog();
  }

  /** Close a socket we already gave up on; `onclose` then drives the retry. */
  private closeSocket(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private handleFrame(data: unknown): void {
    this.lastInboundAt = Date.now();

    if (typeof data !== "string") {
      this.handlers.onNotice?.("ignored a binary frame from the relay");
      return;
    }

    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      this.handlers.onNotice?.("ignored a malformed frame from the relay");
      return;
    }

    if (isOuterEnvelope(frame)) {
      // Plan/17: drop envelopes whose sender room differs from the one we are
      // addressing, so chunks from a chat the user just left do not bleed into
      // the current one. Legacy Pis omit `room` and route unconditionally.
      const senderRoom = frame.room;
      if (senderRoom !== undefined && senderRoom !== this.activeRoom) return;

      const inner = decodeInner(frame.ct);
      if (!inner) {
        this.handlers.onNotice?.("ignored an unreadable envelope payload");
        return;
      }
      if (inner.type === "pong" && inner.in_reply_to === this.pendingPingId) {
        this.pendingPingId = null;
      }
      this.handlers.onMessage(inner);
      return;
    }

    const type = (frame as Record<string, unknown>).type;
    if (typeof type === "string") {
      this.handlers.onControl(frame as ControlInbound);
      return;
    }
    this.handlers.onNotice?.("ignored an unrecognised frame from the relay");
  }

  private startWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      const now = Date.now();

      // Half-open socket: nothing observable for DEAD_MS. Force-close so the
      // `onclose` path reconnects instead of sitting there pretending to work.
      if (now - this.lastInboundAt > DEAD_MS) {
        this.handlers.onNotice?.("relay went silent — reconnecting");
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        return;
      }

      // Idle: probe the Pi so a dead peer is noticed (and to keep the
      // app↔Pi path warm). Re-probe at most every IDLE_PING_MS.
      if (now - this.lastInboundAt > IDLE_PING_MS && now - this.lastPingAt > IDLE_PING_MS) {
        this.lastPingAt = now;
        const id = uuid7();
        this.pendingPingId = id;
        this.send({ type: "ping", id });
      }
    }, WATCHDOG_TICK_MS);
  }
}
