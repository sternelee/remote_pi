/**
 * Ephemeral UI state pushed by one-way `extension_ui_request` controls.
 *
 * `setStatus` / `setWidget` / `setTitle` / `set_editor_text` (plan/65) mutate
 * session chrome — a status line, widget blocks, the window title and the
 * composer draft — and are never answered. Unlike the interactive prompts
 * (select/confirm/input/editor/notify) they must NOT become transcript
 * entries, so the session layer folds them here instead of through
 * `applyMessage`.
 *
 * Pure and framework-free so the semantics are unit-testable without React.
 */

import type { ExtensionUiRequestWire } from "../protocol/types";

/** The four one-way, display-only methods. */
export type UiControlMethod = "setStatus" | "setWidget" | "setTitle" | "set_editor_text";

export interface UiControlState {
  /** Session window title (`setTitle`). */
  title?: string;
  /** Status-line entries keyed by `status_key`. */
  statuses: Record<string, string>;
  /** Widget blocks keyed by `widget_key`. */
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  /** Latest composer draft, with a monotonically increasing sequence number. */
  editorText?: { text: string; seq: number };
}

/** The empty control state a fresh connection starts from. */
export const emptyUiControl: UiControlState = { statuses: {}, widgets: {} };

/** Narrow an `extension_ui_request` to one of the four one-way controls. */
export type UiControlRequest = Extract<ExtensionUiRequestWire, { method: UiControlMethod }>;

/**
 * True when a message is a display-only `extension_ui_request`.
 *
 * A type predicate so callers can hand the narrowed message straight to
 * `reduceUiControl` without a cast.
 */
export function isUiControl(
  message: { type: string; method?: string },
): message is UiControlRequest {
  return (
    message.type === "extension_ui_request" &&
    (message.method === "setStatus" ||
      message.method === "setWidget" ||
      message.method === "setTitle" ||
      message.method === "set_editor_text")
  );
}

/**
 * Fold one control message into the state.
 *
 * Returns the SAME reference when the message is not one of the four controls
 * (or when a branch changes nothing observable), so React can bail out of the
 * re-render. Changed branches always return fresh objects and never mutate.
 */
export function reduceUiControl(
  state: UiControlState,
  message: ExtensionUiRequestWire,
): UiControlState {
  switch (message.method) {
    case "setStatus": {
      const statuses = { ...state.statuses };
      if (message.status_text) statuses[message.status_key] = message.status_text;
      else delete statuses[message.status_key];
      return { ...state, statuses };
    }
    case "setWidget": {
      const widgets = { ...state.widgets };
      if (message.widget_lines?.length) {
        widgets[message.widget_key] = {
          lines: message.widget_lines,
          placement: message.widget_placement ?? "aboveEditor",
        };
      } else {
        delete widgets[message.widget_key];
      }
      return { ...state, widgets };
    }
    case "setTitle":
      return { ...state, title: message.title };
    case "set_editor_text":
      return {
        ...state,
        editorText: { text: message.text, seq: (state.editorText?.seq ?? 0) + 1 },
      };
    default:
      return state;
  }
}
