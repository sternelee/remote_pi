"use client";

/**
 * Interactive prompt renderer for `extension_ui_request`.
 *
 * Covers both wire shapes with one UI:
 *   - pi-ask enrichment (`ask`) — real option values, multi-select, previews,
 *     free-text, question/option notes, and the two pi-ask exits
 *   - the bare SDK shape — labels only, single choice
 *
 * Selection never auto-submits. The user picks a review exit: `submit`
 * finalizes the answers; `elaborate` asks the agent to clarify the attached
 * notes first. Elaborate is note-driven upstream (pi-ask builds
 * `elaboration.items` from the notes), so the button stays disabled until at
 * least one note exists — an empty elaborate would be a clarification request
 * with nothing in it. Notes only exist on pi-ask flows; a bare SDK prompt has
 * nowhere to carry them.
 *
 * Visual grammar follows the brainless `claude-permission` box (rose fieldset,
 * `❯` selection marker, numbered rows) because that is what the terminal shows
 * for the same prompt; the row model is extended to real radios/checkboxes so
 * multi-select and previews stay keyboard-operable.
 */

import { useEffect, useRef, useState } from "react";

import { buildQuestionAnswer, cancelAnswer } from "@/lib/session/answers";
import type { AskAnswerMode } from "@/lib/protocol/types";
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
  // pi-ask notes — `elaborate` is built from these; `submit` carries them too.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [optionNotes, setOptionNotes] = useState<Record<string, Record<string, string>>>({});
  // Editors stay collapsed until asked for, so rows stay calm.
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [optionNoteOpen, setOptionNoteOpen] = useState<Record<string, string | undefined>>({});
  const [active, setActive] = useState(0);
  // Seed the preview pane from the first option that has one, so a preview
  // question does not open with an empty pane.
  const [preview, setPreview] = useState<string | undefined>(() =>
    questions.flatMap((q) => q.options).find((o) => o.preview)?.preview,
  );
  const containerRef = useRef<HTMLFieldSetElement | null>(null);

  const isAsk = flowId != null;
  const selection = { selected, custom, notes, optionNotes };
  const submitAnswer = buildQuestionAnswer(requestId, flowId, questions, selection, "submit");
  const elaborateAnswer = isAsk
    ? buildQuestionAnswer(requestId, flowId, questions, selection, "elaborate")
    : null;

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
        : current[0] === value
          ? []
          : [value];
      return { ...prev, [questionId]: next };
    });
  }

  /** One of the two review exits. A `null` answer means the state is refused —
   *  the matching button is disabled, so this is belt-and-braces. */
  function send(mode: AskAnswerMode) {
    const answer = mode === "elaborate" ? elaborateAnswer : submitAnswer;
    if (answer) onAnswer(answer);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onAnswer(cancelAnswer(requestId, flowId));
      return;
    }
    // Enter on a focused control belongs to that control (buttons submit,
    // inputs accept the text); only bare rows toggle through here.
    const target = event.target as HTMLElement | null;
    if (event.key === "Enter" && target?.closest("button, input, textarea")) return;
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
      // A pure-text question (no option rows): Enter submits the typed answer.
      send("submit");
      return;
    }
    const question = questions.find((q) => q.id === row.questionId);
    toggle(row.questionId, row.value, question?.type === "multi");
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

      {questions.map((q) => {
        const noteValue = notes[q.id] ?? "";
        return (
          <div key={q.id} className="mb-1.5 mt-2 min-w-0">
            {questions.length > 1 ? (
              <div className="mb-1" style={{ color: FG }}>
                {q.label}
                {q.required ? <span style={{ color: ROSE }}> *</span> : null}
              </div>
            ) : null}
            <div className="mb-1 flex items-baseline justify-between gap-2" style={{ color: MUTED }}>
              <span className="min-w-0">
                {q.prompt}
                {q.type === "multi" ? <span style={{ color: DIM }}> (choose any)</span> : null}
              </span>
              {isAsk ? (
                <button
                  type="button"
                  aria-label={`note on ${q.label}`}
                  aria-expanded={noteOpen[q.id] === true}
                  onClick={() => setNoteOpen((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                  className="shrink-0 underline-offset-2 hover:underline"
                  style={{ color: noteValue.trim() ? ROSE : DIM }}
                >
                  note
                </button>
              ) : null}
            </div>

            <div role={q.type === "multi" ? "group" : "radiogroup"} aria-label={q.label}>
              {q.options.map((option, index) => {
                const rowIndex = rows.findIndex(
                  (r) => r.questionId === q.id && r.value === option.value,
                );
                const isActive = rowIndex === active;
                const isSelected = (selected[q.id] ?? []).includes(option.value);
                const optionNote = optionNotes[q.id]?.[option.value] ?? "";
                const noteShown = optionNoteOpen[q.id] === option.value;
                return (
                  <div key={option.value}>
                    <div
                      role={q.type === "multi" ? "checkbox" : "radio"}
                      aria-checked={isSelected}
                      tabIndex={isActive ? 0 : -1}
                      onMouseEnter={() => {
                        setActive(rowIndex);
                        if (option.preview) setPreview(option.preview);
                      }}
                      onClick={() => {
                        setActive(rowIndex);
                        toggle(q.id, option.value, q.type === "multi");
                      }}
                      className="flex cursor-pointer items-baseline gap-2 rounded px-1 py-0.5"
                      style={{
                        background: isActive
                          ? "color-mix(in srgb, var(--pi-rose) 12%, transparent)"
                          : "transparent",
                      }}
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
                    {isAsk && isActive ? (
                      <button
                        type="button"
                        aria-label={`note on ${option.label}`}
                        aria-expanded={noteShown}
                        onClick={() =>
                          setOptionNoteOpen((prev) => ({
                            ...prev,
                            [q.id]: prev[q.id] === option.value ? undefined : option.value,
                          }))
                        }
                        className="ml-6 text-[11px] underline-offset-2 hover:underline"
                        style={{ color: optionNote.trim() ? ROSE : DIM }}
                      >
                        {optionNote.trim() ? "noted" : "+ note"}
                      </button>
                    ) : null}
                    {noteShown ? (
                      <input
                        type="text"
                        aria-label={`note on ${option.label}`}
                        value={optionNote}
                        onChange={(event) =>
                          setOptionNotes((prev) => ({
                            ...prev,
                            [q.id]: { ...prev[q.id], [option.value]: event.target.value },
                          }))
                        }
                        onKeyDown={(event) => {
                          // Enter closes the editor; Escape must not cancel the
                          // whole flow from inside a note.
                          event.stopPropagation();
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setOptionNoteOpen((prev) => ({ ...prev, [q.id]: undefined }));
                          } else if (event.key === "Enter") {
                            event.preventDefault();
                            setOptionNoteOpen((prev) => ({ ...prev, [q.id]: undefined }));
                          }
                        }}
                        placeholder={`note on ${option.label}…`}
                        className="ml-6 min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--pi-dim)]"
                        style={{ color: FG }}
                      />
                    ) : optionNote.trim() ? (
                      <div className="ml-6 text-[11px]" style={{ color: DIM }}>
                        └ {optionNote}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {noteOpen[q.id] ? (
              <input
                type="text"
                aria-label={`note on ${q.label}`}
                value={noteValue}
                onChange={(event) => setNotes((prev) => ({ ...prev, [q.id]: event.target.value }))}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape" || event.key === "Enter") {
                    event.preventDefault();
                    setNoteOpen((prev) => ({ ...prev, [q.id]: false }));
                  }
                }}
                placeholder="note for the agent — what should it explain?"
                className="mt-1 min-w-0 bg-transparent outline-none placeholder:text-[var(--pi-dim)]"
                style={{ color: FG, width: "100%" }}
              />
            ) : noteValue.trim() ? (
              <div className="text-[11px]" style={{ color: DIM }}>
                note: {noteValue}
              </div>
            ) : null}

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
                      event.stopPropagation();
                      send("submit");
                    }
                  }}
                  placeholder="type an answer…"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--pi-dim)]"
                  style={{ color: FG }}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {preview ? (
        <pre
          className="mt-1 max-h-48 overflow-auto rounded-none border py-1.5 pl-2 pr-3 text-[12px]"
          style={{ borderColor: "var(--pi-border-soft)", background: "var(--pi-surface)", color: MUTED }}
        >
          {preview}
        </pre>
      ) : null}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]" style={{ color: DIM }}>
        <button
          type="button"
          disabled={!submitAnswer}
          onClick={() => send("submit")}
          title={submitAnswer ? undefined : "answer every required question first"}
          className="underline-offset-2 hover:underline disabled:opacity-40"
          style={{ color: CYAN }}
        >
          submit
        </button>
        {isAsk ? (
          <button
            type="button"
            disabled={!elaborateAnswer}
            onClick={() => send("elaborate")}
            title={
              elaborateAnswer
                ? "ask the agent to explain the notes before you commit"
                : "add a note first — elaborate asks the agent about your notes"
            }
            className="underline-offset-2 hover:underline disabled:opacity-40"
            style={{ color: ROSE }}
          >
            elaborate
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
