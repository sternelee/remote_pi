import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionUiBridge } from "./extension_ui_bridge.js";
import type { ExtensionUiResponseWire, ServerMessage } from "./protocol/types.js";

// ── Fake pi.events bus ──────────────────────────────────────────────────────
// Records every emit (name + data) so tests can assert what the bridge forwarded
// to pi-ask, and dispatches to registered handlers so tests can simulate pi-ask
// firing started/completed/submit-result.
interface FakeBus {
  on(name: string, cb: (data: unknown) => void): () => void;
  emit(name: string, data: unknown): void;
  emitted: Array<{ name: string; data: unknown }>;
}

function fakeBus(): FakeBus {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const emitted: Array<{ name: string; data: unknown }> = [];
  return {
    on(name, cb) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    emit(name, data) {
      emitted.push({ name, data });
      handlers.get(name)?.forEach((cb) => cb(data));
    },
    emitted,
  };
}

function fakePi(bus: FakeBus): ExtensionAPI {
  return { events: bus } as unknown as ExtensionAPI;
}

function singleQuestionFlow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: 1,
    flowId: "tool:tc_1",
    toolCallId: "tc_1",
    source: "tool",
    title: "Direction",
    questions: [
      {
        id: "goal",
        label: "Goal",
        prompt: "What's the goal?",
        type: "single",
        required: true,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta", description: "second choice" },
        ],
      },
    ],
    ...overrides,
  };
}

const SUBMIT = "@eko24ive/pi-ask:submit";

