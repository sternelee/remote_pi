"use client";

/**
 * Turn notifications + unread badge, for the session page.
 *
 * Raises a Web Notification when a turn finishes, the Pi asks a question or the
 * session errors — but only while the tab is hidden, since a visible tab already
 * shows the result.
 *
 * This hook deliberately does **not** write `document.title`: the session page
 * already composes it from the Pi's `setTitle` display control, and two writers
 * would clobber each other. It exposes `unread` instead, and the page prefixes
 * the title with it.
 *
 * No server is involved: this is the Notification API, not Web Push, so it only
 * works while the page is alive (a background tab, not a closed browser).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { notificationPermission, notificationsFor, shouldRaise, type NotifyEvent } from "./notify";
import type { TranscriptState } from "./transcript";

/** How long to wait for a service worker before falling back to the constructor. */
const SW_READY_TIMEOUT_MS = 2_000;

/**
 * The Badging API is not in `lib.dom` for every TS version, so it is modelled
 * structurally. `lib.dom` may already declare these on `Navigator`, hence the
 * cast through `unknown` at the call site rather than an interface extension.
 */
interface AppBadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/**
 * Raise one notification.
 *
 * Android Chrome and iOS Safari cannot construct `Notification` at all — those
 * engines require the service-worker path — so the worker is tried first and the
 * constructor is the desktop / no-worker fallback. Everything here is
 * best-effort: a browser that allows neither shows nothing rather than breaking
 * the session.
 */
async function raiseNotification(event: NotifyEvent): Promise<void> {
  const options: NotificationOptions = { body: event.body, tag: event.key };

  if ("serviceWorker" in navigator) {
    try {
      // `ready` never settles while nothing is registered (dev, or a browser
      // with workers disabled), so it is raced rather than awaited outright.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), SW_READY_TIMEOUT_MS);
        }),
      ]);
      if (registration) {
        await registration.showNotification(event.title, options);
        return;
      }
    } catch {
      /* fall through to the constructor */
    }
  }

  new Notification(event.title, options);
}

export interface Notifications {
  permission: NotificationPermission | "unsupported";
  /** Events raised since the tab was last visible. */
  unread: number;
  /** Ask for permission; resolves to the resulting state. */
  request: () => Promise<NotificationPermission | "unsupported">;
  /** Drop the unread count (title + badge). */
  clear: () => void;
}

export function useNotifications({
  transcript,
  label,
  enabled,
}: {
  transcript: TranscriptState;
  /** Shown as the notification source, e.g. the project name. */
  label: string;
  enabled: boolean;
}): Notifications {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    () => (typeof window === "undefined" ? "unsupported" : notificationPermission()),
  );
  const [unread, setUnread] = useState(0);
  const previous = useRef<TranscriptState | null>(null);

  const clear = useCallback(() => setUnread(0), []);

  const request = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return notificationPermission();
    }
  }, []);

  // Derive events from the transcript transition. The first observation only
  // seeds the baseline: on reload the whole mirrored history would otherwise
  // look like it just happened.
  useEffect(() => {
    const prev = previous.current;
    previous.current = transcript;
    if (!prev) return;

    const events = notificationsFor(prev, transcript, label);
    if (events.length === 0) return;

    const hidden = document.visibilityState === "hidden";
    const raise = shouldRaise({ enabled, permission, hidden });

    for (const event of events) {
      if (raise) {
        // Fire-and-forget keeps the loop synchronous, so the unread accounting
        // below cannot be skipped by an async gap.
        void raiseNotification(event).catch(() => {
          /* some engines refuse to notify at all */
        });
      }
      // Unread only counts what the user could not see happen. Gating on
      // `enabled` too would ratchet the count up on a tab the user is watching,
      // and nothing clears it until the tab is hidden and shown again.
      if (hidden) setUnread((count) => count + 1);
    }
  }, [transcript, label, enabled, permission]);

  // The installed-app badge follows the unread count. The title is the page's
  // business (it also carries the Pi's `setTitle`).
  useEffect(() => {
    const nav = navigator as unknown as AppBadgeNavigator;
    const setBadge = nav.setAppBadge;
    if (typeof setBadge !== "function") return;
    const update = unread > 0 ? setBadge.call(nav, unread) : nav.clearAppBadge?.call(nav);
    void update?.catch(() => {
      /* badge is decorative */
    });
  }, [unread]);

  // Coming back to the tab means the user has seen it.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") clear();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clear]);

  // Leaving the session page releases the badge: it would otherwise keep
  // pointing at a session the user has navigated away from.
  useEffect(
    () => () => {
      const nav = navigator as unknown as AppBadgeNavigator;
      void nav.clearAppBadge?.call(nav)?.catch(() => {
        /* badge is decorative */
      });
    },
    [],
  );

  return { permission, unread, request, clear };
}
