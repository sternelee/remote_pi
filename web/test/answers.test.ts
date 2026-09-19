/**
 * Answer construction for interactive prompts — the two wire paths.
 *
 * These guard the failure mode that is invisible over the wire: a rich prompt
 * answered with a bare label, or a degraded prompt answered with structured
 * `answers`, is accepted by the transport and then dropped by the Pi.
 */

import { describe, expect, it } from "vitest";

import { buildQuestionAnswer, cancelAnswer, summarizeSelection } from "../lib/session/answers";
import type { QuestionView } from "../lib/session/transcript";

const multi: QuestionView = {
  id: "targets",
  label: "Targets",
  prompt: "Pick any",
  type: "multi",
  required: true,
  options: [
    { value: "api", label: "API service" },
    { value: "web", label: "Web client" },
  ],
};

const single: QuestionView = {
  id: "env",
  label: "Environment",
  prompt: "Where?",
  type: "single",
  required: true,
  options: [
    { value: "staging", label: "Staging" },
    { value: "prod", label: "Production" },
  ],
};

const optional: QuestionView = {
  id: "note",
  label: "Note",
  prompt: "Anything else?",
  type: "single",
  required: false,
  options: [],
  freeform: true,
};

describe("rich path (ask envelope present)", () => {
  it("sends option values, not labels", () => {
    const answer = buildQuestionAnswer("req-1", "flow-1", [multi], {
      selected: { targets: ["api", "web"] },
      custom: {},
    });
    expect(answer).toMatchObject({
      requestId: "req-1",
      flowId: "flow-1",
      summary: "API service, Web client",
      answers: { targets: { values: ["api", "web"] } },
    });
  });

  it("carries free text as customText", () => {
    const answer = buildQuestionAnswer("req-2", "flow-2", [optional], {
      selected: {},
      custom: { note: "  just the docs  " },
    });
    expect(answer?.answers).toEqual({ note: { customText: "just the docs" } });
    expect(answer?.summary).toBe("just the docs");
  });

  it("covers several questions in one atomic submit", () => {
    const answer = buildQuestionAnswer("req-3", "flow-3", [single, multi], {
      selected: { env: ["prod"], targets: ["api"] },
      custom: {},
    });
    expect(answer?.answers).toEqual({
      env: { values: ["prod"] },
      targets: { values: ["api"] },
    });
    expect(answer?.summary).toBe("Production, API service");
  });
});

describe("degraded path (no ask envelope)", () => {
  it("sends the label and omits the structured answers", () => {
    const answer = buildQuestionAnswer("req-4", undefined, [single], {
      selected: { env: ["staging"] },
      custom: {},
    });
    expect(answer).toMatchObject({ label: "Staging", summary: "Staging" });
    // Sending `answers` without a flow id is unrouteable.
    expect(answer?.answers).toBeUndefined();
  });
});

describe("incomplete selections", () => {
  it("refuses to submit while a required question is blank", () => {
    expect(
      buildQuestionAnswer("req-5", "flow-5", [single, multi], {
        selected: { env: ["prod"] },
        custom: {},
      }),
    ).toBeNull();
  });

  it("skips an optional question and still submits", () => {
    const answer = buildQuestionAnswer("req-6", "flow-6", [single, optional], {
      selected: { env: ["prod"] },
      custom: {},
    });
    expect(answer?.answers).toEqual({ env: { values: ["prod"] } });
  });

  it("refuses an entirely empty submit", () => {
    expect(buildQuestionAnswer("req-7", "flow-7", [optional], { selected: {}, custom: {} })).toBeNull();
  });
});

describe("cancellation", () => {
  it("is distinct from an answer and carries the flow id", () => {
    expect(cancelAnswer("req-8", "flow-8")).toEqual({
      requestId: "req-8",
      summary: "cancelled",
      flowId: "flow-8",
      cancelled: true,
    });
  });
});

describe("summarizeSelection", () => {
  it("falls back to a placeholder when nothing was chosen", () => {
    expect(summarizeSelection([single], { selected: {}, custom: {} })).toBe("answered");
  });

  it("uses the value when the label is missing", () => {
    expect(
      summarizeSelection(
        [{ ...single, options: [] }],
        { selected: { env: ["raw-value"] }, custom: {} },
      ),
    ).toBe("raw-value");
  });
});
