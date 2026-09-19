import { describe, expect, it } from "vitest";

import {
  addLocalUserMessage,
  applyMessage,
  emptyTranscript,
  failStalePending,
  markAnswered,
  parseUnifiedDiff,
  questionsOf,
  summarizeToolArg,
  timelineFromHistory,
  type TranscriptState,
} from "../lib/session/transcript";
import type { ServerMessage } from "../lib/protocol/types";
import { fixture, readFixture } from "./fixtures";

/** Fold a list of messages through the reducer, like the live session does. */
function fold(messages: ServerMessage[]): TranscriptState {
  return messages.reduce(applyMessage, emptyTranscript);
}

function byKind(state: TranscriptState, kind: string) {
  return state.entries.filter((e) => e.kind === kind);
}

describe("streaming a turn", () => {
  it("accumulates agent_chunk deltas into one message and closes on agent_done", () => {
    const stream = readFixture("agent_stream") as ServerMessage[];
    const state = fold(stream);

    const agents = byKind(state, "agent");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      kind: "agent",
      text: "Vou olhar o middleware...",
      streaming: false,
    });
    expect(state.working).toBe(false);
  });

  it("reports the turn as working while chunks are arriving", () => {
    const stream = readFixture("agent_stream") as ServerMessage[];
    const midTurn = fold(stream.slice(0, 1));
    expect(midTurn.working).toBe(true);
    expect(byKind(midTurn, "agent")[0]).toMatchObject({ streaming: true, text: "Vou olhar o " });
  });

  it("carries usage from agent_done", () => {
    const state = fold(readFixture("agent_stream") as ServerMessage[]);
    expect(byKind(state, "agent")[0]).toMatchObject({
      usage: { input_tokens: 120, output_tokens: 340 },
    });
  });

  it("keys the agent message on in_reply_to, so two turns stay separate", () => {
    const state = fold([
      { type: "agent_chunk", in_reply_to: "turn-1", delta: "a" },
      { type: "agent_done", in_reply_to: "turn-1" },
      { type: "agent_chunk", in_reply_to: "turn-2", delta: "b" },
    ]);
    expect(byKind(state, "agent")).toHaveLength(2);
    expect(byKind(state, "agent").map((e) => (e as { text: string }).text)).toEqual(["a", "b"]);
  });

  it("replaces the text when a consolidated agent_message arrives (history shape)", () => {
    const consolidated = fixture<Extract<ServerMessage, { type: "agent_message" }>>("agent_message");
    const state = fold([
      { type: "agent_chunk", in_reply_to: consolidated.in_reply_to, delta: "partial" },
      consolidated,
    ]);
    expect(byKind(state, "agent")).toHaveLength(1);
    expect(byKind(state, "agent")[0]).toMatchObject({
      text: consolidated.text,
      streaming: false,
    });
  });
});

describe("user messages", () => {
  it("renders user_input as a user entry", () => {
    const state = fold([fixture<ServerMessage>("user_input")]);
    expect(byKind(state, "user")[0]).toMatchObject({ kind: "user" });
  });

  it("treats the user_message echo as confirmation, not a duplicate", () => {
    const id = "018f9c2a-7b1e-7000-9a3b-1c2d3e4f5a6e";
    const optimistic = addLocalUserMessage(emptyTranscript, id, "hello");
    expect(byKind(optimistic, "user")).toHaveLength(1);

    const echoed = applyMessage(optimistic, { type: "user_message", id, text: "hello" });
    expect(byKind(echoed, "user")).toHaveLength(1);
  });

  it("keeps images from the echo", () => {
    const state = fold([
      {
        type: "user_message",
        id: "with-image",
        text: "look",
        images: [{ data: "AAAA", mime: "image/jpeg" }],
      },
    ]);
    expect(byKind(state, "user")[0]).toMatchObject({ images: [{ mime: "image/jpeg" }] });
  });
});

