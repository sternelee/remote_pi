/**
 * PWA registration and update decisions.
 *
 * These live in pure helpers because vitest runs with `import.meta.env.PROD`
 * false, so the hook's effect body never executes under test.
 *
 * The controller tests drive a *sequence* through one tracker instance rather
 * than passing an explicit `controlled` argument per call. That distinction is
 * the whole point: a test that supplies the flag itself cannot catch the
 * regression it exists for — a hook that latches the mount-time snapshot passes
 * every such test while silently swallowing every later deploy. Letting the
 * tracker own the flag makes the carry-forward structural, and driving a
 * sequence pins it.
 */

import { describe, expect, it } from "vitest";

import { createControllerTracker, shouldRegister } from "../lib/pwa";

describe("shouldRegister", () => {
  it("registers only in production, and only where workers exist", () => {
    expect(shouldRegister({ prod: true, hasServiceWorker: true })).toBe(true);
    expect(shouldRegister({ prod: false, hasServiceWorker: true })).toBe(false);
    expect(shouldRegister({ prod: true, hasServiceWorker: false })).toBe(false);
    expect(shouldRegister({ prod: false, hasServiceWorker: false })).toBe(false);
  });
});

describe("createControllerTracker", () => {
  it("does not announce the install hand-off on a previously uncontrolled page", () => {
    // First visit: registering the worker is what controls the page, so this
    // change is the install, not a deploy.
    const tracker = createControllerTracker(false);
    expect(tracker.observe({ cancelled: false })).toEqual({ announce: false });
  });

  it("announces a change on a page that was already controlled", () => {
    const tracker = createControllerTracker(true);
    expect(tracker.observe({ cancelled: false })).toEqual({ announce: true });
  });

  it("carries the flag forward, so a deploy after a first install still announces", () => {
    // The regression this guards: latching the mount-time snapshot left the flag
    // false for the rest of the page's life, so a deploy after a first install
    // was silently swallowed. One tracker instance, two changes.
    const tracker = createControllerTracker(false);
    expect(tracker.observe({ cancelled: false }).announce).toBe(false); // install
    expect(tracker.observe({ cancelled: false }).announce).toBe(true); // deploy
  });

  it("keeps announcing on every later change", () => {
    const tracker = createControllerTracker(true);
    expect(tracker.observe({ cancelled: false }).announce).toBe(true);
    expect(tracker.observe({ cancelled: false }).announce).toBe(true);
  });

  it("never announces once the effect has been torn down", () => {
    const tracker = createControllerTracker(true);
    expect(tracker.observe({ cancelled: true })).toEqual({ announce: false });
  });

  it("does not let a cancelled change consume the install hand-off", () => {
    // The cancel check runs before the flag advances, so a torn-down effect does
    // not burn the one change that has to be swallowed.
    const tracker = createControllerTracker(false);
    expect(tracker.observe({ cancelled: true }).announce).toBe(false);
    expect(tracker.observe({ cancelled: false }).announce).toBe(false); // install
    expect(tracker.observe({ cancelled: false }).announce).toBe(true); // deploy
  });
});
