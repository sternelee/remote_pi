import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { SupervisorUiBridge, type UiFrame } from "./ui_bridge.js";

/**
 * Plan/58 primitive B — extension-side bridge. Uses a real net server on a
 * scratch UDS so the framing + reconnect behavior are exercised without Pi.
 */

let dir: string;
let servers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-ui-bridge-"));
});

afterEach(() => {
  for (const s of servers) {
    try { s.close(); } catch { /* already closed */ }
  }
  servers = [];
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listen(path: string, onConn: (s: Socket) => void): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(onConn);
    servers.push(server);
    server.once("error", reject);
    server.listen(path, () => resolve(server));
  });
}

function readLine(sock: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (c: string) => {
      buf += c;
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        sock.off("data", onData);
        resolve(buf.slice(0, nl));
      }
    };
    sock.on("data", onData);
    sock.once("error", reject);
  });
}

describe("SupervisorUiBridge", () => {
  test("announces ui_hello, dispatches ui_request frames, writes ui_response", async () => {
    const path = join(dir, "roundtrip.sock");
    let serverSide: Socket | null = null;
    let hello: unknown = null;
    const helloSeen = new Promise<void>((resolve) => {
      void listen(path, (s) => {
        serverSide = s;
        s.setEncoding("utf8");
        let buf = "";
        s.on("data", (c: string) => {
          buf += c;
          const nl = buf.indexOf("\n");
          if (nl >= 0 && hello === null) {
            hello = JSON.parse(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            resolve();
          }
        });
      });
    });

    const bridge = new SupervisorUiBridge({ sockPath: path, reconnectBaseMs: 20, reconnectMaxMs: 100 });
    const frames: UiFrame[] = [];
    bridge.onFrame((f) => frames.push(f));
    bridge.connect("daemon-1", "/tmp/proj");

    await helloSeen;
    expect(hello).toEqual({ op: "ui_hello", daemon_id: "daemon-1", cwd: "/tmp/proj" });

    const frame = { type: "extension_ui_request", id: "ui-1", method: "confirm", title: "ok?" };
    const responseLine = readLine(serverSide!);
    serverSide!.write(JSON.stringify({ op: "ui_request", frame }) + "\n");
    await delay(30);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(frame);

    bridge.respond("ui-1", { confirmed: true });
    expect(JSON.parse(await responseLine)).toEqual({
      op: "ui_response",
      id: "ui-1",
      confirmed: true,
    });

    bridge.close();
  });

  test("omits cwd from the hello when not provided", async () => {
    const path = join(dir, "nocwd.sock");
    let hello: unknown = null;
    const helloSeen = new Promise<void>((resolve) => {
      void listen(path, (s) => {
        s.setEncoding("utf8");
        s.once("data", (c: string) => {
          hello = JSON.parse(String(c).split("\n")[0] ?? "{}");
          resolve();
        });
      });
    });
    const bridge = new SupervisorUiBridge({ sockPath: path, reconnectBaseMs: 20 });
    bridge.connect("daemon-2");
    await helloSeen;
    expect(hello).toEqual({ op: "ui_hello", daemon_id: "daemon-2" });
    bridge.close();
  });

  test("ignores malformed / non-ui_request lines without throwing", async () => {
    const path = join(dir, "junk.sock");
    let serverSide: Socket | null = null;
    const connected = new Promise<void>((resolve) => {
      void listen(path, (s) => {
        serverSide = s;
        s.setEncoding("utf8");
        s.once("data", () => resolve());
      });
    });
    const bridge = new SupervisorUiBridge({ sockPath: path, reconnectBaseMs: 20 });
    const frames: UiFrame[] = [];
    bridge.onFrame((f) => frames.push(f));
    bridge.connect("daemon-3");
    await connected;
    await delay(20);
    serverSide!.write("not json\n");
    serverSide!.write(JSON.stringify({ op: "ui_response", id: "x" }) + "\n");
    serverSide!.write(JSON.stringify({ op: "ui_request", frame: { type: "wrong" } }) + "\n");
    await delay(30);
    expect(frames).toHaveLength(0);
    bridge.close();
  });

  test("reconnects with backoff once the socket appears", async () => {
    const path = join(dir, "reconnect.sock");
    const bridge = new SupervisorUiBridge({ sockPath: path, reconnectBaseMs: 20, reconnectMaxMs: 50 });
    bridge.connect("daemon-4");
    // No server yet → the first connect fails and a reconnect is scheduled.
    await delay(30);

    let gotHello = false;
    await listen(path, (s) => {
      s.setEncoding("utf8");
      s.on("data", (c: string) => {
        if (String(c).includes("ui_hello")) gotHello = true;
      });
    });
    for (let i = 0; i < 60 && !gotHello; i++) await delay(20);
    expect(gotHello).toBe(true);
    bridge.close();
  });

  test("close() is safe when never connected and stops reconnecting", async () => {
    const path = join(dir, "never.sock");
    const bridge = new SupervisorUiBridge({ sockPath: path, reconnectBaseMs: 20 });
    bridge.connect("daemon-5");
    bridge.close();
    // respond + onFrame after close must not throw.
    expect(() => bridge.respond("x", { value: "y" })).not.toThrow();
    bridge.onFrame(() => { /* no-op */ });
    await delay(60);
    expect(bridge._hasSocketForTest()).toBe(false);
  });

  test("respond() before the socket connects is a no-op (no throw)", () => {
    const bridge = new SupervisorUiBridge({ sockPath: join(dir, "noop.sock"), reconnectBaseMs: 20 });
    expect(() => bridge.respond("x", { cancelled: true })).not.toThrow();
    bridge.close();
  });
});
