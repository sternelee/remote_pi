/**
 * RelayClient tests against a fake WebSocket that reproduces the *browser*
 * semantics the real code has to survive.
 *
 * The regression this guards: a freshly constructed `WebSocket` is in
 * CONNECTING state, and calling `send()` on it throws `InvalidStateError`
 * synchronously. An earlier version sent `hello` immediately after the
 * constructor, which threw inside a floating promise and surfaced as an
 * unhandled rejection instead of a connection.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateIdentity, type StoredIdentity } from "../lib/crypto/ed25519";
import { RelayClient, type RelayStatus } from "../lib/relay/client";
import type { ControlInbound, ServerMessage } from "../lib/protocol/types";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class FakeWebSocket {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = 2;
  static readonly CLOSED = CLOSED;
  static instances: FakeWebSocket[] = [];

  readyState: number = CONNECTING;
  binaryType = "blob";
  sent: string[] = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  /** Mirrors the browser: sending before OPEN is an error, not a buffer. */
  send(data: string): void {
    if (this.readyState !== OPEN) {
      throw new Error("InvalidStateError: Still in CONNECTING state.");
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = CLOSED;
    this.onclose?.({});
  }

  // ── test drivers ─────────────────────────────────────────────────────────
  open(): void {
    this.readyState = OPEN;
    this.onopen?.({});
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  frames(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

/** 32 random bytes, standard base64 — the shape the relay sends for `nonce`. */
function fakeNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

let identity: StoredIdentity;

beforeEach(async () => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  identity = await generateIdentity();
});

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

interface Harness {
  client: RelayClient;
  socket: () => FakeWebSocket;
  statuses: RelayStatus[];
  messages: ServerMessage[];
  controls: ControlInbound[];
  notices: string[];
}

function harness(relayUrl = "wss://relay.example"): Harness {
  const statuses: RelayStatus[] = [];
  const messages: ServerMessage[] = [];
  const controls: ControlInbound[] = [];
  const notices: string[] = [];

  const client = new RelayClient({
    relayUrl,
    identity,
    activeRoom: "main",
    handlers: {
      onStatus: (status) => statuses.push(status),
      onMessage: (message) => messages.push(message),
      onControl: (frame) => controls.push(frame),
      onNotice: (text) => notices.push(text),
    },
  });

  return {
    client,
    socket: () => {
      const last = FakeWebSocket.instances.at(-1);
      if (!last) throw new Error("no socket constructed");
      return last;
    },
    statuses,
    messages,
    controls,
    notices,
  };
}

/** Flush the microtask queue enough for the awaited signing step to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("connect handshake", () => {
  it("does not send anything before the socket opens", () => {
    const h = harness();
    h.client.start();

    // The constructor has run but `onopen` has not fired. The old code threw
    // here.
    expect(h.socket().readyState).toBe(CONNECTING);
    expect(h.socket().sent).toHaveLength(0);
    expect(h.statuses).toContain("connecting");
  });

  it("sends hello on open, with the canonical room and standard base64 pubkey", () => {
    const h = harness();
    h.client.start();
    h.socket().open();

    expect(h.socket().frames()).toEqual([
      { type: "hello", pubkey: identity.publicKeyB64, room_id: "main" },
    ]);
    expect(h.statuses).toContain("authenticating");
  });

  it("answers the challenge with a 64-byte Ed25519 signature and goes online", async () => {
    const h = harness();
    h.client.start();
    h.socket().open();
    h.socket().emit({ type: "challenge", nonce: fakeNonce() });
    await settle();

    const auth = h.socket().frames()[1] as { type: string; sig: string };
    expect(auth.type).toBe("auth");
    expect(atob(auth.sig).length).toBe(64);
    expect(h.statuses.at(-1)).toBe("online");
  });

  it("normalizes a url-safe relay URL onto the ws(s) wire", () => {
    const h = harness("https://relay.example/path");
    h.client.start();
    expect(h.socket().url.startsWith("wss://")).toBe(true);
  });

  it("surfaces a bad relay URL instead of throwing", () => {
    const h = harness("ftp://nope");
    h.client.start();
    expect(h.statuses).toContain("closed");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("reports a missing challenge and closes the socket", async () => {
    const h = harness();
    h.client.start();
    h.socket().open();
    h.socket().emit({ type: "not-a-challenge" });
    await settle();

    expect(h.notices.join(" ")).toMatch(/expected challenge/);
    expect(h.socket().readyState).toBe(CLOSED);
  });
});

describe("frame routing", () => {
  async function connected(): Promise<Harness> {
    const h = harness();
    h.client.start();
    h.socket().open();
    h.socket().emit({ type: "challenge", nonce: fakeNonce() });
    await settle();
    return h;
  }

  it("decodes an outer envelope into an inner message", async () => {
    const h = await connected();
    h.client.setPeer("RU9rXbR2dEVwM1AyZTM=");

    const inner = { type: "agent_chunk", in_reply_to: "turn-1", delta: "hi" };
    const ct = btoa(unescape(encodeURIComponent(JSON.stringify(inner))));
    h.socket().emit({ peer: "sender", room: "main", ct });

    expect(h.messages).toEqual([inner]);
  });

  it("drops an envelope from a room we are not addressing", async () => {
    const h = await connected();
    const inner = { type: "agent_chunk", in_reply_to: "other", delta: "leak" };
    const ct = btoa(unescape(encodeURIComponent(JSON.stringify(inner))));
    h.socket().emit({ peer: "sender", room: "some-other-room", ct });

    expect(h.messages).toHaveLength(0);
  });

  it("routes a control frame to the control stream", async () => {
    const h = await connected();
    h.socket().emit({ type: "room_announced", peer: "p", room_id: "r", started_at: 1 });
    expect(h.controls).toHaveLength(1);
    expect(h.controls[0]).toMatchObject({ type: "room_announced", room_id: "r" });
  });

  it("ignores malformed and unreadable frames without tearing down the socket", async () => {
    const h = await connected();
    h.socket().emit({ peer: "sender", room: "main", ct: "!!!not-base64!!!" });
    h.socket().onmessage?.({ data: "{not json" });
    h.socket().emit({ totally: "unknown" });

    expect(h.messages).toHaveLength(0);
    expect(h.notices.length).toBeGreaterThanOrEqual(3);
    expect(h.socket().readyState).toBe(OPEN);
  });

  it("sends an outer envelope addressed to the paired peer and active room", async () => {
    const h = await connected();
    h.client.setPeer("RU9rXbR2dEVwM1AyZTM=");
    h.client.setActiveRoom("aB12CD34eF56");

    h.client.send({ type: "ping", id: "018f9c2e-7b1e-7000-9a3b-1c2d3e4f5a73" });

    const frame = h.socket().frames().at(-1) as {
      peer: string;
      room: string;
      ct: string;
    };
    expect(frame.peer).toBe("RU9rXbR2dEVwM1AyZTM=");
    expect(frame.room).toBe("aB12CD34eF56");
    expect(JSON.parse(atob(frame.ct))).toMatchObject({ type: "ping" });
  });

  it("warns instead of throwing when sending while disconnected", () => {
    const h = harness();
    h.client.start();
    // Still CONNECTING — the guard must stop the send before the socket does.
    h.client.send({ type: "ping", id: "x" });
    expect(h.notices.join(" ")).toMatch(/Not connected/);
  });
});

describe("whenOnline", () => {
  it("does not resolve until auth has been sent", async () => {
    const h = harness();
    let resolved = false;
    const pending = h.client.whenOnline(5_000).then(() => {
      resolved = true;
    });

    h.client.start();
    h.socket().open();
    await settle();
    expect(resolved, "resolved before the challenge").toBe(false);

    h.socket().emit({ type: "challenge", nonce: fakeNonce() });
    await settle();
    await pending;
    expect(resolved).toBe(true);
    expect(h.statuses.at(-1)).toBe("online");
  });

  it("resolves immediately when already online", async () => {
    const h = harness();
    h.client.start();
    h.socket().open();
    h.socket().emit({ type: "challenge", nonce: fakeNonce() });
    await settle();

    await expect(h.client.whenOnline(100)).resolves.toBeUndefined();
  });

  it("rejects instead of hanging when the relay never answers", async () => {
    const h = harness();
    h.client.start();
    h.socket().open();
    await expect(h.client.whenOnline(50)).rejects.toThrow(/did not come online/);
  });

  it("delivers a message sent after awaiting online (the pair_request regression)", async () => {
    const h = harness();
    h.client.setPeer("RU9rXbR2dEVwM1AyZTM=");
    h.client.start();

    // Sending right after `start()` loses the message: the socket is still
    // CONNECTING and the guard refuses it. This is what made pairing time out
    // with no reply and no visible error.
    h.client.send({ type: "pair_request", id: "too-early", token: "t", device_name: "d" });
    expect(h.notices.join(" ")).toMatch(/Not connected/);

    h.socket().open();
    h.socket().emit({ type: "challenge", nonce: fakeNonce() });
    await h.client.whenOnline(5_000);
    h.client.send({ type: "pair_request", id: "on-time", token: "t", device_name: "d" });

    const sent = h.socket().frames();
    expect(sent).toHaveLength(3); // hello, auth, pair_request
    const last = sent.at(-1) as { ct: string };
    expect(JSON.parse(atob(last.ct))).toMatchObject({ type: "pair_request", id: "on-time" });
  });
});
