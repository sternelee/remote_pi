/**
 * Transcript reducer: protocol messages → renderable timeline.
 *
 * Pure functions, no React and no I/O, so `test/transcript.test.ts` can drive
 * them straight from the shared `.orchestration/contracts/fixtures`.
 *
 * Correlation rules (from `protocol.md`):
 *   - `agent_chunk`/`agent_done`/`agent_message` correlate by `in_reply_to`,
 *     which is the id of the originating `user_message`/`user_input`.
 *   - `tool_result` correlates to its `tool_request` by `tool_call_id`.
 *   - `session_history` is a **mirror**, not a delta — it replaces the
 *     timeline wholesale.
 */

import type {
  ExtensionUiMethod,
  ServerMessage,
  SessionHistoryEvent,
  Usage,
  WireImage,
} from "../protocol/types";
import { isUiControl } from "./ui_control";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  /** 1-based line number on the new side, when known. */
  num?: number;
  text: string;
}

export type TimelineEntry =
  | {
      kind: "user";
      id: string;
      text: string;
      images?: WireImage[];
      /** Sent with `streaming_behavior: "steer"` into a running turn. */
      steering?: boolean;
      /** The Pi confirmed it took the steer into the live turn. */
      steerConsumed?: boolean;
      /**
       * Delivery lifecycle. Optimistic sends start `pending` and flip to
       * `confirmed` when the Pi echoes the message back; a `pending` entry that
       * outlives the reap window becomes `failed` (the app's "not delivered").
       * History replay and inbound messages arrive already `confirmed`.
       */
      status?: "pending" | "confirmed" | "failed";
      /** Local clock ms when the optimistic entry was created, for reaping. */
      sentAt?: number;
      ts?: number;
    }
  | {
      kind: "agent";
      id: string;
      text: string;
      streaming: boolean;
      cancelled?: boolean;
      usage?: Usage;
      ts?: number;
    }
  | {
      kind: "thinking";
      id: string;
      text: string;
      streaming: boolean;
      ts?: number;
    }
  | {
      /**
       * Plugin-authored message (`pi.sendMessage`, `role: "custom"`). Surfaced
       * so extensions like pi-subagents / rpiv-todo can post to the timeline.
       * `display: false` targets the model and is not rendered.
       */
      kind: "custom";
      id: string;
      customType: string;
      text: string;
      display: boolean;
      details?: unknown;
      ts?: number;
    }
  | {
      kind: "tool";
      id: string;
      tool: string;
      arg?: string;
      /** Raw arguments, kept so a diff result can name the file it touched. */
      args?: Record<string, unknown>;
      status: "pending" | "success" | "error";
      /** Raw result/error text — rendered inside the expandable body. */
      output?: string;
      ts?: number;
    }
  | { kind: "diff"; id: string; file: string; summary?: string; lines: DiffLine[]; ts?: number }
  | { kind: "compaction"; id: string; summary: string; tokensBefore: number; ts?: number }
  | { kind: "error"; id: string; code: string; message: string; ts?: number }
  | { kind: "event"; id: string; label: string; detail?: string; ts?: number }
  | {
      kind: "question";
      /** The request id — must be echoed verbatim on `extension_ui_response`. */
      id: string;
      method: ExtensionUiMethod;
      title: string;
      body?: string;
      questions: QuestionView[];
      /** pi-ask flow id, when the prompt carried an `ask` envelope. */
      flowId?: string;
      /** Set once answered; the prompt renders as resolved instead. */
      answered?: string;
      cancelled?: boolean;
      ts?: number;
    };

/**
 * A prompt question normalized from either wire shape.
 *
 * With a pi-ask `ask` envelope the options carry real `value`s (what the Pi
 * wants back) plus optional previews. Without it, the SDK `select` only has
 * labels — the Pi maps a label back to a value itself, so `value` mirrors the
 * label in that case.
 */
export interface QuestionView {
  id: string;
  label: string;
  prompt: string;
  type: "single" | "multi" | "preview";
  required: boolean;
  options: { value: string; label: string; description?: string; preview?: string }[];
  /** pi-ask: the question accepts a free-text answer. */
  freeform?: boolean;
}

