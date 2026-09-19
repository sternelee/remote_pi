/**
 * Opt-in live check: pair a real Pi over the real relay using the *shipping*
 * client code (`RelayClient` + the pairing helpers), not a reimplementation.
 *
 * Skipped unless a pairing link is supplied, so `pnpm test` stays offline and
 * deterministic:
 *
 *   PI_PAIR_LINK='remotepi://pair?t=…&epk=…&n=…&rm=…' pnpm test
 *   PI_PAIR_LINK='…' PI_RELAY=http://localhost:3000 pnpm test
 *
 * A `pair_error` is a pass for the transport (the reply arrived); it is
 * reported, not asserted away, because an expired token is the expected
 * outcome when a link is reused.
 */

import { describe, expect, it } from "vitest";

import { generateIdentity } from "../lib/crypto/ed25519";
import { parseQrPayload } from "../lib/pairing/qr";
import { uuid7 } from "../lib/protocol/uuid7";
import type { ControlInbound, ServerMessage } from "../lib/protocol/types";
import { RelayClient } from "../lib/relay/client";

const LINK = process.env.PI_PAIR_LINK;
const RELAY = process.env.PI_RELAY ?? "https://relay-rp1.jacobmoura.work";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(get: () => T[], timeoutMs: number): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && get().length === 0) await sleep(200);
  return get();
}

describe.skipIf(!LINK)("live pairing against a real Pi", () => {
  it("completes the challenge-response and the pair_request round trip", async () => {
    const qr = parseQrPayload(LINK!);
    const identity = await generateIdentity();

    const messages: ServerMessage[] = [];
    const controls: ControlInbound[] = [];
    const notices: string[] = [];
    const statuses: string[] = [];

    const client = new RelayClient({
      relayUrl: RELAY,
      identity,
      activeRoom: qr.roomId ?? "main",
      handlers: {
        onStatus: (status) => statuses.push(status),
        onMessage: (message) => messages.push(message),
        onControl: (frame) => controls.push(frame),
        onNotice: (text) => notices.push(text),
      },
    });
    client.setPeer(qr.epk);

    client.start();
    await client.whenOnline(15_000);
    console.log(`[live] relay authenticated (statuses: ${statuses.join(" → ")})`);

    client.send({
      type: "pair_request",
      id: uuid7(),
      token: qr.token,
      device_name: "vitest live check",
    });

    await waitFor(() => messages, 15_000);
    const reply = messages[0];

    console.log(
      `[live] reply: ${reply ? JSON.stringify(reply) : `NONE (notices: ${notices.join(" | ")})`}`,
    );

    // The transport must have carried *something* back; silence is the failure
    // mode this check exists to catch.
    expect(reply, `no reply from the Pi. notices: ${notices.join(" | ")}`).toBeDefined();
    expect(["pair_ok", "pair_error"]).toContain(reply.type);

    if (reply.type === "pair_ok") {
      // The channel is now paired — prove it routes by pulling the mirror.
      client.setActiveRoom(reply.room_id);
      client.send({ type: "session_sync", id: uuid7(), limit: 5 });
      await waitFor(() => messages.filter((m) => m.type === "session_history"), 10_000);

      const history = messages.find((m) => m.type === "session_history");
      console.log(
        `[live] session_history: ${history ? `${(history as { events: unknown[] }).events.length} events` : "none"}`,
      );
      expect(history).toBeDefined();
    }

    client.close();
  }, 60_000);
});
