/**
 * Opt-in integration test: the **shipping** client against a fake Pi peer over
 * the **real relay**.
 *
 * Skipped unless `PI_LIVE=1`, so `pnpm test` stays offline and deterministic:
 *
 *   PI_LIVE=1 pnpm test
 *   PI_LIVE=1 PI_RELAY=ws://localhost:3000 pnpm test
 *
 * Both ends run in-process, which is the point: the peer records every frame it
 * received, so a message the client *claims* to have sent can be proven to have
 * arrived and been understood — not merely written to the socket.
 *
 * This covers the whole interaction surface added after the first pass:
 * pairing, the session mirror, the four typed actions, the draft queue, steering
 * and an interactive prompt answered through the rich `ask` envelope.
 */

import { describe, expect, it } from "vitest";

import { generateIdentity } from "../lib/crypto/ed25519";
import { parseQrPayload } from "../lib/pairing/qr";
import { uuid7 } from "../lib/protocol/uuid7";
import type { ControlInbound, ServerMessage } from "../lib/protocol/types";
import { RelayClient } from "../lib/relay/client";
import { buildQuestionAnswer } from "../lib/session/answers";
import { questionsOf } from "../lib/session/transcript";
// @ts-expect-error — plain ESM harness, no types by design.
import { startFakePi, CATALOGUE } from "../tools/fake-pi-peer.mjs";

const LIVE = process.env.PI_LIVE === "1";
const RELAY = process.env.PI_RELAY ?? "wss://relay-rp1.jacobmoura.work";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(get: () => T | undefined, timeoutMs = 10_000): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = get();
    if (value !== undefined) return value;
    await sleep(50);
  }
  return undefined;
}