export interface TranscriptState {
  entries: TimelineEntry[];
  /** Pi process start time from `pair_ok`/`session_history`, for restart detection. */
  sessionStartedAt?: number;
  /** True while the Pi is producing a turn. */
  working: boolean;
  /**
   * How the most recent turn ended, and which turn.
   *
   * This carries the protocol's own completion signal (`agent_done`) instead of
   * leaving the notification layer to infer one from entry shapes — a turn whose
   * only output was reasoning or tool calls still reports a completion that way.
   *
   * A replayed mirror must NOT set it: history is a replay, not a fresh turn.
   */
  lastTurnEnd?: { id: string; reason: "done" | "cancelled" | "error" };
}

export const emptyTranscript: TranscriptState = { entries: [], working: false };

// ── helpers ────────────────────────────────────────────────────────────────

function upsert<T extends TimelineEntry>(
  entries: TimelineEntry[],
  match: (e: TimelineEntry) => boolean,
  create: () => T,
  patch: (e: T) => T,
): TimelineEntry[] {
  const index = entries.findIndex(match);
  if (index === -1) return [...entries, create()];
  const next = entries.slice();
  next[index] = patch(next[index] as T);
  return next;
}

/** Settle the reasoning stream for a turn once it is done or cancelled. */
function finishThinking(entries: TimelineEntry[], turnId: string): TimelineEntry[] {
  const id = `thinking-${turnId}`;
  const index = entries.findIndex((e) => e.kind === "thinking" && e.id === id);
  if (index === -1) return entries;
  const next = entries.slice();
  next[index] = { ...(next[index] as Extract<TimelineEntry, { kind: "thinking" }>), streaming: false };
  return next;
}

/** Compact one-line summary of a tool's arguments, for the `Tool(arg)` line. */
export function summarizeToolArg(tool: string, args: Record<string, unknown>): string | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  };

  const value =
    pick(
      "command",
      "file_path",
      "filePath",
      "file",
      "pattern",
      "path",
      "query",
      "url",
      "prompt",
    ) ?? (Object.keys(args).length > 0 ? JSON.stringify(args) : undefined);

  if (value === undefined) return undefined;
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

/**
 * Strict unified-diff detection for tool output.
 *
 * Pi's edit tools return diff text, but `tool_result.result` is an opaque
 * string on the wire — there is no structured diff field. This only claims a
 * diff when the text really looks like one (an `@@` hunk header plus at least
 * one `+`/`-` body line); otherwise the caller falls back to plain text.
 */
export function parseUnifiedDiff(text: string): DiffLine[] | null {
  const lines = text.split("\n");
  const hasHunk = lines.some((l) => l.startsWith("@@"));
  if (!hasHunk) return null;

  const body = lines.filter(
    (l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")),
  );
  if (body.length === 0) return null;

  const out: DiffLine[] = [];
  let lineNo = 0;
  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      if (match) lineNo = Number(match[1]);
      out.push({ type: "ctx", text: raw });
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      out.push({ type: "add", num: lineNo++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ type: "del", text: raw.slice(1) });
    } else {
      out.push({ type: "ctx", num: lineNo++, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return out;
}

/** Filename a tool acted on, for the diff header. */
function diffFileFor(tool: string, args: Record<string, unknown>): string {
  for (const key of ["file_path", "filePath", "path", "file"]) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return tool;
}

/**
 * Normalize an interactive prompt from either wire shape.
 *
 * A pi-ask `ask` envelope carries real option values (and previews, and the
 * multi/freeform flags); the bare SDK shape only has labels. Both end up in the
 * same `QuestionView[]` so the UI has one thing to render.
 */
export function questionsOf(message: Extract<ServerMessage, { type: "extension_ui_request" }>): {
  method: ExtensionUiMethod;
  title: string;
  body?: string;
  questions: QuestionView[];
} {
  // One-way display controls carry no question. The session layer folds them
  // into `UiControlState` before the transcript sees them; this keeps the
  // function total for any direct caller.
  if (isUiControl(message)) {
    return { method: message.method, title: "", questions: [] };
  }

  if (message.ask && message.ask.questions.length > 0) {
    return {
      method: message.method,
      title: message.ask.title ?? message.ask.questions[0].label,
      body: undefined,
      questions: message.ask.questions.map((q) => ({
        id: q.id,
        label: q.label,
        prompt: q.prompt,
        type: q.presentedType ?? q.type,
        required: q.required,
        freeform: q.options.some((o) => o.freeform),
        options: q.options.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
          preview: o.preview,
        })),
      })),
    };
  }

  // Degraded: the Pi resolves a label back to an option value on its side, so
  // the label doubles as the value here.
  const asOptions = (labels: string[]) =>
    labels.map((label) => ({ value: label, label }));

  switch (message.method) {
    case "select":
      return {
        method: message.method,
        title: message.title,
        questions: [
          {
            id: message.id,
            label: message.title,
            prompt: message.title,
            type: "single",
            required: true,
            options: asOptions(message.options),
          },
        ],
      };
    case "confirm":
      return {
        method: message.method,
        title: message.title,
        body: message.message,
        questions: [
          {
            id: message.id,
            label: message.title,
            prompt: message.message,
            type: "single",
            required: true,
            options: asOptions(["Yes", "No"]),
          },
        ],
      };
    case "input":
    case "editor":
      return {
        method: message.method,
        title: message.title,
        body: message.placeholder,
        questions: [
          {
            id: message.id,
            label: message.title,
            prompt: message.placeholder ?? message.title,
            type: "single",
            required: true,
            freeform: true,
            options: [],
          },
        ],
      };
    case "notify":
      return {
        method: message.method,
        title: "notice",
        body: message.message,
        questions: [
          {
            id: message.id,
            label: "notice",
            prompt: message.message,
            type: "single",
            required: false,
            options: asOptions(["OK"]),
          },
        ],
      };
  }
}

