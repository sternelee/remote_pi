/**
 * A minimal fake Pi peer, as a module.
 *
 * Speaks only the protocol in `.orchestration/contracts/protocol.md`. Two
 * callers:
 *   - `tools/fake-pi.mjs` — CLI harness that prints a pairing link
 *   - `test/live-actions.test.ts` — integration test that drives the *shipping*
 *     client against this peer over the real relay and asserts on what arrived
 *
 * Being a module is the point: the test can inspect `received` directly, so a
 * frame the client claims to have sent can be proven to have arrived and been
 * understood, rather than only proving the client's own bookkeeping.
 *
 * Development tool. Not product code: ephemeral identity, accepts any token.
 */

const subtle = globalThis.crypto.subtle;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const unb64 = (text) => Buffer.from(text, "base64");
const json = (value) => JSON.stringify(value);
const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Catalogue the peer pretends the Pi has. */
export const CATALOGUE = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", provider: "anthropic", reasoning: true, context_window: 200000, vision: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", reasoning: true, context_window: 200000, vision: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai", reasoning: true, context_window: 400000, vision: true },
  { id: "gpt-5.6-mini", name: "GPT-5.6 Mini", provider: "openai", reasoning: false, context_window: 128000, vision: false },
];

export async function startFakePi({
  relayUrl = "wss://relay-rp1.jacobmoura.work",
  sessionName = "fake-pi · demo-session",
  /** Emit a multi-select prompt with previews right after pairing. */
  ask = false,
  /** Print protocol traffic. */
  log = () => {},
} = {}) {
  const keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const epk = b64(new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey)));

  const room = b64url(randomBytes(9)).slice(0, 12);
  const token = b64url(randomBytes(16));
  const sessionStartedAt = Date.now();

  // ── observable state ─────────────────────────────────────────────────────
  /** Every inner message this peer received, in order. */
  const received = [];
  /** Responses received for interactive prompts. */
  const answers = [];
  /** Set once the relay accepted auth. */
  let authenticated = false;
  let closed = false;
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  let currentModel = CATALOGUE[0];
  let thinking = "high";
  let queued = [];
  let appPeer = null;

  const ws = new WebSocket(relayUrl);

  const roomMeta = () => ({
    name: sessionName,
    cwd: "/Users/dev/fake-pi",
    model: currentModel.name,
    thinking,
    working: false,
  });

  function send(inner) {
    if (!appPeer || ws.readyState !== 1) return;
    // Mirrors the extension: outbound frames are `{peer, ct}` with no `room`.
    ws.send(json({ peer: appPeer, ct: b64(Buffer.from(json(inner), "utf8")) }));
    log(`→ ${inner.type}`);
  }

  /** Tell the relay about new room meta; it broadcasts `room_meta_updated`. */
  function pushRoomMeta() {
    if (ws.readyState !== 1) return;
    ws.send(
      json({
        type: "room_meta_update",
        room_id: room,
        meta: { model: currentModel.name, thinking },
      }),
    );
  }

  async function handleInner(inner) {
    switch (inner.type) {
      case "pair_request":
        send({
          type: "pair_ok",
          in_reply_to: inner.id,
          session_name: sessionName,
          session_started_at: sessionStartedAt,
          room_id: room,
          harness: { name: "Pi coding agent (fake)", version: "0.0.0-harness" },
          hostname: "fake-pi.local",
        });
        if (ask) {
          await sleep(600);
          askMulti();
        }
        break;

      case "session_sync":
        send(history(inner.id));
        break;

      case "list_models":
        send({ type: "models_list", in_reply_to: inner.id, models: CATALOGUE, current: currentModel });
        break;

      case "model_set": {
        const found = CATALOGUE.find(
          (m) => m.id === inner.model_id && m.provider === inner.provider,
        );
        if (!found) {
          send({ type: "action_error", in_reply_to: inner.id, action: "model_set", error: "unknown model" });
          break;
        }
        currentModel = found;
        send({ type: "action_ok", in_reply_to: inner.id, action: "model_set" });
        pushRoomMeta();
        break;
      }

      case "thinking_set":
        thinking = inner.level;
        send({ type: "action_ok", in_reply_to: inner.id, action: "thinking_set" });
        pushRoomMeta();
        break;

      case "session_new":
        send({ type: "action_ok", in_reply_to: inner.id, action: "session_new" });
        send(history(`new-${inner.id}`, []));
        break;

      case "session_compact":
        send({ type: "action_ok", in_reply_to: inner.id, action: "session_compact" });
        send({
          type: "compaction",
          summary: "Condensed the earlier turns into a short brief.",
          tokens_before: 92400,
          ts: Date.now(),
        });
        break;

      case "queued_message_set": {
        const text = inner.text.trim();
        queued = text ? [{ id: inner.id, text, editable: true, created_at: Date.now() }] : [];
        send({ type: "queued_message_state", items: queued });
        break;
      }

      case "queued_message_clear":
        queued = [];
        send({ type: "queued_message_state", items: queued });
        break;

      case "user_message":
        // Source-of-truth echo, like the real extension: every owner renders
        // from this, so the sender's id and streaming_behavior come back
        // verbatim and an optimistic bubble is confirmed rather than guessed at.
        send({
          type: "user_message",
          id: inner.id,
          text: inner.text,
          ...(inner.images ? { images: inner.images } : {}),
          ...(inner.streaming_behavior ? { streaming_behavior: inner.streaming_behavior } : {}),
        });
        await replayTurn(inner);
        break;

      case "ping":
        send({ type: "pong", in_reply_to: inner.id });
        break;

      case "cancel":
        send({ type: "cancelled", in_reply_to: inner.id, target_id: inner.target_id });
        break;

      case "extension_ui_response":
        answers.push(inner);
        break;

      default:
        break;
    }
  }

  function askMulti() {
    send({
      type: "extension_ui_request",
      id: `ask-${Date.now()}`,
      method: "select",
      title: "Which targets should I check?",
      options: ["degraded"],
      ask: {
        flow_id: `flow-${Date.now()}`,
        tool_call_id: null,
        source: "tool",
        title: "Which targets should I check?",
        questions: [
          {
            id: "targets",
            label: "Targets",
            prompt: "Pick any that apply — this is a multi-select.",
            type: "multi",
            required: true,
            options: [
              { value: "api", label: "API service", description: "node · :3000" },
              { value: "web", label: "Web client", description: "vite · :5173" },
              { value: "db", label: "Database", description: "postgres" },
            ],
          },
        ],
      },
    });
  }

  function history(inReplyTo, events = defaultEvents()) {
    return {
      type: "session_history",
      in_reply_to: inReplyTo,
      session_started_at: sessionStartedAt,
      events,
      eos: true,
      truncated: false,
    };
  }

  function defaultEvents() {
    const base = Date.now() - 60_000;
    return [
      { ts: base, type: "user_input", id: "local_1", text: "list the modified files" },
      {
        ts: base + 1000,
        type: "tool_request",
        tool_call_id: "tc_hist_1",
        tool: "Bash",
        args: { command: "git status -s" },
      },
      {
        ts: base + 1500,
        type: "tool_result",
        tool_call_id: "tc_hist_1",
        result: { stdout: " M src/index.ts\n M README.md", exit_code: 0 },
      },
      {
        ts: base + 2000,
        type: "tool_request",
        tool_call_id: "tc_hist_2",
        tool: "Edit",
        args: { file_path: "src/index.ts" },
      },
      {
        ts: base + 2500,
        type: "tool_result",
        tool_call_id: "tc_hist_2",
        result: [
          "@@ -12,3 +12,5 @@",
          " const app = createApp();",
          "-app.listen(3000);",
          "+app.listen(Number(process.env.PORT ?? 3000));",
          "+app.on('error', report);",
        ].join("\n"),
      },
      {
        ts: base + 3000,
        type: "tool_request",
        tool_call_id: "tc_hist_3",
        tool: "Bash",
        args: { command: "npm test" },
      },
      {
        ts: base + 3500,
        type: "tool_result",
        tool_call_id: "tc_hist_3",
        error: "command timed out after 60s",
      },
      {
        ts: base + 4000,
        type: "agent_message",
        in_reply_to: "local_1",
        text: "Two files changed: `src/index.ts` and `README.md`.",
        usage: { input_tokens: 812, output_tokens: 64 },
      },
    ];
  }

  /** A steer is folded into the running turn and confirmed with `steer_consumed`. */
  async function replayTurn(inner) {
    const replyTo = inner.id;
    if (inner.streaming_behavior === "steer") send({ type: "steer_consumed", id: inner.id });

    send({ type: "tool_request", tool_call_id: `tc_${replyTo}`, tool: "Read", args: { file_path: "src/index.ts" } });
    await sleep(80);
    send({ type: "tool_result", tool_call_id: `tc_${replyTo}`, result: { lines: 42 } });
    for (const delta of ["Looking at ", "the file… ", "done."]) {
      send({ type: "agent_chunk", in_reply_to: replyTo, delta });
      await sleep(60);
    }
    send({ type: "agent_done", in_reply_to: replyTo, usage: { input_tokens: 120, output_tokens: 12 } });
  }

  ws.addEventListener("open", () => {
    ws.send(json({ type: "hello", pubkey: epk, room_id: room, room_meta: roomMeta() }));
  });

  ws.addEventListener("message", (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!authenticated) {
      if (frame.type === "challenge") {
        void (async () => {
          const sig = new Uint8Array(await subtle.sign("Ed25519", keyPair.privateKey, unb64(frame.nonce)));
          ws.send(json({ type: "auth", sig: b64(sig) }));
          authenticated = true;
          // The relay registers the peer on `auth`; only then can anything be
          // routed to (epk, room).
          markReady();
        })();
      }
      return;
    }

    if (frame.peer && frame.ct) {
      appPeer = frame.peer;
      let inner;
      try {
        inner = JSON.parse(unb64(frame.ct).toString("utf8"));
      } catch {
        return;
      }
      received.push(inner);
      log(`← ${inner.type}`);
      void handleInner(inner);
      return;
    }
    if (frame.type) log(`← control ${frame.type}`);
  });

  ws.addEventListener("close", () => {
    closed = true;
  });

  // Wait until the relay has accepted auth, so a caller cannot address a peer
  // that is not registered yet (the failure mode is a silent "dest not found").
  await Promise.race([ready, sleep(8_000)]);

  const link = `remotepi://pair?t=${token}&epk=${Buffer.from(epk, "base64").toString("base64url")}&n=${encodeURIComponent(sessionName)}&rm=${room}`;

  return {
    link,
    epk,
    room,
    /** Standard-base64 epk, the form the wire uses. */
    epkStandard: epk,
    received,
    answers,
    /** Resolves once the relay accepted this peer's auth. */
    ready: () => ready,
    isAuthenticated: () => authenticated,
    isClosed: () => closed,
    getQueued: () => queued,
    getModel: () => currentModel,
    getThinking: () => thinking,
    /** Wait until a received frame satisfies `predicate`. */
    async waitFor(predicate, timeoutMs = 8_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = received.find(predicate);
        if (hit) return hit;
        await sleep(50);
      }
      return undefined;
    },
    async waitForAnswer(timeoutMs = 8_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && answers.length === 0) await sleep(50);
      return answers[0];
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}
