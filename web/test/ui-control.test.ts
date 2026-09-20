/**
 * Pure tests for the one-way extension UI controls (plan/65).
 *
 * These methods mutate ephemeral session chrome (status line, widgets, title,
 * composer draft) and must never reach the transcript. The reducer is a pure
 * function so the semantics are pinned here without React.
 */

import { describe, expect, it } from "vitest";

import type { ExtensionUiRequestWire } from "../lib/protocol/types";
import {
  emptyUiControl,
  isUiControl,
  reduceUiControl,
  type UiControlState,
} from "../lib/session/ui_control";

const status = (
  overrides: Partial<Extract<ExtensionUiRequestWire, { method: "setStatus" }>> = {},
): ExtensionUiRequestWire => ({
  type: "extension_ui_request",
  id: "s",
  method: "setStatus",
  status_key: "goal",
  status_text: "running",
  ...overrides,
});

const widget = (
  overrides: Partial<Extract<ExtensionUiRequestWire, { method: "setWidget" }>> = {},
): ExtensionUiRequestWire => ({
  type: "extension_ui_request",
  id: "w",
  method: "setWidget",
  widget_key: "todo",
  widget_lines: ["a", "b"],
  ...overrides,
});

describe("isUiControl", () => {
  it("recognises the four one-way methods", () => {
    for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text"]) {
      expect(isUiControl({ type: "extension_ui_request", method }), method).toBe(true);
    }
  });

  it("rejects interactive prompts and unrelated messages", () => {
    expect(isUiControl({ type: "extension_ui_request", method: "select" })).toBe(false);
    expect(isUiControl({ type: "extension_ui_request", method: "notify" })).toBe(false);
    expect(isUiControl({ type: "agent_chunk" })).toBe(false);
    expect(isUiControl({ type: "extension_ui_response", method: "setTitle" })).toBe(false);
  });
});

describe("reduceUiControl", () => {
  it("starts empty", () => {
    expect(emptyUiControl).toEqual({ statuses: {}, widgets: {} });
  });

  it("sets and clears a status entry without mutating the input", () => {
    const set = reduceUiControl(emptyUiControl, status());
    expect(set.statuses).toEqual({ goal: "running" });
    expect(emptyUiControl.statuses).toEqual({});

    expect(reduceUiControl(set, status({ id: "s2", status_text: undefined })).statuses).toEqual({});
    expect(reduceUiControl(set, status({ id: "s3", status_text: "" })).statuses).toEqual({});
  });

  it("sets a widget with the default placement and honours belowEditor", () => {
    const above = reduceUiControl(emptyUiControl, widget());
    expect(above.widgets).toEqual({ todo: { lines: ["a", "b"], placement: "aboveEditor" } });

    const below = reduceUiControl(above, widget({ id: "w2", widget_lines: ["c"], widget_placement: "belowEditor" }));
    expect(below.widgets).toEqual({ todo: { lines: ["c"], placement: "belowEditor" } });
  });

  it("clears a widget when lines are missing or empty", () => {
    const withWidget = reduceUiControl(emptyUiControl, widget());
    expect(reduceUiControl(withWidget, widget({ id: "w2", widget_lines: undefined })).widgets).toEqual({});
    expect(reduceUiControl(withWidget, widget({ id: "w3", widget_lines: [] })).widgets).toEqual({});
  });

  it("sets the session title", () => {
    const titled = reduceUiControl(emptyUiControl, {
      type: "extension_ui_request",
      id: "t",
      method: "setTitle",
      title: "Build remote_pi",
    });
    expect(titled.title).toBe("Build remote_pi");
  });

  it("increments editorText.seq across pushes", () => {
    const first = reduceUiControl(emptyUiControl, {
      type: "extension_ui_request",
      id: "e1",
      method: "set_editor_text",
      text: "one",
    });
    expect(first.editorText).toEqual({ text: "one", seq: 1 });

    const second = reduceUiControl(first, {
      type: "extension_ui_request",
      id: "e2",
      method: "set_editor_text",
      text: "two",
    });
    expect(second.editorText).toEqual({ text: "two", seq: 2 });
  });

  it("returns the same reference for a non-control message", () => {
    const state: UiControlState = { statuses: {}, widgets: {} };
    const select: ExtensionUiRequestWire = {
      type: "extension_ui_request",
      id: "sel",
      method: "select",
      title: "Pick",
      options: ["a"],
    };
    expect(reduceUiControl(state, select)).toBe(state);
  });
});