// ── reducer ────────────────────────────────────────────────────────────────

export function applyMessage(state: TranscriptState, message: ServerMessage): TranscriptState {
  switch (message.type) {
    case "user_input":
    case "user_message": {
      // `user_message` is the echo of our own send. The id is sender-provided
      // and echoed verbatim, so an optimistic entry is confirmed rather than
      // duplicated — and an optimistic `steering` flag is preserved.
      const existing = state.entries.findIndex(
        (e) => e.kind === "user" && e.id === message.id,
      );
      // Only the `user_message` echo carries attachments; `user_input` never does.
      const images = message.type === "user_message" ? message.images : undefined;
      const steering = message.streaming_behavior === "steer";

      if (existing !== -1) {
        const next = state.entries.slice();
        const entry = next[existing] as Extract<TimelineEntry, { kind: "user" }>;
        next[existing] = {
          ...entry,
          images: images ?? entry.images,
          steering: entry.steering || steering,
          // The echo is the delivery receipt: clear any optimistic pending/failed.
          status: "confirmed",
        };
        return { ...state, entries: next };
      }

      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: "user", id: message.id, text: message.text, images, steering, status: "confirmed" },
        ],
      };
    }

    case "steer_consumed": {
      const index = state.entries.findIndex((e) => e.kind === "user" && e.id === message.id);
      if (index === -1) return state;
      const next = state.entries.slice();
      const entry = next[index] as Extract<TimelineEntry, { kind: "user" }>;
      next[index] = { ...entry, steering: true, steerConsumed: true };
      return { ...state, entries: next };
    }

    case "agent_chunk":
      return {
        ...state,
        working: true,
        entries: upsert(
          state.entries,
          (e) => e.kind === "agent" && e.id === message.in_reply_to,
          () => ({
            kind: "agent" as const,
            id: message.in_reply_to,
            text: message.delta,
            streaming: true,
          }),
          (e) => ({ ...e, text: e.text + message.delta, streaming: true }),
        ),
      };

    case "agent_thinking_chunk":
      return {
        ...state,
        working: true,
        entries: upsert(
          state.entries,
          (e) => e.kind === "thinking" && e.id === `thinking-${message.in_reply_to}`,
          () => ({
            kind: "thinking" as const,
            id: `thinking-${message.in_reply_to}`,
            text: message.delta,
            streaming: true,
          }),
          (e) => ({ ...e, text: e.text + message.delta, streaming: true }),
        ),
      };

    case "agent_done":
      return {
        ...state,
        working: false,
        lastTurnEnd: { id: message.in_reply_to, reason: "done" },
        entries: finishThinking(
          upsert(
            state.entries,
            (e) => e.kind === "agent" && e.id === message.in_reply_to,
            () => ({
              kind: "agent" as const,
              id: message.in_reply_to,
              text: "",
              streaming: false,
              usage: message.usage,
            }),
            (e) => ({ ...e, streaming: false, usage: message.usage }),
          ),
          message.in_reply_to,
        ),
      };

    case "agent_message":
      return {
        ...state,
        entries: upsert(
          state.entries,
          (e) => e.kind === "agent" && e.id === message.in_reply_to,
          () => ({
            kind: "agent" as const,
            id: message.in_reply_to,
            text: message.text,
            streaming: false,
            usage: message.usage,
          }),
          (e) => ({ ...e, text: message.text, streaming: false, usage: message.usage }),
        ),
      };

    case "tool_request":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: "tool",
            id: `tool-${message.tool_call_id}`,
            tool: message.tool,
            arg: summarizeToolArg(message.tool, message.args),
            args: message.args,
            status: "pending",
          },
        ],
      };

    case "tool_result": {
      const id = `tool-${message.tool_call_id}`;
      const index = state.entries.findIndex((e) => e.kind === "tool" && e.id === id);
      if (index === -1) {
        // Result without a matching request (history replay can start mid-turn).
        return {
          ...state,
          entries: [
            ...state.entries,
            {
              kind: "tool",
              id,
              tool: "tool",
              status: message.error ? "error" : "success",
              output: message.error ?? stringifyResult(message.result),
            },
          ],
        };
      }

      const output = message.error ?? stringifyResult(message.result);
      const entry = state.entries[index] as Extract<TimelineEntry, { kind: "tool" }>;
      const next = state.entries.slice();

      // A tool that returned a unified diff renders as a diff block instead of
      // a collapsed text line — same ⏺/⎿ grammar, better signal.
      const diffLines = !message.error && output ? parseUnifiedDiff(output) : null;
      if (diffLines && diffLines.length > 0) {
        next[index] = {
          kind: "diff",
          id,
          file: diffFileFor(entry.tool, entry.args ?? {}),
          summary: `${diffLines.filter((l) => l.type === "add").length} additions, ${
            diffLines.filter((l) => l.type === "del").length
          } removals`,
          lines: diffLines,
        };
      } else {
        next[index] = { ...entry, status: message.error ? "error" : "success", output };
      }
      return { ...state, entries: next };
    }

    case "compaction":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: "compaction",
            id: `compaction-${state.entries.length}`,
            summary: message.summary,
            tokensBefore: message.tokens_before,
            ts: message.ts,
          },
        ],
      };

    case "error":
      return {
        ...state,
        working: false,
        // An error attributed to a turn ends that turn. Claiming it here is what
        // keeps the `agent_done` the Pi sends afterwards from announcing the
        // truncated partial answer as a finished turn.
        ...(message.in_reply_to
          ? { lastTurnEnd: { id: message.in_reply_to, reason: "error" as const } }
          : {}),
        entries: [
          ...state.entries,
          {
            kind: "error",
            id: `error-${state.entries.length}`,
            code: message.code,
            message: message.message,
          },
        ],
      };

    case "custom_message":
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: "custom",
            id: `custom-${state.entries.length}`,
            customType: message.custom_type,
            text: stringifyContent(message.content),
            display: message.display !== false,
            details: message.details,
          },
        ],
      };

    case "cancelled":
      return {
        ...state,
        working: false,
        // Recorded so a user interrupt cannot later be mistaken for a completion
        // (the notification layer only acts on `reason: "done"`).
        lastTurnEnd: { id: message.target_id, reason: "cancelled" },
        entries: finishThinking(
          upsert(
            state.entries,
            (e) => e.kind === "agent" && e.id === message.target_id,
            () => ({
              kind: "agent" as const,
              id: message.target_id,
              text: "",
              streaming: false,
              cancelled: true,
            }),
            (e) => ({ ...e, streaming: false, cancelled: true }),
          ),
          message.target_id,
        ),
      };

    case "bye":
      return {
        ...state,
        working: false,
        entries: [
          ...state.entries,
          { kind: "event", id: `bye-${state.entries.length}`, label: "session ended", detail: message.reason },
        ],
      };

    case "extension_ui_request": {
      // One-way controls mutate ephemeral chrome, never the transcript.
      if (isUiControl(message)) return state;
      const { method, title, body, questions } = questionsOf(message);
      return {
        ...state,
        working: false,
        entries: [
          ...state.entries,
          {
            kind: "question",
            id: message.id,
            method,
            title,
            body,
            questions,
            flowId: message.ask?.flow_id,
          },
        ],
      };
    }

    case "session_history":
      return timelineFromHistory(message);

    case "pair_ok":
    case "pair_error":
    case "pong":
    case "models_list":
    case "action_ok":
    case "action_error":
    case "queued_message_state":
      // Not transcript content — handled by the session layer.
      return state;

    default:
      return state;
  }
}

