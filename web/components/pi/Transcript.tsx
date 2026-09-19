"use client";

/**
 * Transcript renderer — the pi session as a terminal scrollback.
 *
 * Every visual primitive comes from the brainless registry components in
 * `components/brainless/**` (vendored verbatim, see README § Credits), so the
 * ⏺ / ⎿ / ❯ / ◆ grammar matches the terminal the agent actually runs in.
 */

import { ClaudeDiff } from "@/components/brainless/claude/claude-diff";
import { ClaudeMessage } from "@/components/brainless/claude/claude-message";
import { ClaudeThinking } from "@/components/brainless/claude/claude-thinking";
import { ClaudeToolCall } from "@/components/brainless/claude/claude-tool-call";
import { GrokEvent } from "@/components/brainless/grok/grok-event";
import type { TimelineEntry, TranscriptState } from "@/lib/session/transcript";
import type { QuestionAnswer } from "@/lib/session/usePiSession";
import { Markdown } from "./Markdown";
import { QuestionPrompt } from "./QuestionPrompt";

const RED = "var(--pi-red)";
const DIM = "var(--pi-dim)";
const MUTED = "var(--pi-muted)";
const CYAN = "var(--pi-cyan)";

export function Transcript({
  state,
  onAnswer,
  hideToolCalls,
}: {
  state: TranscriptState;
  onAnswer: (answer: QuestionAnswer) => void;
  /** Render only prose turns, mirroring the app's "hide tool calls" setting. */
  hideToolCalls?: boolean;
}) {
  const entries = hideToolCalls
    ? state.entries.filter((entry) => entry.kind !== "tool" && entry.kind !== "diff")
    : state.entries;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {entries.map((entry) => (
        <Entry key={entryKey(entry)} entry={entry} onAnswer={onAnswer} />
      ))}
      {state.working ? <ClaudeThinking running className="mt-0.5" /> : null}
    </div>
  );
}

function entryKey(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "user":
      return `u-${entry.id}`;
    case "agent":
      return `a-${entry.id}`;
    case "tool":
      return `t-${entry.id}`;
    case "diff":
      return `d-${entry.id}`;
    case "compaction":
      return `c-${entry.id}`;
    case "error":
      return `e-${entry.id}`;
    case "event":
      return `v-${entry.id}`;
    case "question":
      return `q-${entry.id}`;
  }
}

function Entry({
  entry,
  onAnswer,
}: {
  entry: TimelineEntry;
  onAnswer: (answer: QuestionAnswer) => void;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <ClaudeMessage role="user">
            {entry.text}
            {entry.status === "pending" ? (
              <span style={{ color: MUTED }}> {"· sending…"}</span>
            ) : null}
            {entry.status === "failed" ? (
              <span style={{ color: RED }}> {"· not delivered"}</span>
            ) : null}
            {entry.steering ? (
              <span style={{ color: entry.steerConsumed ? CYAN : "var(--pi-yellow)" }}>
                {" "}
                {entry.steerConsumed ? "· steered" : "· steering…"}
              </span>
            ) : null}
          </ClaudeMessage>
          {entry.images?.length ? (
            <div className="flex flex-wrap gap-2 pl-[3ch]">
              {entry.images.map((image, index) => {
                const src = `data:${image.mime};base64,${image.data}`;
                return (
                  <a
                    key={`${entry.id}-img-${index}`}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    title="Open attachment"
                    className="block border border-[var(--pi-border)]"
                  >
                    <img
                      src={src}
                      alt={`attachment ${index + 1}`}
                      className="block max-h-32 max-w-[12rem] object-contain"
                    />
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      );

    case "agent":
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <ClaudeMessage role="assistant" className="break-words">
            <Markdown streaming={entry.streaming}>{entry.text || (entry.streaming ? "" : " ")}</Markdown>
          </ClaudeMessage>
          {entry.cancelled ? <Line label="cancelled" detail="interrupted" tone={DIM} /> : null}
          {entry.usage ? (
            <span className="font-mono text-[11px]" style={{ color: DIM }}>
              {entry.usage.input_tokens} in · {entry.usage.output_tokens} out
            </span>
          ) : null}
        </div>
      );

    case "tool":
      return (
        <ClaudeToolCall
          tool={entry.tool}
          arg={entry.arg}
          status={entry.status}
          result={toolResultLine(entry)}
          defaultOpen={entry.status === "error"}
        >
          {entry.output ? entry.output : undefined}
        </ClaudeToolCall>
      );

    case "diff":
      return <ClaudeDiff file={entry.file} summary={entry.summary} lines={entry.lines} />;

    case "compaction":
      return (
        <GrokEvent label="context compacted" elapsed={`${entry.tokensBefore} tokens`}>
          <span className="whitespace-pre-wrap">{entry.summary}</span>
        </GrokEvent>
      );

    case "error":
      return <Line label={`error: ${entry.code}`} detail={entry.message} tone={RED} />;

    case "event":
      return <Line label={entry.label} detail={entry.detail} tone={DIM} />;

    case "question":
      if (entry.answered) {
        return (
          <Line
            label={entry.title}
            detail={`${entry.cancelled ? "cancelled" : "answered"} · ${entry.answered}`}
            tone={DIM}
          />
        );
      }
      return (
        <QuestionPrompt
          requestId={entry.id}
          flowId={entry.flowId}
          title={entry.title}
          body={entry.body}
          questions={entry.questions}
          onAnswer={onAnswer}
        />
      );
  }
}

/** The ⎿ line: a one-glance status, with the full text behind the disclosure. */
function toolResultLine(entry: Extract<TimelineEntry, { kind: "tool" }>): string {
  if (entry.status === "pending") return "running…";
  const source = entry.output?.trim();
  if (!source) return entry.status === "error" ? "failed" : "done";
  const firstLine = source.split("\n").find((l) => l.trim().length > 0) ?? source;
  const compact = firstLine.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

/**
 * A ◆ event line with a tone. `GrokEvent` hard-codes its label colour, so
 * errors get their own minimal line in the same grammar rather than a
 * `!important` fight with the vendored component.
 */
function Line({ label, detail, tone }: { label: string; detail?: string; tone: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[13px] leading-[1.55]">
      <span aria-hidden style={{ color: tone }}>
        ◆
      </span>
      <span style={{ color: tone }}>{label}</span>
      {detail ? (
        <span className="min-w-0 break-words" style={{ color: DIM }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}
