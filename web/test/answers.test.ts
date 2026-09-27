/**
 * Answer construction for interactive prompts — the two wire paths.
 *
 * These guard the failure mode that is invisible over the wire: a rich prompt
 * answered with a bare label, or a degraded prompt answered with structured
 * `answers`, is accepted by the transport and then dropped by the Pi.
 */

import { describe, expect, it } from "vitest";

import {
  answerToWire,
  buildQuestionAnswer,
  cancelAnswer,
  summarizeSelection,
} from "../lib/session/answers";
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

describe("notes", () => {
  it("carries a question note, trimmed", () => {
    const answer = buildQuestionAnswer("req-9", "flow-9", [single], {
      selected: { env: ["prod"] },
      custom: {},
      notes: { env: "  why not staging?  " },
    });
    expect(answer?.answers).toEqual({
      env: { values: ["prod"], note: "why not staging?" },
    });
    expect(answer?.summary).toBe("Production, why not staging?");
  });

  it("carries option notes keyed by value and drops blank ones", () => {
    const answer = buildQuestionAnswer("req-10", "flow-10", [multi], {
      selected: { targets: ["api"] },
      custom: {},
      optionNotes: { targets: { web: "  is it SSR?  ", api: "   " } },
    });
    expect(answer?.answers).toEqual({
      targets: { values: ["api"], optionNotes: { web: "is it SSR?" } },
    });
    expect(answer?.summary).toBe("API service, Web client: is it SSR?");
  });

  it("lets a note fill a required question", () => {
    const answer = buildQuestionAnswer("req-11", "flow-11", [single], {
      selected: {},
      custom: {},
      notes: { env: "which one is cheaper?" },
    });
    expect(answer?.answers).toEqual({ env: { note: "which one is cheaper?" } });
    expect(answer?.summary).toBe("which one is cheaper?");
  });

  it("still refuses a required question with neither answer nor note", () => {
    expect(
      buildQuestionAnswer("req-12", "flow-12", [single], {
        selected: {},
        custom: {},
        notes: { env: "   " },
      }),
    ).toBeNull();
  });
});

describe("elaborate mode", () => {
  it("defaults to submit", () => {
    const answer = buildQuestionAnswer("req-13", "flow-13", [single], {
      selected: { env: ["prod"] },
      custom: {},
    });
    expect(answer?.mode).toBe("submit");
  });

  it("carries the mode plus the notes pi-ask turns into elaboration items", () => {
    const answer = buildQuestionAnswer(
      "req-14",
      "flow-14",
      [single],
      { selected: { env: ["prod"] }, custom: {}, notes: { env: "what does prod cost?" } },
      "elaborate",
    );
    expect(answer).toMatchObject({
      mode: "elaborate",
      answers: { env: { values: ["prod"], note: "what does prod cost?" } },
    });
  });

  it("does not let a blank required question block an elaborate", () => {
    const answer = buildQuestionAnswer(
      "req-15",
      "flow-15",
      [single, multi],
      { selected: {}, custom: {}, notes: { targets: "what are the trade-offs?" } },
      "elaborate",
    );
    expect(answer).toMatchObject({
      mode: "elaborate",
      answers: { targets: { note: "what are the trade-offs?" } },
    });
  });

  it("refuses an elaborate with no note to act on", () => {
    expect(
      buildQuestionAnswer(
        "req-16",
        "flow-16",
        [single],
        { selected: { env: ["prod"] }, custom: {} },
        "elaborate",
      ),
    ).toBeNull();
  });
});

describe("outbound wire frame", () => {
  it("sends the rich envelope with the answer's mode", () => {
    const answer = buildQuestionAnswer("req-17", "flow-17", [single], {
      selected: { env: ["prod"] },
      custom: {},
    });
    expect(answerToWire(answer!)).toEqual({
      type: "extension_ui_response",
      id: "req-17",
      ask: {
        flow_id: "flow-17",
        kind: "answer",
        mode: "submit",
        answers: { env: { values: ["prod"] } },
      },
    });
  });

  it("carries elaborate all the way to the wire", () => {
    const answer = buildQuestionAnswer(
      "req-18",
      "flow-18",
      [single],
      { selected: {}, custom: {}, notes: { env: "explain both" } },
      "elaborate",
    );
    expect(answerToWire(answer!)).toMatchObject({
      ask: { mode: "elaborate", answers: { env: { note: "explain both" } } },
    });
  });

  it("cancels through the ask envelope when a flow id is known", () => {
    expect(answerToWire(cancelAnswer("req-19", "flow-19"))).toEqual({
      type: "extension_ui_response",
      id: "req-19",
      ask: { flow_id: "flow-19", kind: "cancel" },
    });
  });

  it("falls back to the bare label without a flow id", () => {
    const answer = buildQuestionAnswer("req-20", undefined, [single], {
      selected: { env: ["staging"] },
      custom: {},
    });
    expect(answerToWire(answer!)).toEqual({
      type: "extension_ui_response",
      id: "req-20",
      value: "Staging",
    });
  });
});