/** Replace the timeline with a `session_history` mirror. */
export function timelineFromHistory(
  history: Extract<ServerMessage, { type: "session_history" }>,
): TranscriptState {
  let state: TranscriptState = {
    entries: [],
    working: false,
    sessionStartedAt: history.session_started_at,
  };
  for (const event of history.events) {
    state = applyMessage(state, stripTs(event));
  }
  // Replayed history is settled: reasoning blocks are never mid-stream, and a
  // replayed thinking chunk must not leave the transcript stuck "working".
  return {
    ...state,
    working: false,
    // A mirror is a replay, not a fresh turn. Clearing the completion signal here
    // is what stops a replayed `agent_done` from raising a notification (and
    // `isAppendOnly` independently rejects a replaced timeline).
    lastTurnEnd: undefined,
    entries: state.entries.map((entry) =>
      entry.kind === "thinking" ? { ...entry, streaming: false } : entry,
    ),
  };
}

/**
 * History events carry an extra `ts`; the reducer ignores timestamps (they are
 * for display only) so we drop it to keep `applyMessage` a single shape. The
 * `thinking` and `custom` history variants are folded back onto their live
 * wire counterparts so both paths share one reducer case.
 */
function stripTs(event: SessionHistoryEvent): ServerMessage {
  const { ts: _ts, ...rest } = event;
  if (rest.type === "thinking") {
    return { type: "agent_thinking_chunk", in_reply_to: rest.in_reply_to, delta: rest.text };
  }
  if (rest.type === "custom") {
    const { type: _type, ...custom } = rest;
    return { type: "custom_message", ...custom } as ServerMessage;
  }
  return rest as ServerMessage;
}

