import { afterEach, describe, expect, test } from "vitest";
import {
  _handleSupervisorUiFrame,
  _mapSupervisorUiFrame,
  _setSupervisorUiBridgeForTest,
  _uiResponseFor,
} from "./index.js";
import type { SupervisorUiBridge } from "./daemon/ui_bridge.js";

/**
 * Plan/58 primitive B — frame mapping + interactive-cancel behavior. These are
 * the pure/isolated pieces of the `ctx.ui.*` forwarding path; the socket
 * plumbing is covered in `daemon/supervisor.test.ts` and
 * `daemon/ui_bridge.test.ts`.
 */

type Frame = { type: "extension_ui_request"; id: string } & Record<string, unknown>;

function frame(fields: Record<string, unknown>): Frame {
  return { type: "extension_ui_request", id: "rpc-1", ...fields };
}

describe("_uiResponseFor", () => {
  test("maps an explicit cancelled/confirmed/value answer", () => {
    expect(_uiResponseFor({ cancelled: true })).toEqual({ cancelled: true });
    expect(_uiResponseFor({ confirmed: false })).toEqual({ confirmed: false });
    expect(_uiResponseFor({ value: "b" })).toEqual({ value: "b" });
    expect(_uiResponseFor({})).toEqual({});
  });

  test("translates the app's Yes/No label into a confirm boolean", () => {
    expect(_uiResponseFor({ value: "Yes" }, "confirm")).toEqual({ confirmed: true });
    expect(_uiResponseFor({ value: "No" }, "confirm")).toEqual({ confirmed: false });
  });

  test("keeps the label for select/input/editor", () => {
    expect(_uiResponseFor({ value: "Yes" }, "select")).toEqual({ value: "Yes" });
    expect(_uiResponseFor({ value: "hi" }, "input")).toEqual({ value: "hi" });
    expect(_uiResponseFor({ value: "hi" }, "editor")).toEqual({ value: "hi" });
  });

  test("cancel wins over a value", () => {
    expect(_uiResponseFor({ value: "Yes", cancelled: true }, "confirm")).toEqual({
      cancelled: true,
    });
  });
});

describe("_mapSupervisorUiFrame", () => {
  test("select → options + namespaced id", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "select", title: "T", options: ["a", "b"] }), "ui:rpc-1"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:rpc-1",
      method: "select",
      title: "T",
      options: ["a", "b"],
    });
  });

  test("select drops non-string options and tolerates a missing title", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "select", options: ["a", 3, null] }), "ui:x"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "select",
      title: "",
      options: ["a"],
    });
  });

  test("confirm → title + message", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "confirm", title: "ok?", message: "sure?" }), "ui:rpc-1"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:rpc-1",
      method: "confirm",
      title: "ok?",
      message: "sure?",
    });
  });

  test("input → placeholder only when present", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "input", title: "Name", placeholder: "type…" }), "ui:x"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "input",
      title: "Name",
      placeholder: "type…",
    });
    expect(
      _mapSupervisorUiFrame(frame({ method: "input", title: "Name" }), "ui:x"),
    ).toEqual({ type: "extension_ui_request", id: "ui:x", method: "input", title: "Name" });
  });

  test("editor → prefill only when present", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "editor", title: "Edit", prefill: "hi" }), "ui:x"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "editor",
      title: "Edit",
      prefill: "hi",
    });
    expect(
      _mapSupervisorUiFrame(frame({ method: "editor", title: "Edit" }), "ui:x"),
    ).toEqual({ type: "extension_ui_request", id: "ui:x", method: "editor", title: "Edit" });
  });

  test("notify → notify_type mapped only for known values", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "notify", message: "m", notifyType: "warning" }), "ui:x"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "notify",
      message: "m",
      notify_type: "warning",
    });
    expect(
      _mapSupervisorUiFrame(frame({ method: "notify", message: "m" }), "ui:x"),
    ).toEqual({ type: "extension_ui_request", id: "ui:x", method: "notify", message: "m" });
  });

  test("setStatus → status_key + optional status_text", () => {
    expect(
      _mapSupervisorUiFrame(frame({ method: "setStatus", statusKey: "k", statusText: "v" }), "ui:x"),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "setStatus",
      status_key: "k",
      status_text: "v",
    });
    expect(
      _mapSupervisorUiFrame(frame({ method: "setStatus", statusKey: "k" }), "ui:x"),
    ).toEqual({ type: "extension_ui_request", id: "ui:x", method: "setStatus", status_key: "k" });
  });

  test("setWidget → widget_key + optional lines/placement", () => {
    expect(
      _mapSupervisorUiFrame(
        frame({ method: "setWidget", widgetKey: "w", widgetLines: ["a"], widgetPlacement: "belowEditor" }),
        "ui:x",
      ),
    ).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "setWidget",
      widget_key: "w",
      widget_lines: ["a"],
      widget_placement: "belowEditor",
    });
    expect(
      _mapSupervisorUiFrame(frame({ method: "setWidget", widgetKey: "w" }), "ui:x"),
    ).toEqual({ type: "extension_ui_request", id: "ui:x", method: "setWidget", widget_key: "w" });
  });

  test("setTitle + set_editor_text", () => {
    expect(_mapSupervisorUiFrame(frame({ method: "setTitle", title: "T" }), "ui:x")).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "setTitle",
      title: "T",
    });
    expect(_mapSupervisorUiFrame(frame({ method: "set_editor_text", text: "hi" }), "ui:x")).toEqual({
      type: "extension_ui_request",
      id: "ui:x",
      method: "set_editor_text",
      text: "hi",
    });
  });

  test("unknown method → null", () => {
    expect(_mapSupervisorUiFrame(frame({ method: "frobnicate" }), "ui:x")).toBeNull();
  });
});

describe("_handleSupervisorUiFrame — interactive cancel with no peer", () => {
  afterEach(() => _setSupervisorUiBridgeForTest(null));

  test("select/confirm/input/editor cancel immediately when no app is attached", () => {
    const calls: Array<{ id: string; resp: unknown }> = [];
    const fake = {
      respond: (id: string, resp: unknown) => { calls.push({ id, resp }); },
    } as unknown as SupervisorUiBridge;
    _setSupervisorUiBridgeForTest(fake);

    for (const method of ["select", "confirm", "input", "editor"]) {
      _handleSupervisorUiFrame(frame({ method, title: "T" }));
    }
    expect(calls).toEqual([
      { id: "rpc-1", resp: { cancelled: true } },
      { id: "rpc-1", resp: { cancelled: true } },
      { id: "rpc-1", resp: { cancelled: true } },
      { id: "rpc-1", resp: { cancelled: true } },
    ]);
  });

  test("display-only methods never call respond (even with no peer)", () => {
    const calls: unknown[] = [];
    const fake = {
      respond: (id: string, resp: unknown) => { calls.push({ id, resp }); },
    } as unknown as SupervisorUiBridge;
    _setSupervisorUiBridgeForTest(fake);

    _handleSupervisorUiFrame(frame({ method: "notify", message: "m" }));
    _handleSupervisorUiFrame(frame({ method: "setTitle", title: "T" }));
    expect(calls).toEqual([]);
  });

  test("unknown methods are ignored", () => {
    const calls: unknown[] = [];
    const fake = {
      respond: (id: string, resp: unknown) => { calls.push({ id, resp }); },
    } as unknown as SupervisorUiBridge;
    _setSupervisorUiBridgeForTest(fake);
    _handleSupervisorUiFrame(frame({ method: "frobnicate" }));
    expect(calls).toEqual([]);
  });
});