describe("message delivery lifecycle", () => {
  it("marks an optimistic send pending with a timestamp", () => {
    const state = addLocalUserMessage(emptyTranscript, "id-1", "hello", { now: 1000 });
    expect(byKind(state, "user")[0]).toMatchObject({ status: "pending", sentAt: 1000 });
  });

  it("confirms the message once the Pi echoes it", () => {
    const optimistic = addLocalUserMessage(emptyTranscript, "id-1", "hello", { now: 1000 });
    const echoed = applyMessage(optimistic, { type: "user_message", id: "id-1", text: "hello" });
    expect(byKind(echoed, "user")).toHaveLength(1);
    expect(byKind(echoed, "user")[0]).toMatchObject({ status: "confirmed" });
  });

  it("treats inbound and replayed messages as already delivered", () => {
    const state = fold([fixture<ServerMessage>("user_input")]);
    expect(byKind(state, "user")[0]).toMatchObject({ status: "confirmed" });
  });

  it("fails only the pending messages past the reap window", () => {
    const stale = addLocalUserMessage(emptyTranscript, "old", "stale", { now: 1000 });
    const withFresh = addLocalUserMessage(stale, "new", "fresh", { now: 25_000 });

    const reaped = failStalePending(withFresh, 21_500, 20_000);
    expect(reaped.entries.find((e) => e.id === "old")).toMatchObject({ status: "failed" });
    expect(reaped.entries.find((e) => e.id === "new")).toMatchObject({ status: "pending" });
  });

  it("returns the same state when nothing is stale", () => {
    const state = addLocalUserMessage(emptyTranscript, "id-1", "hello", { now: 1000 });
    expect(failStalePending(state, 1500, 20_000)).toBe(state);
  });

  it("never fails a message the Pi already confirmed", () => {
    const optimistic = addLocalUserMessage(emptyTranscript, "id-1", "hello", { now: 1000 });
    const confirmed = applyMessage(optimistic, { type: "user_message", id: "id-1", text: "hello" });
    const reaped = failStalePending(confirmed, 999_999, 20_000);
    expect(reaped.entries[0]).toMatchObject({ status: "confirmed" });
  });
});

