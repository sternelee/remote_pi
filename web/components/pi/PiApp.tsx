"use client";

import { useEffect, useRef, useState } from "react";

import { parseHash, routeToHash } from "@/lib/session/route";
import { usePiSession } from "@/lib/session/usePiSession";
import { useTheme } from "@/lib/theme";
import { HomeScreen } from "./HomeScreen";
import { PairScreen } from "./PairScreen";
import { SessionScreen } from "./SessionScreen";

type View = "home" | "session" | "pair";

/**
 * Top-level client shell.
 *
 * Everything below this point is browser-only: WebCrypto, WebSocket and
 * IndexedDB have no server-side equivalent, so the page prerenders as an empty
 * shell and the session boots on hydration.
 *
 * The active view is mirrored into the URL hash (`lib/session/route.ts`) so a
 * reload or a shared link reopens the same Pi room.
 */
export function PiApp() {
  const session = usePiSession();
  useTheme(session.prefs.theme);
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "home";
    return parseHash(window.location.hash).view;
  });
  const [pending, setPending] = useState<{ epk: string; roomId: string } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useServiceWorker();

  const live = session.phase === "live" || (session.phase === "connecting" && session.activePeer);

  // Deep link on first load. The peer roster only exists after boot, so a
  // session hash is remembered and opened once the peer is known.
  useEffect(() => {
    const route = parseHash(window.location.hash);
    if (route.view === "session") setPending({ epk: route.epk, roomId: route.roomId });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const active = session.activePeer;
    if (active && active.remote_epk === pending.epk && active.room_id === pending.roomId) {
      setPending(null);
      return;
    }
    if (!session.peers.some((p) => p.remote_epk === pending.epk)) {
      // Boot finished without such a peer: the link is stale, so show the list.
      if (session.phase === "ready") {
        setPending(null);
        setView("home");
      }
      return;
    }
    session.openProject(pending.epk, pending.roomId);
    setPending(null);
  }, [pending, session.peers, session.phase, session.activePeer, session.openProject]);

  // Back/forward navigation (external hash changes) — never our own writes,
  // which land on the active room and are ignored below.
  useEffect(() => {
    const onHash = () => {
      const route = parseHash(window.location.hash);
      if (route.view === "home") return setView("home");
      if (route.view === "pair") return setView("pair");
      const active = sessionRef.current.activePeer;
      if (active && active.remote_epk === route.epk && active.room_id === route.roomId) {
        return setView("session");
      }
      setPending({ epk: route.epk, roomId: route.roomId });
      setView("session");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Mirror the current view into the hash. Idempotent, and it leaves a pending
  // deep link alone until its peer resolves (so it never clobbers it with #/).
  useEffect(() => {
    const desired =
      view === "session"
        ? session.activePeer
          ? routeToHash({
              view: "session",
              epk: session.activePeer.remote_epk,
              roomId: session.activePeer.room_id,
            })
          : null
        : view === "pair"
          ? routeToHash({ view: "pair" })
          : routeToHash({ view: "home" });
    if (!desired) return;
    if (window.location.hash !== desired) window.location.hash = desired;
  }, [view, session.activePeer]);

  return (
    <main className="min-h-dvh bg-[var(--pi-bg)] text-[var(--pi-fg)]">
      {session.phase === "booting" ? <Centered text="Loading identity…" /> : null}

      {session.phase === "unsupported" ? (
        <Centered text="This browser cannot do Ed25519 in WebCrypto. Remote Pi needs it to authenticate with the relay — try a recent Chrome, Safari or Firefox." />
      ) : null}

      {session.phase !== "booting" && session.phase !== "unsupported" && view === "home" ? (
        <HomeScreen
          projects={session.projects}
          onOpen={(epk, roomId) => {
            session.openProject(epk, roomId);
            setView("session");
          }}
          onPair={() => setView("pair")}
        />
      ) : null}

      {session.phase !== "booting" && session.phase !== "unsupported" && view === "session" ? (
        <>
          <SessionScreen session={session} onHome={() => setView("home")} />
          <div className="fixed bottom-2 right-3">
            <button
              type="button"
              onClick={() => setView("pair")}
              className="font-mono text-[11px] underline-offset-2 hover:underline"
              style={{ color: "var(--pi-dim)" }}
            >
              {session.peers.length > 1 ? "switch / pair another Pi" : "pair another Pi"}
            </button>
          </div>
        </>
      ) : null}

      {session.phase !== "booting" && session.phase !== "unsupported" && view === "pair" ? (
        <div className="px-3 py-6 sm:px-5">
          <div className="mx-auto mb-4 flex w-full max-w-2xl items-baseline gap-3">
            <button
              type="button"
              onClick={() => setView(live ? "session" : "home")}
              className="font-mono text-[12px] underline-offset-2 hover:underline"
              style={{ color: "var(--pi-muted)" }}
            >
              ← {live ? "session" : "projects"}
            </button>
          </div>
          <PairScreen
            relayUrl={session.relayUrl}
            peers={session.peers}
            notices={session.notices}
            onPair={async (raw) => {
              await session.pairFromQr(raw);
              setView("session");
            }}
            onSelectPeer={(epk) => {
              session.selectPeer(epk);
              setView("session");
            }}
            onForgetPeer={session.forgetPeer}
            onRelayUrlChange={session.setRelayUrl}
            onDismissNotice={session.dismissNotice}
          />
        </div>
      ) : null}
    </main>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <p className="max-w-prose text-center font-mono text-[13px] leading-[1.6] text-[var(--pi-muted)]">
        {text}
      </p>
    </div>
  );
}

/**
 * Register the PWA service worker.
 *
 * Production only: a cache-first SW in front of Vite's dev server breaks HMR
 * and serves stale modules, which is a well-known footgun.
 */
function useServiceWorker() {
  useEffect(() => {
    if (!import.meta.env?.PROD) return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is best-effort */
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
}