/** Flatten a custom message's content (string or content blocks) to text. */
function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content === undefined || content === null) return "";
  return stringifyResult(content) ?? "";
}

function stringifyResult(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/** Mark a question resolved (local-only; the wire has no such echo). */
export function markAnswered(
  state: TranscriptState,
  questionId: string,
  answer: string,
  cancelled = false,
): TranscriptState {
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.kind === "question" && e.id === questionId ? { ...e, answered: answer, cancelled } : e,
    ),
  };
}

/** Optimistic local echo so the user's own message appears before the Pi echoes it. */
export function addLocalUserMessage(
  state: TranscriptState,
  id: string,
  text: string,
  options: { steering?: boolean; images?: WireImage[]; now?: number } = {},
): TranscriptState {
  const next = applyMessage(state, {
    type: "user_message",
    id,
    text,
    images: options.images,
    streaming_behavior: options.steering ? "steer" : undefined,
  });
  const sentAt = options.now ?? Date.now();
  return {
    ...next,
    entries: next.entries.map((e) =>
      e.kind === "user" && e.id === id
        ? { ...e, status: "pending" as const, sentAt }
        : e,
    ),
  };
}

/**
 * Age out optimistic sends the Pi never echoed. The app waits 20s before
 * showing "not delivered"; the web reaper calls this on a timer so a dropped
 * message does not sit on "sending…" forever. Returns the same reference when
 * nothing changed so React can skip a render.
 */
export function failStalePending(state: TranscriptState, now: number, ms: number): TranscriptState {
  let changed = false;
  const entries = state.entries.map((e) => {
    if (e.kind === "user" && e.status === "pending" && e.sentAt !== undefined && now - e.sentAt >= ms) {
      changed = true;
      return { ...e, status: "failed" as const };
    }
    return e;
  });
  return changed ? { ...state, entries } : state;
}
