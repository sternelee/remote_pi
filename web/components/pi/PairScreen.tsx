"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { isValidRelayUrl } from "@/lib/pairing/qr";
import type { PeerRecord } from "@/lib/storage/store";
import type { Notice } from "@/lib/session/usePiSession";

const ROSE = "var(--pi-rose)";
const FG = "var(--pi-fg)";
const DIM = "var(--pi-dim)";
const MUTED = "var(--pi-muted)";

/** Renders the official Remote Pi mark (`branding/logo-monochrome.svg`). */
function PiMark({ size = 44, color = ROSE }: { size?: number; color?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill={color}
      shapeRendering="crispEdges"
    >
      <rect x="290" y="368" width="444" height="68" rx="10" />
      <rect x="345" y="436" width="68" height="320" rx="10" />
      <rect x="611" y="436" width="68" height="320" rx="10" />
      <path d="M 679 720 Q 712 740 720 700 L 720 712 Q 720 756 668 756 L 668 736 Z" />
      <circle cx="780" cy="332" r="58" />
    </svg>
  );
}

/**
 * Pairing screen.
 *
 * Two ways in, because camera QR scanning is not universally available:
 * `BarcodeDetector` exists in Chromium/Android but not Safari or Firefox, so
 * the paste field is always present and the camera button only appears when
 * the API is really there.
 */