describe("extension_ui_bridge", () => {
  it("returns null when the SDK exposes no events bus (inert)", () => {
    const pi = {} as unknown as ExtensionAPI;
    expect(createExtensionUiBridge(pi, () => {})).toBeNull();
  });

  it("translates a pi-ask `started` event into one extension_ui_request", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());

    expect(sent).toHaveLength(1);
    const req = sent[0];
    expect(req.type).toBe("extension_ui_request");
    if (req.type !== "extension_ui_request") return;
    expect(req.method).toBe("select");
    if (req.method !== "select") return;
    expect(req.id).toBe("tool:tc_1");
    expect(req.title).toBe("Direction");
    expect(req.options).toEqual(["Alpha", "Beta"]);
    expect(req.ask?.flow_id).toBe("tool:tc_1");
    expect(req.ask?.tool_call_id).toBe("tc_1");
    expect(req.ask?.source).toBe("tool");
    expect(req.ask?.questions).toHaveLength(1);
    expect(req.ask?.questions[0]?.options.map((o) => o.value)).toEqual(["a", "b"]);
    // description survives (pi-ask addition rides in the envelope)
    expect(req.ask?.questions[0]?.options[1]?.description).toBe("second choice");
  });

  it("forwards a rich answer back to pi-ask as a single submit", () => {
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    const response: ExtensionUiResponseWire = {
      type: "extension_ui_response",
      id: "tool:tc_1",
      value: "Alpha",
      ask: {
        flow_id: "tool:tc_1",
        kind: "answer",
        mode: "submit",
        answers: { goal: { values: ["a"] } },
      },
    };
    bridge.respond(response);

    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    expect(submits[0]?.data).toEqual({
      version: 1,
      requestId: "tool:tc_1",
      flowId: "tool:tc_1",
      response: {
        kind: "answer",
        mode: "submit",
        answers: { goal: { values: ["a"] } },
      },
    });
  });

  it("forwards a cancel as { kind: 'cancel' }", () => {
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    bridge.respond({
      type: "extension_ui_response",
      id: "tool:tc_1",
      cancelled: true,
      ask: { flow_id: "tool:tc_1", kind: "cancel" },
    });

    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    const data = submits[0]?.data as { response: { kind: string } };
    expect(data.response).toEqual({ kind: "cancel" });
  });

  it("maps a label-only response back to the option value (degraded client)", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m))!;

    bus.emit(
      "@eko24ive/pi-ask:started",
      singleQuestionFlow({ flowId: "f1", toolCallId: undefined }),
    );

    // A client that ignored the `ask` envelope and rendered only the SDK select.
    bridge.respond({ type: "extension_ui_response", id: "f1", value: "Beta" });

    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    const data = submits[0]?.data as {
      response: { answers: Record<string, unknown> };
    };
    expect(data.response.answers).toEqual({ goal: { values: ["b"] } });
  });

  it("broadcasts a dismiss notify (same id as the request) on completed", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
    sent.length = 0;
    bus.emit("@eko24ive/pi-ask:completed", { version: 1, flowId: "tool:tc_1" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "extension_ui_request",
      id: "tool:tc_1",
      method: "notify",
    });
  });

  it("broadcasts a warning notify on a submit-result error", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:submit-result", {
      version: 1,
      requestId: "r1",
      flowId: "tool:tc_1",
      ok: false,
      error: "invalid_answer",
      message: "Unknown option value.",
    });

    expect(sent).toHaveLength(1);
    // The warning reuses the flowId as its id so the app can correlate it to
    // its open modal (distinguished from the `completed` dismiss by notify_type).
    expect(sent[0]).toMatchObject({
      type: "extension_ui_request",
      id: "tool:tc_1",
      method: "notify",
      notify_type: "warning",
      message: "Unknown option value.",
    });
  });

  it("treats a successful submit-result as a no-op (completed drives dismissal)", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:submit-result", {
      version: 1,
      requestId: "r1",
      ok: true,
    });
    expect(sent).toHaveLength(0);
  });

  it("ignores malformed started events (never broadcasts)", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:started", { version: 1 }); // no flowId / questions
    bus.emit("@eko24ive/pi-ask:started", { version: 2, flowId: "x", questions: [] }); // wrong version
    bus.emit("@eko24ive/pi-ask:started", { version: 1, flowId: "z", questions: [] }); // no questions

    expect(sent).toHaveLength(0);
  });

  it("surfaces a zero-option (pure text) question as an input request", () => {
    // pi-ask's schema has no minItems on options — a question can be answered
    // by custom text alone. Must NOT be dropped (the mobile would stay silent).
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m))!;

    bus.emit("@eko24ive/pi-ask:started", {
      version: 1,
      flowId: "y",
      questions: [{ id: "q", prompt: "Describe the goal", type: "single", required: false, options: [] }],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "extension_ui_request",
      id: "y",
      method: "input",
      placeholder: "Describe the goal",
    });

    // Degraded reply (typed text, no matching label) lands as customText.
    bridge.respond({ type: "extension_ui_response", id: "y", value: "ship it" });
    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    const data = submits[0]?.data as {
      response: { answers: Record<string, unknown> };
    };
    expect(data.response.answers).toEqual({ q: { customText: "ship it" } });
  });

  it("routes a strict-client cancel (no ask envelope) via the request id", () => {
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
    bridge.respond({ type: "extension_ui_response", id: "tool:tc_1", cancelled: true });

    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    const data = submits[0]?.data as { flowId: string; response: { kind: string } };
    expect(data.flowId).toBe("tool:tc_1");
    expect(data.response).toEqual({ kind: "cancel" });
  });

  it("drops a strict-client cancel for an unknown flow id", () => {
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    bridge.respond({ type: "extension_ui_response", id: "never-seen", cancelled: true });

    expect(bus.emitted.filter((e) => e.name === SUBMIT)).toHaveLength(0);
  });

  it("drops a response for an unknown flow id (degraded path)", () => {
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    bridge.respond({ type: "extension_ui_response", id: "never-seen", value: "x" });

    expect(bus.emitted.filter((e) => e.name === SUBMIT)).toHaveLength(0);
  });

  it("forwards a BARE rich answer (no value/confirmed/cancelled) to pi-ask", () => {
    // This is the shape the app actually sends for a rich submit: only the ask
    // envelope, no discriminator. Routing must key off ask.kind alone.
    const bus = fakeBus();
    const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

    bridge.respond({
      type: "extension_ui_response",
      id: "tool:tc_1",
      ask: {
        flow_id: "tool:tc_1",
        kind: "answer",
        mode: "submit",
        answers: { goal: { values: ["a"] } },
      },
    });

    const submits = bus.emitted.filter((e) => e.name === SUBMIT);
    expect(submits).toHaveLength(1);
    expect(submits[0]?.data).toEqual({
      version: 1,
      requestId: "tool:tc_1",
      flowId: "tool:tc_1",
      response: {
        kind: "answer",
        mode: "submit",
        answers: { goal: { values: ["a"] } },
      },
    });
  });

  it("attributes a flowId-less submit-result to a single active flow", () => {
    // Defensive path: pi-ask always carries flowId, but if it's ever absent a
    // lone active flow is an unambiguous target — the app CAN correlate this.
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
    sent.length = 0;
    bus.emit("@eko24ive/pi-ask:submit-result", {
      version: 1,
      requestId: "r1",
      ok: false,
      message: "Nope.",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "extension_ui_request",
      id: "tool:tc_1",
      method: "notify",
      notify_type: "warning",
    });
  });

  it("drops a flowId-less submit-result when no flow is active (uncorrelatable)", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("@eko24ive/pi-ask:submit-result", {
      version: 1,
      requestId: "r1",
      ok: false,
      message: "Nope.",
    });

    // The app ignores unmatched notifies — broadcasting a random id is a no-op.
    expect(sent).toHaveLength(0);
  });

  describe("pendingRequests (session_sync replay)", () => {
    it("re-emits an open flow as the same request the broadcast carried", () => {
      const bus = fakeBus();
      const sent: ServerMessage[] = [];
      const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m))!;

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());

      // What a peer connecting late gets must equal what the live peer got —
      // same id, same envelope — or the app would treat it as a new flow.
      expect(bridge.pendingRequests()).toEqual(sent);
    });

    it("is empty before any flow and after the flow completes", () => {
      const bus = fakeBus();
      const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

      expect(bridge.pendingRequests()).toEqual([]);

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      expect(bridge.pendingRequests()).toHaveLength(1);

      // A resolved flow must NOT replay — otherwise every later sync would
      // reopen a modal the user already answered.
      bus.emit("@eko24ive/pi-ask:completed", { version: 1, flowId: "tool:tc_1" });
      expect(bridge.pendingRequests()).toEqual([]);
    });

    it("does not replay a flow dropped by the TTL", () => {
      vi.useFakeTimers();
      const bus = fakeBus();
      const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(bridge.pendingRequests()).toEqual([]);
      vi.useRealTimers();
    });

    it("replays every open flow, oldest first", () => {
      const bus = fakeBus();
      const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      bus.emit(
        "@eko24ive/pi-ask:started",
        singleQuestionFlow({ flowId: "tool:tc_2", toolCallId: "tc_2" }),
      );

      expect(bridge.pendingRequests().map((r) => r.id)).toEqual([
        "tool:tc_1",
        "tool:tc_2",
      ]);
    });

    it("stays answerable after a replay (flow state survives)", () => {
      const bus = fakeBus();
      const bridge = createExtensionUiBridge(fakePi(bus), () => {})!;

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      bridge.pendingRequests();

      // The degraded path needs activeFlows to map label→value; a replay that
      // consumed or mutated the flow would silently break the answer.
      bridge.respond({ type: "extension_ui_response", id: "tool:tc_1", value: "Alpha" });
      const submits = bus.emitted.filter((e) => e.name === SUBMIT);
      expect(submits).toHaveLength(1);
      expect(submits[0]?.data).toMatchObject({
        flowId: "tool:tc_1",
        response: { kind: "answer", answers: { goal: { values: ["a"] } } },
      });
    });
  });

  describe("flow TTL", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("warns the app (matching notify) when a flow's TTL expires", () => {
      vi.useFakeTimers();
      const bus = fakeBus();
      const sent: ServerMessage[] = [];
      const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m))!;

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      sent.length = 0;

      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        type: "extension_ui_request",
        id: "tool:tc_1",
        method: "notify",
        notify_type: "warning",
      });
      // ...and the flow is gone: a degraded response through the SAME bridge
      // is dropped (rich responses still work — they carry flow_id).
      bridge.respond({ type: "extension_ui_response", id: "tool:tc_1", value: "Alpha" });
      expect(bus.emitted.filter((e) => e.name === SUBMIT)).toHaveLength(0);
    });

    it("does NOT warn when the flow resolved before the TTL", () => {
      vi.useFakeTimers();
      const bus = fakeBus();
      const sent: ServerMessage[] = [];
      createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

      bus.emit("@eko24ive/pi-ask:started", singleQuestionFlow());
      bus.emit("@eko24ive/pi-ask:completed", { version: 1, flowId: "tool:tc_1" });
      sent.length = 0;

      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(sent).toHaveLength(0);
    });
  });
});

