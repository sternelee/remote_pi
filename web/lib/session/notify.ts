/**
 * Notification decisions, kept pure so they can be tested without a browser.
 *
 * A browser client has no push channel and no background execution: the useful
 * moment to interrupt is *while the tab is hidden*, because a visible tab
 * already updates itself. So the rule is "hidden + enabled + permission", not
 * "always".
 *
 * Events are derived by diffing two transcript states rather than by observing
 * side effects, which makes them replay-safe: a `session_history` mirror or a
 * `session_new` replaces the timeline, and a replaced timeline must not fire a
 * burst of notifications for turns the user already read.
 */

import type { TimelineEntry, TranscriptState } from "./transcript";

export type NotifyKind = "turn_done" | "question" | "error";

export interface NotifyEvent {
  kind: NotifyKind;
  title: string;
  body: string;
  /** Timeline entry id (or turn id) this came from, for de-duplication. */
  key: string;
}

const BODY_LIMIT = 140;

function trim(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > BODY_LIMIT ? `${oneLine.slice(0, BODY_LIMIT - 1)}…` : oneLine;
}

/**
 * True when `next` merely appends to `prev`.
 *
 * A replaced timeline (history mirror, new session) and a truncated one both
 * fail this check, which is exactly when notifying would be wrong.
 */
export function isAppendOnly(prev: TranscriptState, next: TranscriptState): boolean {
  if (next.entries.length < prev.entries.length) return false;
  for (let i = 0; i < prev.entries.length; i++) {
    if (entryKey(prev.entries[i]) !== entryKey(next.entries[i])) return false;
  }
  return true;
}

export function entryKey(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "user":
      return `user:${entry.id}`;
    case "agent":
      return `agent:${entry.id}`;
    case "thinking":
      return `thinking:${entry.id}`;
    case "custom":
      return `custom:${entry.id}`;
    case "tool":
      return `tool:${entry.id}`;
    case "diff":
      return `diff:${entry.id}`;
    case "compaction":
      return `compaction:${entry.id}`;
    case "error":
      return `error:${entry.id}`;
    case "event":
      return `event:${entry.id}`;
    case "question":
      return `question:${entry.id}`;
  }
}

/**
 * Events worth interrupting the user for, derived from a transcript transition.
 *
 * Returns nothing when the timeline was not appended to, so a replayed mirror
 * never re-notifies.
 */
export function notificationsFor(
  prev: TranscriptState,
  next: TranscriptState,
  label: string,
): NotifyEvent[] {
  if (!isAppendOnly(prev, next)) return [];

  const events: NotifyEvent[] = [];
  const seen = new Set(prev.entries.map(entryKey));
  const added = next.entries.filter((entry) => !seen.has(entryKey(entry)));

  for (const entry of added) {
    if (entry.kind === "question") {
      events.push({
        kind: "question",
        title: `${label} needs an answer`,
        body: trim(entry.questions[0]?.prompt ?? entry.title),
        key: `question:${entry.id}`,
      });
      continue;
    }
    if (entry.kind === "error") {
      events.push({
        kind: "error",
        title: `${label} hit an error`,
        body: trim(`${entry.code}: ${entry.message}`),
        key: `error:${entry.id}`,
      });
    }
  }

  // A finished turn is the protocol saying so (`agent_done`) via
  // `state.lastTurnEnd`, never a shape inferred from the timeline.
  //
  // Both inference schemes failed in opposite directions. Gating on the
  // `working` flag let `bye` and a replaced timeline raise "finished" with a
  // stale body. Gating on a `streaming -> settled` agent entry then missed every
  // turn whose only output was reasoning or tool calls, because `agent_done`
  // *creates* the agent entry when no chunk ever streamed.
  //
  // Comparing ids is also what keeps an error followed by its `agent_done` to a
  // single notification: the error already claimed that turn, so the later
  // "done" for the same id is suppressed. A replay is excluded because
  // `timelineFromHistory` clears `lastTurnEnd`.
  const end = next.lastTurnEnd;
  if (events.length === 0 && end?.reason === "done" && end.id !== prev.lastTurnEnd?.id) {
    const settled = next.entries.find(
      (entry): entry is Extract<TimelineEntry, { kind: "agent" }> =>
        entry.kind === "agent" && entry.id === end.id,
    );
    events.push({
      kind: "turn_done",
      title: `${label} finished`,
      body: settled?.text ? trim(settled.text) : "The turn is complete.",
      key: `turn:${end.id}`,
    });
  }

  return events;
}

/** Only raise an OS notification when the tab cannot show the result itself. */
export function shouldRaise({
  enabled,
  permission,
  hidden,
}: {
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  hidden: boolean;
}): boolean {
  return enabled && hidden && permission === "granted";
}

/** `(2) Remote Pi` — how a background tab still announces unread activity. */
export function titleWithUnread(count: number, base = "Remote Pi"): string {
  return count > 0 ? `(${count}) ${base}` : base;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
