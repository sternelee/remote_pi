/**
 * Notification decisions.
 *
 * The rules that matter are the negative ones: a replaced timeline must not
 * re-notify for turns the user already read, and a visible tab must not raise
 * an OS notification for something the user is watching.
 */

import { describe, expect, it } from "vitest";

import {
  entryKey,
  isAppendOnly,
  notificationsFor,
  shouldRaise,
  titleWithUnread,
} from "../lib/session/notify";
import {
  applyMessage,
  emptyTranscript,
  timelineFromHistory,
  type TimelineEntry,
  type TranscriptState,
} from "../lib/session/transcript";
import type { ServerMessage } from "../lib/protocol/types";

const LABEL = "remote_pi";

function fold(messages: ServerMessage[], from: TranscriptState = emptyTranscript): TranscriptState {
  return messages.reduce(applyMessage, from);
}

/** A finished turn: a user message plus a complete agent reply. */
function finishedTurn(id = "turn-1", text = "the answer is 42"): TranscriptState {
  return fold([
    { type: "user_message", id, text: "question" },
    { type: "agent_chunk", in_reply_to: id, delta: text },
    { type: "agent_done", in_reply_to: id },
  ]);
}

describe("isAppendOnly", () => {
  it("accepts an appended timeline", () => {
    const prev = finishedTurn();
    const next = fold([{ type: "agent_chunk", in_reply_to: "turn-2", delta: "hi" }], prev);
    expect(isAppendOnly(prev, next)).toBe(true);
  });

  it("rejects a replaced timeline (history mirror)", () => {
    const replaced = fold([
      { type: "user_message", id: "other", text: "old turn" },
      { type: "agent_message", in_reply_to: "other", text: "old answer" },
    ]);
    expect(isAppendOnly(finishedTurn(), replaced)).toBe(false);
  });

  it("rejects a truncated timeline", () => {
    expect(isAppendOnly(finishedTurn(), emptyTranscript)).toBe(false);
  });
});

describe("notificationsFor", () => {
  it("fires once when a turn finishes", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "working" },
    ]);
    const done = applyMessage(streaming, { type: "agent_done", in_reply_to: "t" });

    const events = notificationsFor(streaming, done, LABEL);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "turn_done", title: `${LABEL} finished` });
    expect(events[0].body).toContain("working");
  });

  it("does not fire when nothing changed", () => {
    const done = finishedTurn();
    expect(notificationsFor(done, done, LABEL)).toEqual([]);
  });

  it("does not fire while a turn is still streaming", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "a" },
    ]);
    const more = applyMessage(streaming, { type: "agent_chunk", in_reply_to: "t", delta: "b" });
    expect(notificationsFor(streaming, more, LABEL)).toEqual([]);
  });

  it("announces a question instead of a finished turn", () => {
    const prev = fold([{ type: "user_message", id: "t", text: "q" }]);
    const next = applyMessage(prev, {
      type: "extension_ui_request",
      id: "req-1",
      method: "select",
      title: "Which env?",
      options: ["staging", "prod"],
    });
    const events = notificationsFor(prev, next, LABEL);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "question", title: `${LABEL} needs an answer` });
  });

  it("announces an error", () => {
    const prev = finishedTurn();
    const next = applyMessage(prev, { type: "error", code: "internal_error", message: "boom" });
    const events = notificationsFor(prev, next, LABEL);
    expect(events[0]).toMatchObject({ kind: "error", title: `${LABEL} hit an error` });
    expect(events[0].body).toBe("internal_error: boom");
  });

  it("stays quiet when a replayed mirror replaces the timeline", () => {
    const prev = finishedTurn();
    const mirrored = fold([
      { type: "user_message", id: "a", text: "one" },
      { type: "agent_message", in_reply_to: "a", text: "first" },
      { type: "user_message", id: "b", text: "two" },
      { type: "agent_message", in_reply_to: "b", text: "second" },
    ]);
    expect(notificationsFor(prev, mirrored, LABEL)).toEqual([]);
  });

  it("stays quiet when a new session empties the timeline", () => {
    expect(notificationsFor(finishedTurn(), emptyTranscript, LABEL)).toEqual([]);
  });

  it("truncates a long answer in the body", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "x".repeat(400) },
    ]);
    const done = applyMessage(streaming, { type: "agent_done", in_reply_to: "t" });
    const body = notificationsFor(streaming, done, LABEL)[0].body;
    expect(body.length).toBeLessThanOrEqual(140);
    expect(body.endsWith("…")).toBe(true);
  });

  it("collapses newlines in the body", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "line one\n\n  line two" },
    ]);
    const done = applyMessage(streaming, { type: "agent_done", in_reply_to: "t" });
    expect(notificationsFor(streaming, done, LABEL)[0].body).toBe("line one line two");
  });

  it("fires for a turn whose only output was reasoning and tools", () => {
    // The false negative the state-shape gate introduced: `agent_done` CREATES
    // the agent entry when no chunk ever streamed, so there was no
    // streaming -> settled entry to detect and the completion went silent.
    const before = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_thinking_chunk", in_reply_to: "t", delta: "considering…" },
      { type: "tool_request", tool_call_id: "tc-1", tool: "Read", args: { file_path: "a.ts" } },
      { type: "tool_result", tool_call_id: "tc-1", result: "42 lines" },
    ]);
    const after = applyMessage(before, { type: "agent_done", in_reply_to: "t" });

    const events = notificationsFor(before, after, LABEL);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "turn_done", key: "turn:t" });
    expect(events[0].body).toBe("The turn is complete.");
  });

  it("does not fire on `bye`", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "partial" },
    ]);
    const ended = applyMessage(streaming, { type: "bye", reason: "peer_stop" });
    expect(notificationsFor(streaming, ended, LABEL)).toEqual([]);
  });

  it("does not fire on `cancelled`", () => {
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "partial" },
    ]);
    const cancelled = applyMessage(streaming, { type: "cancelled", in_reply_to: "c", target_id: "t" });
    expect(notificationsFor(streaming, cancelled, LABEL)).toEqual([]);
  });

  it("fires once, not twice, when an error is followed by the turn's agent_done", () => {
    // The double notification the state-shape gate introduced: `error` clears
    // `working` without settling the entry, so the later `agent_done` settled it
    // and announced a truncated partial answer as the finished turn.
    const streaming = fold([
      { type: "user_message", id: "t", text: "q" },
      { type: "agent_chunk", in_reply_to: "t", delta: "partial ans" },
    ]);
    const errored = applyMessage(streaming, {
      type: "error",
      in_reply_to: "t",
      code: "rate_limited",
      message: "slow down",
    });
    expect(notificationsFor(streaming, errored, LABEL).map((e) => e.kind)).toEqual(["error"]);

    const settled = applyMessage(errored, { type: "agent_done", in_reply_to: "t" });
    expect(notificationsFor(errored, settled, LABEL)).toEqual([]);
  });

  it("does not fire for a completion replayed by a session_history mirror", () => {
    // A mirror is a replay: `timelineFromHistory` clears `lastTurnEnd`, and
    // `isAppendOnly` rejects the replaced timeline.
    const prev = finishedTurn("older", "an earlier answer");
    const mirrored = timelineFromHistory({
      type: "session_history",
      in_reply_to: "sync-1",
      session_started_at: Date.now(),
      events: [
        { ts: 1, type: "user_message", id: "t", text: "q" },
        { ts: 2, type: "agent_message", in_reply_to: "t", text: "the replayed answer" },
      ],
      eos: true,
      truncated: false,
    });
    expect(mirrored.lastTurnEnd).toBeUndefined();
    expect(notificationsFor(prev, mirrored, LABEL)).toEqual([]);
  });
});