describe("extension_ui_bridge — generic UI prompts (plan/65)", () => {
  /** The setStatus controls the bridge forwarded, in order. */
  function statuses(sent: ServerMessage[]) {
    return sent
      .filter(
        (m): m is Extract<ServerMessage, { method: "setStatus" }> =>
          m.type === "extension_ui_request" && m.method === "setStatus",
      )
      .map((m) => ({ key: m.status_key, text: m.status_text }));
  }

  it("reports a waiting status when any extension opens a prompt", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("ui_prompt_start", {
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "select",
      title: "Pick a file",
    });

    expect(statuses(sent)).toEqual([{ key: "ui_prompt", text: "Waiting: Pick a file" }]);
  });

  it("falls back to the prompt kind when Pi omits the title", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    // Pi omits the `title` key entirely rather than sending an empty string.
    bus.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });

    expect(statuses(sent)).toEqual([{ key: "ui_prompt", text: "Waiting for a confirmation" }]);
  });

  it("clears the status when the prompt closes", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("ui_prompt_start", { kind: "input", title: "Name?" });
    bus.emit("ui_prompt_end", { kind: "input", title: "Name?" });

    expect(statuses(sent)).toEqual([
      { key: "ui_prompt", text: "Waiting: Name?" },
      // An absent status_text is how the app is told to drop the key.
      { key: "ui_prompt", text: undefined },
    ]);
  });

  it("ignores a malformed start and an end with nothing open", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("ui_prompt_end", { kind: "select" }); // no start to close
    bus.emit("ui_prompt_start", { kind: "nonsense" }); // unknown kind
    bus.emit("ui_prompt_start", {}); // missing kind

    expect(sent).toHaveLength(0);
  });

  it("replays the waiting status on sync while a prompt is open", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bus.emit("ui_prompt_start", { kind: "editor", title: "Commit message" });
    expect(bridge?.pendingRequests()).toEqual([
      expect.objectContaining({
        method: "setStatus",
        status_key: "ui_prompt",
        status_text: "Waiting: Commit message",
      }),
    ]);

    bus.emit("ui_prompt_end", { kind: "editor" });
    expect(bridge?.pendingRequests()).toEqual([]);
  });

  it("stops forwarding once disposed", () => {
    const bus = fakeBus();
    const sent: ServerMessage[] = [];
    const bridge = createExtensionUiBridge(fakePi(bus), (m) => sent.push(m));

    bridge?.dispose();
    bus.emit("ui_prompt_start", { kind: "select", title: "Late" });

    expect(sent).toHaveLength(0);
  });
});