export function PairScreen({
  relayUrl,
  peers,
  notices,
  onPair,
  onSelectPeer,
  onForgetPeer,
  onRelayUrlChange,
  onDismissNotice,
}: {
  relayUrl: string;
  peers: PeerRecord[];
  /** Warnings raised by the transport while pairing — otherwise invisible. */
  notices: Notice[];
  onPair: (raw: string) => Promise<void>;
  onSelectPeer: (epk: string) => void;
  onForgetPeer: (epk: string) => Promise<void>;
  onRelayUrlChange: (url: string) => Promise<void>;
  onDismissNotice: (id: string) => void;
}) {
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRelay, setShowRelay] = useState(false);
  const [relayDraft, setRelayDraft] = useState(relayUrl);
  const [scanning, setScanning] = useState(false);

  useEffect(() => setRelayDraft(relayUrl), [relayUrl]);

  async function attempt(raw: string) {
    setError(null);
    setBusy(true);
    try {
      await onPair(raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-5">
      {/* ── welcome box ─────────────────────────────────────────────────── */}
      <fieldset
        className="min-w-0 rounded-[6px] border px-3 pb-3.5 pt-1 font-mono text-[13px] leading-[1.55] sm:px-4"
        style={{ borderColor: ROSE }}
      >
        <legend className="max-w-full truncate px-2" style={{ color: ROSE }}>
          Remote Pi <span style={{ color: MUTED }}>web</span>
        </legend>

        <div className="flex min-w-0 flex-col items-center gap-2 py-2 text-center">
          <PiMark />
          <div className="font-semibold" style={{ color: FG }}>
            Pair with your Pi
          </div>
          <p className="max-w-prose" style={{ color: MUTED }}>
            In the terminal where pi is running, run{" "}
            <span style={{ color: FG }}>/remote-pi pair</span> and scan the QR it prints.
            The token is single-use and expires after 60 seconds.
          </p>
        </div>

        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy || !supportsCameraScan()}
            onClick={() => setScanning(true)}
            className={cn(
              "rounded border px-3 py-1.5 text-left font-mono text-[13px] transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{ borderColor: ROSE, color: FG }}
            title={
              supportsCameraScan()
                ? "Scan the QR with this device's camera"
                : "This browser cannot scan QR codes — paste the link instead"
            }
          >
            Scan QR with camera
          </button>
          <button
            type="button"
            onClick={() => setShowRelay((v) => !v)}
            className="rounded border px-3 py-1.5 text-left font-mono text-[13px]"
            style={{ borderColor: DIM, color: FG }}
          >
            Relay: <span style={{ color: MUTED }}>{relayUrl}</span>
          </button>
        </div>

        {showRelay ? (
          <form
            className="mt-3 flex min-w-0 flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isValidRelayUrl(relayDraft)) {
                setError("Relay must be an http(s) or ws(s) URL.");
                return;
              }
              setError(null);
              void onRelayUrlChange(relayDraft.trim());
            }}
          >
            <label className="text-[12px]" style={{ color: MUTED }} htmlFor="relay">
              Relay URL — the Pi and this browser must use the same one
            </label>
            <div className="flex min-w-0 gap-2">
              <input
                id="relay"
                value={relayDraft}
                onChange={(event) => setRelayDraft(event.target.value)}
                spellCheck={false}
                className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 font-mono text-[13px] outline-none"
                style={{ borderColor: DIM, color: FG }}
              />
              <button
                type="submit"
                className="rounded border px-3 py-1 font-mono text-[13px]"
                style={{ borderColor: DIM, color: FG }}
              >
                Save
              </button>
            </div>
          </form>
        ) : null}
      </fieldset>

      {/* ── paste fallback ──────────────────────────────────────────────── */}
      <form
        className="flex min-w-0 flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (manual.trim()) void attempt(manual);
        }}
      >
        <label className="font-mono text-[12px]" style={{ color: MUTED }} htmlFor="qr">
          Or paste the pairing link
        </label>
        <div className="flex min-w-0 gap-2">
          <input
            id="qr"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="remotepi://pair?t=…&epk=…&n=…"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 font-mono text-[13px] outline-none placeholder:text-[var(--pi-dim)]"
            style={{ borderColor: DIM, color: FG }}
          />
          <button
            type="submit"
            disabled={busy || !manual.trim()}
            className="rounded border px-3 py-1 font-mono text-[13px] disabled:opacity-50"
            style={{ borderColor: ROSE, color: FG }}
          >
            {busy ? "Pairing…" : "Pair"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="flex min-w-0 items-baseline gap-2 font-mono text-[13px]">
          <span aria-hidden style={{ color: "var(--pi-red)" }}>
            ◆
          </span>
          <span className="min-w-0 break-words" style={{ color: "var(--pi-red)" }}>
            {error}
          </span>
        </div>
      ) : null}

      {/* Transport warnings (a refused send, a malformed frame, a dead socket)
          must be visible here too — pairing is exactly when they matter. */}
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="flex min-w-0 items-baseline gap-2 font-mono text-[11px]"
          style={{ color: notice.tone === "error" ? "var(--pi-red)" : "var(--pi-yellow)" }}
        >
          <span aria-hidden>◆</span>
          <span className="min-w-0 break-words">{notice.text}</span>
          <button
            type="button"
            onClick={() => onDismissNotice(notice.id)}
            className="shrink-0"
            style={{ color: DIM }}
          >
            dismiss
          </button>
        </div>
      ))}

      {/* ── already paired ─────────────────────────────────────────────── */}
      {peers.length > 0 ? (
        <div className="border-l-2 pl-3 font-mono text-[13px] leading-[1.55]" style={{ borderColor: "var(--pi-border-strong)" }}>
          <div className="mb-1 font-semibold" style={{ color: "var(--pi-fg-strong)" }}>
            Paired Pis
          </div>
          <ul className="space-y-0.5">
            {peers.map((peer, index) => (
              <li key={peer.remote_epk} className="flex min-w-0 items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onSelectPeer(peer.remote_epk)}
                  className="min-w-0 flex-1 text-left"
                  style={{ color: FG }}
                >
                  {index + 1}. {peer.nickname ?? peer.session_name}
                  <span style={{ color: DIM }}>
                    {"  "}
                    {peer.hostname ?? peer.remote_epk.slice(0, 12)}… · room {peer.room_id}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void onForgetPeer(peer.remote_epk)}
                  className="shrink-0 text-[11px]"
                  style={{ color: MUTED }}
                  title="Forget this pairing on this browser (the Pi keeps its own record)"
                >
                  forget
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scanning ? (
        <CameraScanner
          onResult={(text) => {
            setScanning(false);
            void attempt(text);
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </div>
  );
}

// ── camera QR scanning (progressive enhancement) ───────────────────────────

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function supportsCameraScan(): boolean {
  if (typeof window === "undefined") return false;
  const hasDetector = "BarcodeDetector" in window;
  return hasDetector && Boolean(navigator.mediaDevices?.getUserMedia);
}

function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    void (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor })
          .BarcodeDetector;
        const detector = new Ctor({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(video);
            const hit = found.find((b) => b.rawValue.startsWith("remotepi://"));
            if (hit) {
              onResult(hit.rawValue);
              return;
            }
          } catch {
            /* transient decode error — keep scanning */
          }
          raf = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch (err) {
        setError(
          err instanceof Error
            ? `Camera unavailable: ${err.message}`
            : "Camera unavailable — paste the link instead.",
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[12px]" style={{ color: MUTED }}>
          Point the camera at the QR
        </span>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[12px]"
          style={{ color: MUTED }}
        >
          cancel
        </button>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="w-full max-w-sm rounded border"
        style={{ borderColor: DIM }}
      />
      {error ? (
        <span className="font-mono text-[12px]" style={{ color: "var(--pi-red)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
