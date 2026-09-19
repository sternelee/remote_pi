/**
 * Preference hydration/mapping — the pure half of the settings store.
 *
 * The store itself needs IndexedDB (absent under Node), so these cover the
 * helpers that translate persisted `Settings` to/from the camelCase `prefs`
 * object the session exposes.
 */

import { describe, expect, it } from "vitest";

import { prefsFrom, settingsPatchForPrefs } from "../lib/storage/store";

describe("preferences", () => {
  it("defaults to visible tool calls, an unacknowledged voice notice and system theme", () => {
    expect(prefsFrom(undefined)).toEqual({
      hideToolCalls: false,
      voiceNoticeAck: false,
      theme: "system",
    });
    expect(prefsFrom({})).toEqual({ hideToolCalls: false, voiceNoticeAck: false, theme: "system" });
  });

  it("hydrates from stored settings", () => {
    expect(prefsFrom({ hide_tool_calls: true, voice_notice_ack: true, theme: "light" })).toEqual({
      hideToolCalls: true,
      voiceNoticeAck: true,
      theme: "light",
    });
  });

  it("maps a patch to the persisted settings field names", () => {
    expect(settingsPatchForPrefs({ hideToolCalls: true })).toEqual({ hide_tool_calls: true });
    expect(settingsPatchForPrefs({ voiceNoticeAck: false })).toEqual({ voice_notice_ack: false });
    expect(settingsPatchForPrefs({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(settingsPatchForPrefs({})).toEqual({});
  });
});