describe("shouldRaise", () => {
  const granted = "granted" as const;

  it("raises only when enabled, granted and hidden", () => {
    expect(shouldRaise({ enabled: true, permission: granted, hidden: true })).toBe(true);
    expect(shouldRaise({ enabled: false, permission: granted, hidden: true })).toBe(false);
    expect(shouldRaise({ enabled: true, permission: granted, hidden: false })).toBe(false);
    expect(shouldRaise({ enabled: true, permission: "default", hidden: true })).toBe(false);
    expect(shouldRaise({ enabled: true, permission: "denied", hidden: true })).toBe(false);
    expect(shouldRaise({ enabled: true, permission: "unsupported", hidden: true })).toBe(false);
  });
});

describe("titleWithUnread", () => {
  it("prefixes the count and restores the bare title at zero", () => {
    expect(titleWithUnread(0)).toBe("Remote Pi");
    expect(titleWithUnread(3)).toBe("(3) Remote Pi");
    expect(titleWithUnread(1, "remote_pi")).toBe("(1) remote_pi");
  });
});

describe("timeline entry keys", () => {
  /**
   * The real risk this guards: a `kind` missing from the internal key map would
   * make an appended entry look like a replacement, which both suppresses a
   * legitimate notification and re-notifies on every mirror. So drive one entry
   * of EVERY kind through the real reducer and assert the append is detected.
   *
   * (An earlier version of this test compared a locally declared array against
   * itself — a tautology that never called the key function.)
   */
  const perKind: [TimelineEntry["kind"], ServerMessage[]][] = [
    ["user", [{ type: "user_message", id: "k-user", text: "hi" }]],
    ["agent", [{ type: "agent_chunk", in_reply_to: "t", delta: "d" }]],
    ["thinking", [{ type: "agent_thinking_chunk", in_reply_to: "t", delta: "hmm" }]],
    ["custom", [{ type: "custom_message", custom_type: "plugin:note", content: "note", display: true }]],
    ["tool", [{ type: "tool_request", tool_call_id: "k-tool", tool: "Bash", args: { command: "ls" } }]],
    ["diff", [
      { type: "tool_request", tool_call_id: "k-diff", tool: "Edit", args: { file_path: "a.ts" } },
      { type: "tool_result", tool_call_id: "k-diff", result: "@@ -1,1 +1,2 @@\n keep\n+added" },
    ]],
    ["compaction", [{ type: "compaction", summary: "s", tokens_before: 10 }]],
    ["error", [{ type: "error", code: "internal_error", message: "boom" }]],
    ["event", [{ type: "bye", reason: "peer_stop" }]],
    ["question", [
      { type: "extension_ui_request", id: "k-q", method: "select", title: "Pick", options: ["a"] },
    ]],
  ];

  it.each(perKind)("detects an appended %s entry", (kind, messages) => {
    const prev = finishedTurn();
    const next = fold(messages, prev);

    // The appended tail, not every entry of this kind: the baseline already
    // holds a user and an agent entry.
    const added = next.entries.slice(prev.entries.length);
    expect(added, `the reducer produced no ${kind} entry`).toHaveLength(1);
    expect(added[0].kind).toBe(kind);

    // The append must be recognised, and must not look like a mirror.
    expect(isAppendOnly(prev, next), `${kind} append looked like a replacement`).toBe(true);
    expect(entryKey(added[0])).toContain(`${kind}:`);
  });

  it("keys every kind to a distinct namespace", () => {
    const keys = perKind.map(([, messages]) => {
      const prev = finishedTurn();
      const state = fold(messages, prev);
      return entryKey(state.entries[prev.entries.length]);
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});
