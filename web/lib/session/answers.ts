/**
 * Prompt answer construction.
 *
 * Pulled out of the prompt component so the two wire paths are testable without
 * a DOM. The Pi accepts both:
 *
 *   rich      — `ask` envelope, structured answers keyed by question id, option
 *               **values**. Required whenever the prompt carried an `ask`
 *               envelope: the Pi routes on `ask.kind` before reading any
 *               discriminator, so `answers` supersede them.
 *   degraded  — a bare `value` carrying the chosen option **label**; the Pi
 *               maps the label back to a value itself.
 *
 * Getting this wrong is silent: the answer is accepted by the transport and
 * dropped by the Pi.
 */

import type { AskAnswerMode, AskAnswerWire, ClientMessage } from "../protocol/types";
import type { QuestionView } from "./transcript";
import type { QuestionAnswer } from "./usePiSession";

export interface Selection {
  /** Question id → chosen option values. */
  selected: Record<string, string[]>;
  /** Question id → free-text answer. */
  custom: Record<string, string>;
  /** Question id → question-level note (pi-ask's question note field). */
  notes?: Record<string, string>;
  /** Question id → option value → option-level note (pi-ask's option note field). */
  optionNotes?: Record<string, Record<string, string>>;
}

/** Non-empty option notes for one question, or `undefined` when it has none. */
function optionNotesFor(
  question: QuestionView,
  selection: Selection,
): Record<string, string> | undefined {
  const raw = selection.optionNotes?.[question.id];
  if (!raw) return undefined;
  const notes: Record<string, string> = {};
  for (const [value, text] of Object.entries(raw)) {
    const trimmed = text?.trim();
    if (trimmed) notes[value] = trimmed;
  }
  return Object.keys(notes).length ? notes : undefined;
}

/** The user's notes as summary fragments — an `elaborate` carries mostly these. */
function noteFragments(questions: QuestionView[], selection: Selection): string[] {
  const parts: string[] = [];
  for (const question of questions) {
    const note = selection.notes?.[question.id]?.trim();
    if (note) parts.push(note);
    for (const [value, text] of Object.entries(optionNotesFor(question, selection) ?? {})) {
      const label = question.options.find((o) => o.value === value)?.label ?? value;
      parts.push(`${label}: ${text}`);
    }
  }
  return parts;
}

/** A human-readable one-liner for the resolved transcript line. */
export function summarizeSelection(questions: QuestionView[], selection: Selection): string {
  const parts: string[] = [];
  for (const question of questions) {
    const values = selection.selected[question.id] ?? [];
    for (const value of values) {
      parts.push(question.options.find((o) => o.value === value)?.label ?? value);
    }
    const text = selection.custom[question.id]?.trim();
    if (text) parts.push(text);
  }
  parts.push(...noteFragments(questions, selection));
  return parts.length ? parts.join(", ") : "answered";
}

/**
 * Build the response for an interactive prompt, or `null` when the current
 * state must not be sent. Three refusals:
 *   - an empty flow (nothing chosen, written, or noted)
 *   - a required question left blank on `submit` — pi-ask resolves a flow
 *     atomically, so a partial answer would be rejected
 *   - an `elaborate` with no note anywhere: pi-ask builds `elaboration.items`
 *     from the notes, so a note-less elaborate is an empty clarification
 *     request. This is a client-side guard, not a wire rule.
 *
 * A blank required question does NOT block `elaborate` — asking about a
 * question you cannot answer yet is the whole point. A note also counts as an
 * answer on `submit`: pi-ask keeps note-only entries so the model reads them.
 */
export function buildQuestionAnswer(
  requestId: string,
  flowId: string | undefined,
  questions: QuestionView[],
  selection: Selection,
  mode: AskAnswerMode = "submit",
): QuestionAnswer | null {
  const answers: Record<string, AskAnswerWire> = {};
  const chosenLabels: string[] = [];
  let notedQuestions = 0;

  for (const question of questions) {
    const values = selection.selected[question.id] ?? [];
    const text = selection.custom[question.id]?.trim();
    const note = selection.notes?.[question.id]?.trim();
    const optionNotes = optionNotesFor(question, selection);
    if (note || optionNotes) notedQuestions += 1;

    if (values.length === 0 && !text && !note && !optionNotes) {
      if (question.required && mode === "submit") return null;
      continue;
    }

    answers[question.id] = {
      ...(values.length ? { values } : {}),
      ...(text ? { customText: text } : {}),
      ...(note ? { note } : {}),
      ...(optionNotes ? { optionNotes } : {}),
    };

    for (const value of values) {
      chosenLabels.push(question.options.find((o) => o.value === value)?.label ?? value);
    }
    if (text) chosenLabels.push(text);
  }

  if (mode === "elaborate" && notedQuestions === 0) return null;

  const summary = [...chosenLabels, ...noteFragments(questions, selection)].join(", ");
  if (!summary) return null;

  return {
    requestId,
    summary,
    flowId,
    mode,
    // Only the rich path may carry `answers`; sending them without a flow id
    // would produce a response the Pi cannot route.
    answers: flowId ? answers : undefined,
    label: chosenLabels[0] ?? summary,
  };
}

/**
 * The outbound frame for a resolved answer: cancel, rich envelope, or the
 * degraded label. Kept here (not in the hook) so the `mode` a client sends is
 * testable without a DOM — it was silently pinned to `submit` once already.
 */
export function answerToWire(answer: QuestionAnswer): ClientMessage {
  if (answer.cancelled) {
    return answer.flowId
      ? { type: "extension_ui_response", id: answer.requestId, ask: { flow_id: answer.flowId, kind: "cancel" } }
      : { type: "extension_ui_response", id: answer.requestId, cancelled: true };
  }

  if (answer.flowId && answer.answers) {
    // Rich path: the structured answers supersede the value/confirmed
    // discriminators, and option *values* are what pi-ask expects.
    return {
      type: "extension_ui_response",
      id: answer.requestId,
      ask: {
        flow_id: answer.flowId,
        kind: "answer",
        mode: answer.mode ?? "submit",
        answers: answer.answers,
      },
    };
  }

  // Degraded path: the Pi maps this label back to an option value.
  return {
    type: "extension_ui_response",
    id: answer.requestId,
    value: answer.label ?? answer.summary,
  };
}

export function cancelAnswer(
  requestId: string,
  flowId: string | undefined,
): QuestionAnswer {
  return { requestId, summary: "cancelled", flowId, cancelled: true };
}
