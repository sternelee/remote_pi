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

import type { AskAnswerWire } from "../protocol/types";
import type { QuestionView } from "./transcript";
import type { QuestionAnswer } from "./usePiSession";

export interface Selection {
  /** Question id → chosen option values. */
  selected: Record<string, string[]>;
  /** Question id → free-text answer. */
  custom: Record<string, string>;
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
  return parts.length ? parts.join(", ") : "answered";
}

/**
 * Build the response for an interactive prompt, or `null` when nothing has been
 * chosen yet (so the caller can refuse to submit an empty answer).
 */
export function buildQuestionAnswer(
  requestId: string,
  flowId: string | undefined,
  questions: QuestionView[],
  selection: Selection,
): QuestionAnswer | null {
  const answers: Record<string, AskAnswerWire> = {};
  let chosenLabels: string[] = [];

  for (const question of questions) {
    const values = selection.selected[question.id] ?? [];
    const text = selection.custom[question.id]?.trim();

    if (values.length === 0 && !text) {
      // A required question left blank makes the whole submit invalid: pi-ask
      // resolves a flow atomically, so a partial answer would be rejected.
      if (question.required) return null;
      continue;
    }

    answers[question.id] = {
      ...(values.length ? { values } : {}),
      ...(text ? { customText: text } : {}),
    };

    for (const value of values) {
      chosenLabels.push(question.options.find((o) => o.value === value)?.label ?? value);
    }
    if (text) chosenLabels.push(text);
  }

  if (chosenLabels.length === 0 && Object.keys(answers).length === 0) return null;

  const summary = chosenLabels.join(", ");

  return {
    requestId,
    summary,
    flowId,
    // Only the rich path may carry `answers`; sending them without a flow id
    // would produce a response the Pi cannot route.
    answers: flowId ? answers : undefined,
    label: chosenLabels[0] ?? summary,
  };
}

export function cancelAnswer(
  requestId: string,
  flowId: string | undefined,
): QuestionAnswer {
  return { requestId, summary: "cancelled", flowId, cancelled: true };
}
