"use client";

/**
 * Service-worker registration and update surfacing.
 *
 * `vite-plugin-pwa` is configured with `registerType: "autoUpdate"`, so there is
 * no waiting worker to `SKIP_WAITING`: a new worker activates on its own. What
 * that leaves is a *page* still running the previous build's hashed chunks. The
 * client can only see this through `controllerchange`.
 *
 * The response is deliberately not an automatic reload. This is an agent client:
 * reloading mid-turn drops the transcript and interrupts the Pi. So the update is
 * surfaced and the user chooses the moment — and the banner says when a turn is
 * running, because that is exactly when reloading is a bad idea.
 *
 * `registration.update()` is also nudged whenever the tab becomes visible, so a
 * long-lived installed PWA notices a deploy instead of waiting for a restart.
 *
 * The decisions live in the exported pure functions below so they can be tested
 * without a browser: vitest runs with `import.meta.env.PROD` false, so nothing
 * inside the effect body executes under test.
 */

import { useCallback, useEffect, useState } from "react";

export interface ServiceWorkerState {
  /** A newer build has taken control; this page is running the previous one. */
  updateReady: boolean;
  reload: () => void;
  dismiss: () => void;
}

/** Registration is production-only: a worker in front of Vite breaks HMR and serves stale modules. */
export function shouldRegister({
  prod,
  hasServiceWorker,
}: {
  prod: boolean;
  hasServiceWorker: boolean;
}): boolean {
  return prod && hasServiceWorker;
}

export interface ControllerChangeOutcome {
  /** Whether the change means a newer build took over an already-live page. */
  announce: boolean;
}

/**
 * Track whether the page was already controlled by a service worker.
 *
 * The tracker OWNS the flag so the carry-forward cannot be got wrong by the
 * caller. Latching the mount-time snapshot instead suppresses the install
 * hand-off *and* every later deploy for the rest of that page's life (the page
 * is uncontrolled when the effect runs, because registering the worker is what
 * controls it) — and a caller that re-reads `navigator.serviceWorker.controller`
 * on every change looks identical to one that latches it.
 *
 * The first change in a page's life is the install hand-off, where the page is
 * already running the current build — announcing there would nag every fresh
 * install. Every later change is a deploy landing on an already-controlled page,
 * which is exactly the case the banner exists for.
 */
export function createControllerTracker(initialControlled: boolean): {
  observe(change: { cancelled: boolean }): ControllerChangeOutcome;
} {
  let controlled = initialControlled;
  return {
    observe({ cancelled }) {
      if (cancelled) return { announce: false };
      const announce = controlled;
      controlled = true;
      return { announce };
    },
  };
}

export function useServiceWorker(): ServiceWorkerState {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (
      !shouldRegister({
        prod: Boolean(import.meta.env?.PROD),
        hasServiceWorker: "serviceWorker" in navigator,
      })
    ) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;
    // The tracker holds the flag, so this effect has no snapshot to latch.
    const controller = createControllerTracker(Boolean(navigator.serviceWorker.controller));

    const onControllerChange = () => {
      if (!controller.observe({ cancelled }).announce) return;
      setUpdateReady(true);
      // A second update in the same session must be able to re-show the banner
      // the user previously deferred.
      setDismissed(false);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          registration = reg;
        })
        .catch(() => {
          /* offline support is best-effort */
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return {
    updateReady: updateReady && !dismissed,
    reload: useCallback(() => window.location.reload(), []),
    dismiss: useCallback(() => setDismissed(true), []),
  };
}
