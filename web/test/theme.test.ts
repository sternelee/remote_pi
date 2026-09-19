/**
 * Theme resolution — the pure half of the light/system/dark switcher.
 *
 * The DOM side is deliberately guarded (`typeof document === "undefined"`), so
 * these run under the Node test environment while still covering the mapping
 * and the module-level resolved-theme store that deep leaves subscribe to.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  currentResolvedTheme,
  publishResolvedTheme,
  resolveTheme,
  subscribeResolvedTheme,
  systemPrefersDark,
} from "../lib/theme";

afterEach(() => {
  publishResolvedTheme("dark");
});

describe("resolveTheme", () => {
  it("follows the OS preference in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the OS preference for an explicit choice", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("systemPrefersDark", () => {
  it("defaults to dark without a window", () => {
    expect(systemPrefersDark()).toBe(true);
  });
});

describe("applyTheme", () => {
  it("is a no-op without a document", () => {
    expect(() => applyTheme("light")).not.toThrow();
  });
});

describe("resolved theme store", () => {
  it("notifies subscribers only when the value changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeResolvedTheme(listener);

    publishResolvedTheme("light");
    expect(currentResolvedTheme()).toBe("light");
    expect(listener).toHaveBeenCalledTimes(1);

    publishResolvedTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);

    publishResolvedTheme("dark");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishResolvedTheme("light");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