describe.skipIf(!LIVE)("live interaction surface over the real relay", () => {
  it("pairs, mirrors, and drives every typed action", async () => {
    const peer = await startFakePi({ relayUrl: RELAY, ask: true });

    const qr = parseQrPayload(peer.link);
    const identity = await generateIdentity();

    const messages: ServerMessage[] = [];
    const controls: ControlInbound[] = [];
    const notices: string[] = [];

    const client = new RelayClient({
      relayUrl: RELAY,
      identity,
      activeRoom: qr.roomId ?? "main",
      handlers: {
        onStatus: () => {},
        onMessage: (message) => messages.push(message),
        onControl: (frame) => controls.push(frame),
        onNotice: (text) => notices.push(text),
      },
    });
    client.setPeer(qr.epk);

    try {
      // ── pairing ────────────────────────────────────────────────────────
      client.start();
      await client.whenOnline(15_000);
      client.send({ type: "pair_request", id: uuid7(), token: qr.token, device_name: "vitest live" });

      const pairOk = await waitFor(() =>
        messages.find((m): m is Extract<ServerMessage, { type: "pair_ok" }> => m.type === "pair_ok"),
      );
      expect(pairOk, `no pair_ok. notices: ${notices.join(" | ")}`).toBeDefined();
      expect(pairOk!.room_id).toBe(peer.room);
      client.setActiveRoom(pairOk!.room_id);

      // ── room discovery + subscription ──────────────────────────────────
      // The session layer does this on every `online`; without the subscription
      // the relay has nobody to broadcast `room_meta_updated` to.
      client.sendControl({ type: "subscribe_rooms", peers: [qr.epk] });
      client.sendControl({ type: "rooms_check", peers: [qr.epk] });
      const rooms = await waitFor(() =>
        controls.find((c): c is Extract<ControlInbound, { type: "rooms" }> => c.type === "rooms"),
      );
      expect(rooms?.rooms[0]).toMatchObject({ room_id: peer.room, name: expect.any(String) });
      expect(rooms?.rooms[0].model).toBe(CATALOGUE[0].name);

      // ── session mirror ─────────────────────────────────────────────────
      client.send({ type: "session_sync", id: uuid7(), limit: 60 });
      const history = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "session_history" }> => m.type === "session_history",
        ),
      );
      expect(history?.events.length).toBeGreaterThan(3);
      expect(history?.eos).toBe(true);

      // ── list_models ────────────────────────────────────────────────────
      const modelsRequestId = uuid7();
      client.send({ type: "list_models", id: modelsRequestId });
      const modelsList = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "models_list" }> =>
            m.type === "models_list" && m.in_reply_to === modelsRequestId,
        ),
      );
      expect(modelsList?.models).toHaveLength(CATALOGUE.length);
      expect(modelsList?.current?.id).toBe(CATALOGUE[0].id);
      // The picker relies on these fields; a wire rename would break it silently.
      expect(modelsList?.models[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        provider: expect.any(String),
        reasoning: expect.any(Boolean),
        context_window: expect.any(Number),
        vision: expect.any(Boolean),
      });

      // ── model_set ──────────────────────────────────────────────────────
      const target = CATALOGUE.find((m: { id: string }) => m.id === "gpt-5.6-terra")!;
      const modelRequestId = uuid7();
      client.send({
        type: "model_set",
        id: modelRequestId,
        provider: target.provider,
        model_id: target.id,
      });
      const modelOk = await waitFor(() =>
        messages.find((m) => m.type === "action_ok" && m.in_reply_to === modelRequestId),
      );
      expect(modelOk).toMatchObject({ action: "model_set" });
      // The peer really changed: the request was understood, not just delivered.
      expect(peer.getModel().id).toBe("gpt-5.6-terra");

      const modelMeta = await waitFor(() =>
        controls.find(
          (c) => c.type === "room_meta_updated" && c.meta.model === "GPT-5.6 Terra",
        ),
      );
      expect(modelMeta, "room meta did not broadcast the new model").toBeDefined();

      // ── thinking_set ───────────────────────────────────────────────────
      const thinkingRequestId = uuid7();
      client.send({ type: "thinking_set", id: thinkingRequestId, level: "low" });
      const thinkingOk = await waitFor(() =>
        messages.find((m) => m.type === "action_ok" && m.in_reply_to === thinkingRequestId),
      );
      expect(thinkingOk).toMatchObject({ action: "thinking_set" });
      expect(peer.getThinking()).toBe("low");

      // ── draft queue ────────────────────────────────────────────────────
      const queueId = uuid7();
      client.send({ type: "queued_message_set", id: queueId, text: "run the tests after this" });
      const queued = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "queued_message_state" }> =>
            m.type === "queued_message_state" && (m.items?.length ?? 0) > 0,
        ),
      );
      expect(queued?.items?.[0]?.text).toBe("run the tests after this");

      client.send({ type: "queued_message_clear", id: uuid7(), target_id: queueId });
      const cleared = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "queued_message_state" }> =>
            m.type === "queued_message_state" && m.items?.length === 0,
        ),
      );
      expect(cleared).toBeDefined();
      expect(peer.getQueued()).toEqual([]);

      // ── steering ───────────────────────────────────────────────────────
      const steerId = uuid7();
      client.send({
        type: "user_message",
        id: steerId,
        text: "also check the queue",
        streaming_behavior: "steer",
      });
      const steerConsumed = await waitFor(() =>
        messages.find((m) => m.type === "steer_consumed" && m.id === steerId),
      );
      expect(steerConsumed, "the steer was not confirmed").toBeDefined();

      const echoed = await waitFor(() =>
        messages.find((m) => m.type === "user_message" && m.id === steerId),
      );
      expect(echoed).toMatchObject({ streaming_behavior: "steer" });

      const done = await waitFor(() =>
        messages.find((m) => m.type === "agent_done" && m.in_reply_to === steerId),
      );
      expect(done).toBeDefined();

      // ── interactive prompt, answered through the rich envelope ──────────
      const request = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "extension_ui_request" }> =>
            m.type === "extension_ui_request",
        ),
      );
      expect(request, "the peer never asked its question").toBeDefined();

      const { questions } = questionsOf(request!);
      expect(questions[0].type).toBe("multi");
      expect(questions[0].options.map((o) => o.value)).toEqual(["api", "web", "db"]);

      const answer = buildQuestionAnswer(request!.id, request!.ask?.flow_id, questions, {
        selected: { targets: ["api", "db"] },
        custom: {},
      });
      expect(answer).not.toBeNull();

      client.send({
        type: "extension_ui_response",
        id: answer!.requestId,
        ask: {
          flow_id: answer!.flowId!,
          kind: "answer",
          mode: "submit",
          answers: answer!.answers!,
        },
      });

      const receivedAnswer = await peer.waitForAnswer();
      expect(receivedAnswer, "the prompt answer never arrived").toBeDefined();
      // Values, not labels — the Pi routes on the envelope and expects values.
      expect(receivedAnswer.ask).toMatchObject({
        kind: "answer",
        answers: { targets: { values: ["api", "db"] } },
      });
      expect(receivedAnswer.id).toBe(request!.id);

      // ── session_compact ────────────────────────────────────────────────
      const compactId = uuid7();
      client.send({ type: "session_compact", id: compactId });
      const compactOk = await waitFor(() =>
        messages.find((m) => m.type === "action_ok" && m.in_reply_to === compactId),
      );
      expect(compactOk).toMatchObject({ action: "session_compact" });
      const compaction = await waitFor(() =>
        messages.find((m) => m.type === "compaction"),
      );
      expect(compaction).toBeDefined();

      // ── session_new ────────────────────────────────────────────────────
      const newId = uuid7();
      client.send({ type: "session_new", id: newId });
      const newOk = await waitFor(() =>
        messages.find((m) => m.type === "action_ok" && m.in_reply_to === newId),
      );
      expect(newOk).toMatchObject({ action: "session_new" });
      // A fresh mirror comes back with no events.
      const emptied = await waitFor(() =>
        messages.find(
          (m): m is Extract<ServerMessage, { type: "session_history" }> =>
            m.type === "session_history" && m.events.length === 0,
        ),
      );
      expect(emptied).toBeDefined();

      // ── nothing was refused along the way ──────────────────────────────
      expect(notices.filter((n) => /Not connected/.test(n))).toEqual([]);
    } finally {
      client.close();
      peer.close();
    }
  }, 90_000);
});