describe("tool calls", () => {
  it("pairs a tool_request with its tool_result by tool_call_id", () => {
    const state = fold([
      { type: "tool_request", tool_call_id: "tc_1", tool: "Bash", args: { command: "ls" } },
      { type: "tool_result", tool_call_id: "tc_1", result: "a\nb" },
    ]);
    const tools = byKind(state, "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ tool: "Bash", arg: "ls", status: "success", output: "a\nb" });
  });

  it("marks a failed result as an error", () => {
    const state = fold([
      { type: "tool_request", tool_call_id: "tc_2", tool: "Bash", args: { command: "sleep 99" } },
      { type: "tool_result", tool_call_id: "tc_2", error: "command timed out after 60s" },
    ]);
    expect(byKind(state, "tool")[0]).toMatchObject({
      status: "error",
      output: "command timed out after 60s",
    });
  });

  it("leaves a request pending until its result lands", () => {
    const state = fold([
      { type: "tool_request", tool_call_id: "tc_3", tool: "Read", args: { file_path: "/a/b.ts" } },
    ]);
    expect(byKind(state, "tool")[0]).toMatchObject({ status: "pending", arg: "/a/b.ts" });
  });

  it("accepts a result with no matching request (history can start mid-turn)", () => {
    const state = fold([{ type: "tool_result", tool_call_id: "orphan", result: "ok" }]);
    expect(byKind(state, "tool")[0]).toMatchObject({ status: "success", output: "ok" });
  });

  it("renders a unified diff result as a diff block", () => {
    const diff = ["@@ -1,3 +1,4 @@", " ctx", "-old", "+new", "+extra"].join("\n");
    const state = fold([
      { type: "tool_request", tool_call_id: "tc_4", tool: "Edit", args: { file_path: "lib/a.ts" } },
      { type: "tool_result", tool_call_id: "tc_4", result: diff },
    ]);
    const diffs = byKind(state, "diff");
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ file: "lib/a.ts" });
    expect((diffs[0] as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
  });
});

describe("parseUnifiedDiff", () => {
  it("returns null for ordinary output", () => {
    expect(parseUnifiedDiff("removed 1247 files")).toBeNull();
    expect(parseUnifiedDiff("+ looks like a diff\n- but has no hunk header")).toBeNull();
    expect(parseUnifiedDiff("@@ -1,3 +1,3 @@\n only context")).toBeNull();
  });

  it("parses hunks, tracking the new-side line number", () => {
    const lines = parseUnifiedDiff(
      ["--- a/f.ts", "+++ b/f.ts", "@@ -10,3 +10,4 @@", " keep", "-gone", "+added", "+more"].join(
        "\n",
      ),
    );
    expect(lines).not.toBeNull();
    expect(lines?.map((l) => l.type)).toEqual(["ctx", "ctx", "del", "add", "add"]);
    expect(lines?.find((l) => l.type === "add")).toMatchObject({ text: "added", num: 11 });
  });
});

describe("summarizeToolArg", () => {
  it("prefers the command, then a path, then a pattern", () => {
    expect(summarizeToolArg("Bash", { command: "git status -s" })).toBe("git status -s");
    expect(summarizeToolArg("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(summarizeToolArg("Grep", { pattern: "foo", path: "src" })).toBe("foo");
  });

  it("collapses whitespace and truncates long values", () => {
    expect(summarizeToolArg("Bash", { command: "a\n   b" })).toBe("a b");
    const long = summarizeToolArg("Bash", { command: "x".repeat(500) });
    expect(long?.endsWith("…")).toBe(true);
    expect(long?.length).toBeLessThanOrEqual(118);
  });

  it("returns undefined for an empty argument object", () => {
    expect(summarizeToolArg("Bash", {})).toBeUndefined();
  });
});

describe("session_history", () => {
  it("replaces the timeline with the mirror", () => {
    const history = fixture<Extract<ServerMessage, { type: "session_history" }>>("session_history");
    const state = timelineFromHistory(history);

    // The fixture carries user_input, tool_request, tool_result, agent_message.
    expect(byKind(state, "user")).toHaveLength(1);
    expect(byKind(state, "tool")).toHaveLength(1);
    expect(byKind(state, "agent")).toHaveLength(1);
    expect(state.sessionStartedAt).toBe(history.session_started_at);
  });

  it("discards anything already in the timeline (mirror, not delta)", () => {
    const dirty = fold([{ type: "agent_chunk", in_reply_to: "stale", delta: "old" }]);
    const history = fixture<Extract<ServerMessage, { type: "session_history" }>>("session_history");
    const state = applyMessage(dirty, history);
    expect(byKind(state, "agent").some((e) => (e as { id: string }).id === "stale")).toBe(false);
  });
});

describe("errors, cancel and bye", () => {
  it("renders every error fixture line", () => {
    const state = fold(readFixture("error") as ServerMessage[]);
    expect(byKind(state, "error")).toHaveLength(3);
    expect(byKind(state, "error")[0]).toMatchObject({ code: "tool_approval_required" });
  });

  it("marks the targeted turn cancelled and stops the working state", () => {
    const target = "018f9c2a-7b1e-7000-9a3b-1c2d3e4f5a6e";
    const state = fold([
      { type: "agent_chunk", in_reply_to: target, delta: "thinking" },
      fixture<ServerMessage>("cancelled"),
    ]);
    expect(state.working).toBe(false);
    expect(byKind(state, "agent")[0]).toMatchObject({ cancelled: true, streaming: false });
  });

  it("records bye as an event", () => {
    const state = fold([fixture<ServerMessage>("bye")]);
    expect(byKind(state, "event")[0]).toMatchObject({ label: "session ended", detail: "peer_stop" });
  });
});

describe("compaction", () => {
  it("renders a compaction summary", () => {
    const state = fold([
      { type: "compaction", summary: "condensed 40 turns", tokens_before: 92_000 },
    ]);
    expect(byKind(state, "compaction")[0]).toMatchObject({
      summary: "condensed 40 turns",
      tokensBefore: 92_000,
    });
  });
});

describe("interactive prompts", () => {
  it("normalizes an SDK select into one question", () => {
    const { questions } = questionsOf({
      type: "extension_ui_request",
      id: "q1",
      method: "select",
      title: "Pick a target",
      options: ["staging", "prod"],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      type: "single",
      required: true,
      // Without the ask envelope the label doubles as the value the Pi maps back.
      options: [
        { value: "staging", label: "staging" },
        { value: "prod", label: "prod" },
      ],
    });
  });

  it("maps a confirm to a Yes/No question", () => {
    const { body, questions } = questionsOf({
      type: "extension_ui_request",
      id: "q2",
      method: "confirm",
      title: "Deploy?",
      message: "This touches prod.",
    });
    expect(body).toBe("This touches prod.");
    expect(questions[0].options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("gives notify a title instead of an empty legend", () => {
    const { title, body } = questionsOf({
      type: "extension_ui_request",
      id: "q3",
      method: "notify",
      message: "Build finished",
    });
    expect(title).toBe("notice");
    expect(body).toBe("Build finished");
  });

  it("marks input/editor as freeform", () => {
    const { questions } = questionsOf({
      type: "extension_ui_request",
      id: "q4",
      method: "input",
      title: "Branch name",
      placeholder: "feature/…",
    });
    expect(questions[0]).toMatchObject({ freeform: true, options: [] });
  });

  it("prefers the pi-ask enrichment, keeping real option values", () => {
    const { title, questions } = questionsOf({
      type: "extension_ui_request",
      id: "q5",
      method: "select",
      title: "degraded",
      options: ["a"],
      ask: {
        flow_id: "f1",
        tool_call_id: null,
        source: "tool",
        title: "Which database?",
        questions: [
          {
            id: "db",
            label: "Database",
            prompt: "Pick one to inspect",
            type: "multi",
            required: true,
            options: [
              { value: "pg", label: "Postgres", description: "sql" },
              { value: "my", label: "MySQL", preview: "SELECT 1;" },
            ],
          },
        ],
      },
    });
    expect(title).toBe("Which database?");
    expect(questions[0]).toMatchObject({
      id: "db",
      type: "multi",
      options: [
        { value: "pg", label: "Postgres", description: "sql" },
        { value: "my", label: "MySQL", preview: "SELECT 1;" },
      ],
    });
  });

  it("keeps the flow id so a rich answer can be addressed", () => {
    const state = fold([
      {
        type: "extension_ui_request",
        id: "req-1",
        method: "select",
        title: "Pick",
        options: ["one"],
        ask: {
          flow_id: "flow-9",
          tool_call_id: null,
          source: "tool",
          title: null,
          questions: [
            { id: "q", label: "Q", prompt: "p", type: "single", required: true, options: [{ value: "v", label: "L" }] },
          ],
        },
      },
    ]);
    expect(byKind(state, "question")[0]).toMatchObject({ id: "req-1", flowId: "flow-9" });
  });

  it("records the chosen answer and stops offering the prompt", () => {
    const state = fold([
      {
        type: "extension_ui_request",
        id: "q6",
        method: "select",
        title: "Pick",
        options: ["one", "two"],
      },
    ]);
    expect(byKind(state, "question")[0]).not.toHaveProperty("answered");

    const answered = markAnswered(state, "q6", "two");
    expect(byKind(answered, "question")[0]).toMatchObject({ answered: "two" });
  });

  it("records a cancellation distinctly from an answer", () => {
    const state = fold([
      { type: "extension_ui_request", id: "q7", method: "confirm", title: "Go?", message: "sure?" },
    ]);
    const cancelled = markAnswered(state, "q7", "cancelled", true);
    expect(byKind(cancelled, "question")[0]).toMatchObject({ answered: "cancelled", cancelled: true });
  });
});

describe("steering", () => {
  const id = "018f9c2a-7b1e-7000-9a3b-1c2d3e4f5a6e";

  it("marks an optimistic message sent while the turn runs", () => {
    const state = addLocalUserMessage(emptyTranscript, id, "wait, also do X", { steering: true });
    expect(byKind(state, "user")[0]).toMatchObject({ steering: true });
    expect(byKind(state, "user")[0]).not.toHaveProperty("steerConsumed");
  });

  it("keeps the steering flag when the echo confirms the message", () => {
    const optimistic = addLocalUserMessage(emptyTranscript, id, "steer me", { steering: true });
    const echoed = applyMessage(optimistic, {
      type: "user_message",
      id,
      text: "steer me",
      streaming_behavior: "steer",
    });
    expect(byKind(echoed, "user")).toHaveLength(1);
    expect(byKind(echoed, "user")[0]).toMatchObject({ steering: true });
  });

  it("marks the steer consumed when the Pi folds it into the live turn", () => {
    const state = applyMessage(
      addLocalUserMessage(emptyTranscript, id, "steer me", { steering: true }),
      { type: "steer_consumed", id },
    );
    expect(byKind(state, "user")[0]).toMatchObject({ steering: true, steerConsumed: true });
  });

  it("ignores steer_consumed for an unknown id", () => {
    const state = fold([{ type: "steer_consumed", id: "nobody" }]);
    expect(state.entries).toHaveLength(0);
  });
});

describe("action and queue replies", () => {
  it("keeps models_list, action_* and queued_message_state out of the transcript", () => {
    const before = fold([{ type: "agent_chunk", in_reply_to: "x", delta: "keep" }]);
    for (const message of [
      { type: "models_list", in_reply_to: "m", models: [] },
      { type: "action_ok", in_reply_to: "a", action: "session_compact" },
      { type: "action_error", in_reply_to: "b", action: "model_set", error: "nope" },
      { type: "queued_message_state", items: [] },
    ] as ServerMessage[]) {
      expect(applyMessage(before, message)).toBe(before);
    }
  });
});

describe("non-transcript messages", () => {
  it("leaves the timeline untouched for pair/pong/models_list", () => {
    const before = fold([{ type: "agent_chunk", in_reply_to: "x", delta: "keep" }]);
    for (const message of [
      fixture<ServerMessage>("pair_ok"),
      fixture<ServerMessage>("pong"),
      { type: "models_list", in_reply_to: "m", models: [] },
    ] as ServerMessage[]) {
      expect(applyMessage(before, message)).toBe(before);
    }
  });
});
