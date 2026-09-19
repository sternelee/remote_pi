"use client";

/**
 * Interactive prompt renderer for `extension_ui_request`.
 *
 * Covers both wire shapes with one UI:
 *   - pi-ask enrichment (`ask`) — real option values, multi-select, previews,
 *     free-text, and a cancel that reaches pi-ask
 *   - the bare SDK shape — labels only, single choice
 *
 * Visual grammar follows the brainless `claude-permission` box (rose fieldset,
 * `❯` selection marker, numbered rows) because that is what the terminal shows
 * for the same prompt; the row model is extended to real radios/checkboxes so
 * multi-select and previews stay keyboard-operable.
 */

import { useEffect, useRef, useState } from "react";

import { buildQuestionAnswer, cancelAnswer } from "@/lib/session/answers";
import type { QuestionView } from "@/lib/session/transcript";
import type { QuestionAnswer } from "@/lib/session/usePiSession";

const ROSE = "var(--pi-rose)";
const FG = "var(--pi-fg)";
const MUTED = "var(--pi-muted)";
const DIM = "var(--pi-dim)";
const CYAN = "var(--pi-cyan)";

export function QuestionPrompt({
  requestId,
  flowId,
  title,
  body,
  questions,
  onAnswer,
}: {
  requestId: string;
  flowId?: string;
  title: string;
  body?: string;
  questions: QuestionView[];
  onAnswer: (answer: QuestionAnswer) => void;
}) {
  // One question per row is the common case; multi-question flows are answered
  // in a single submit (pi-ask resolves a flow atomically).
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  // Seed the preview pane from the first option that has one, so a preview
  // question does not open with an empty pane.
  const [preview, setPreview] = useState<string | undefined>(() =>
    questions.flatMap((q) => q.options).find((o) => o.preview)?.preview,
  );
  const containerRef = useRef<HTMLFieldSetElement | null>(null);

  const isMulti = questions.some((q) => q.type === "multi");
  const hasFreeform = questions.some((q) => q.freeform);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  /** Flattened row list so arrow keys can walk every option across questions. */
  const rows = questions.flatMap((q) =>
    q.options.map((o) => ({ questionId: q.id, value: o.value, label: o.label, preview: o.preview })),
  );

  function toggle(questionId: string, value: string, multi: boolean) {
    setSelected((prev) => {
      const current = prev[questionId] ?? [];
      const next = multi
        ? current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value]
        : [value];
      return { ...prev, [questionId]: next };
    });
  }

  /** Submit a single explicit choice (single-choice questions resolve at once). */
  function answerWith(questionId: string, value: string) {
    const answer = buildQuestionAnswer(requestId, flowId, questions, {
      selected: { ...selected, [questionId]: [value] },
      custom,
    });
    if (answer) onAnswer(answer);
  }

  /** Submit whatever is currently selected (multi-select / free-text). */
  function submitFromState() {
    const answer = buildQuestionAnswer(requestId, flowId, questions, { selected, custom });
    if (answer) onAnswer(answer);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onAnswer(cancelAnswer(requestId, flowId));
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (rows.length === 0) return;
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? (active + 1) % rows.length
          : (active - 1 + rows.length) % rows.length;
      setActive(next);
      setPreview(rows[next].preview);
      return;
    }
    if (event.key !== "Enter") return;
    // The composer's Enter handling must not swallow the prompt's.
    event.preventDefault();
    event.stopPropagation();

    const row = rows[active];
    if (!row) {
      submitFromState();
      return;
    }
    const question = questions.find((q) => q.id === row.questionId);
    const multi = question?.type === "multi";
    toggle(row.questionId, row.value, Boolean(multi));

    // Single-choice and preview questions resolve on the spot; multi needs a
    // submit because more than one row can be chosen.
    if (!isMulti) answerWith(row.questionId, row.value);
  }

  return (
    <fieldset
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="rounded-none border px-3.5 py-2.5 font-mono text-[13px] leading-[1.6] outline-none"
      style={{ borderColor: ROSE }}
      aria-label={title}
    >
      <legend className="px-2" style={{ color: ROSE }}>
        {title}
      </legend>

      {body ? <div style={{ color: FG }}>{body}</div> : null}

      {questions.map((q) => (
        <div key={q.id} className="mb-1.5 mt-2 min-w-0">
          {questions.length > 1 ? (
            <div className="mb-1" style={{ color: FG }}>
              {q.label}
              {q.required ? <span style={{ color: ROSE }}> *</span> : null}
            </div>
          ) : null}
          <div className="mb-1" style={{ color: MUTED }}>
            {q.prompt}
            {q.type === "multi" ? <span style={{ color: DIM }}> (choose any)</span> : null}
          </div>

          <div role={q.type === "multi" ? "group" : "radiogroup"} aria-label={q.label}>
            {q.options.map((option, index) => {
              const rowIndex = rows.findIndex(
                (r) => r.questionId === q.id && r.value === option.value,
              );
              const isActive = rowIndex === active;
              const isSelected = (selected[q.id] ?? []).includes(option.value);
              return (
                <div
                  key={option.value}
                  role={q.type === "multi" ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  tabIndex={isActive ? 0 : -1}
                  onMouseEnter={() => {
                    setActive(rowIndex);
                    if (option.preview) setPreview(option.preview);
                  }}
                  onClick={() => {
                    setActive(rowIndex);
                    if (q.type === "multi") {
                      toggle(q.id, option.value, true);
                      return;
                    }
                    answerWith(q.id, option.value);
                  }}
                  className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5"
                  style={{ background: isActive ? "color-mix(in srgb, var(--pi-rose) 12%, transparent)" : "transparent" }}
                >
                  <span aria-hidden style={{ color: isActive ? ROSE : "transparent", width: "1ch" }}>
                    ❯
                  </span>
                  <span
                    aria-hidden
                    style={{ color: isSelected ? ROSE : DIM, width: "2ch" }}
                  >
                    {q.type === "multi" ? (isSelected ? "[x]" : "[ ]") : `${index + 1}.`}
                  </span>
                  <span
                    className="min-w-0 break-words"
                    style={{ color: isSelected ? FG : MUTED, fontWeight: isSelected ? 600 : undefined }}
                  >
                    {option.label}
                    {option.description ? (
                      <span style={{ color: DIM }}> — {option.description}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>

          {q.freeform ? (
            <div className="mt-1 flex min-w-0 items-baseline gap-2 px-1">
              <span aria-hidden style={{ color: DIM, width: "1ch" }}>
                ❯
              </span>
              <input
                type="text"
                aria-label={`${q.label} answer`}
                value={custom[q.id] ?? ""}
                onChange={(event) =>
                  setCustom((prev) => ({ ...prev, [q.id]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing === false) {
                    event.preventDefault();
                    submitFromState();
                  }
                }}
                placeholder="type an answer…"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--pi-dim)]"
                style={{ color: FG }}
              />
            </div>
          ) : null}
        </div>
      ))}

      {preview ? (
        <pre
          className="mt-1 max-h-48 overflow-auto rounded-none border py-1.5 pl-2 pr-3 text-[12px]"
          style={{ borderColor: "var(--pi-border-soft)", background: "var(--pi-surface)", color: MUTED }}
        >
          {preview}
        </pre>
      ) : null}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[11px]" style={{ color: DIM }}>
        {isMulti || hasFreeform ? (
          <button
            type="button"
            onClick={submitFromState}
            className="underline-offset-2 hover:underline"
            style={{ color: CYAN }}
          >
            submit
          </button>
        ) : null}
        <span>↑↓ choose · enter select</span>
        <button
          type="button"
          onClick={() => onAnswer(cancelAnswer(requestId, flowId))}
          className="underline-offset-2 hover:underline"
          style={{ color: MUTED }}
        >
          esc cancel
        </button>
      </div>
    </fieldset>
  );
}
