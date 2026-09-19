"use client";

import { useEffect, useRef, useState } from "react";

import { publicKeyB64Of } from "@/lib/crypto/ed25519";
import type { Notice, PiSession } from "@/lib/session/usePiSession";
import { Composer } from "./Composer";
import { QuickActions } from "./QuickActions";
import { SessionInfo } from "./SessionInfo";
import { SettingsPanel } from "./SettingsPanel";
import { Transcript } from "./Transcript";

const FG = "var(--pi-fg)";
const DIM = "var(--pi-dim)";
const MUTED = "var(--pi-muted)";
const GREEN = "var(--pi-green)";
const YELLOW = "var(--pi-yellow)";
const RED = "var(--pi-red)";

const STATUS_TONE: Record<string, string> = {
  online: GREEN,
  connecting: YELLOW,
  authenticating: YELLOW,
  reconnecting: YELLOW,
  idle: MUTED,
  closed: RED,
};

/** Live session view: status rail, scrollback, composer. */
export function SessionScreen({
  session,
  onHome,
}: {
  session: PiSession;
  onHome?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const peer = session.activePeer;
  const entries = session.transcript.entries.length;
  const working = session.transcript.working;

  // Follow the tail as the turn streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, working]);

  const peerLabel = peer ? (peer.nickname ?? peer.session_name) : "no peer";

  return (
    <div className="flex h-dvh min-w-0 flex-col gap-3 px-3 py-3 sm:px-5">
      {/* ── status rail ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px]">
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            className="underline-offset-2 hover:underline"
            style={{ color: MUTED }}
            title="Back to all projects"
          >
            ← projects
          </button>
        ) : null}
        <span style={{ color: STATUS_TONE[session.relayStatus] ?? MUTED }}>
          {session.relayStatus === "online" ? "●" : "○"} {session.relayStatus}
        </span>
        <span style={{ color: FG }}>{peerLabel}</span>
        {peer?.hostname ? <span style={{ color: DIM }}>{peer.hostname}</span> : null}
        {session.model ? <span style={{ color: DIM }}>{session.model}</span> : null}
        <span style={{ color: DIM }}>room {peer?.room_id ?? "—"}</span>
        <span className="ml-auto flex items-baseline gap-3">
          {onHome ? (
            <button
              type="button"
              onClick={onHome}
              className="underline-offset-2 hover:underline"
              style={{ color: FG }}
              title="All projects"
            >
              projects
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShowInfo((v) => !v);
              setShowActions(false);
              setShowSettings(false);
            }}
            className="underline-offset-2 hover:underline"
            style={{ color: showInfo ? "var(--pi-fg)" : MUTED }}
            title="Session name, path, model and pairing details"
          >
            info
          </button>
          <button
            type="button"
            onClick={() => {
              setShowActions((v) => !v);
              setShowInfo(false);
              setShowSettings(false);
            }}
            className="underline-offset-2 hover:underline"
            style={{ color: showActions ? "var(--pi-fg)" : MUTED }}
            title="Compact context, new session, model and thinking level"
          >
            actions
          </button>
          <button
            type="button"
            onClick={() => {
              setShowSettings((v) => !v);
              setShowInfo(false);
              setShowActions(false);
            }}
            className="underline-offset-2 hover:underline"
            style={{ color: showSettings ? "var(--pi-fg)" : MUTED }}
            title="Relay URL, transcript preferences and device key"
          >
            settings
          </button>
          <button
            type="button"
            onClick={session.resync}
            className="underline-offset-2 hover:underline"
            style={{ color: MUTED }}
            title="Re-fetch the last N events from the Pi (mirror, not a delta)"
          >
            resync
          </button>
          <button
            type="button"
            onClick={session.retry}
            className="underline-offset-2 hover:underline"
            style={{ color: MUTED }}
          >
            reconnect
          </button>
          {working ? (
            <button
              type="button"
              onClick={() => {
                const lastAgent = [...session.transcript.entries]
                  .reverse()
                  .find((e) => e.kind === "agent");
                if (lastAgent) session.cancelTurn(lastAgent.id);
              }}
              className="underline-offset-2 hover:underline"
              style={{ color: YELLOW }}
            >
              interrupt
            </button>
          ) : null}
        </span>
      </div>

      {session.relayDetail ? (
        <div className="font-mono text-[11px]" style={{ color: MUTED }}>
          {session.relayDetail}
        </div>
      ) : null}

      <QuickActions
        open={showActions}
        onOpenChange={setShowActions}
        busyAction={session.busyAction}
        modelName={session.model}
        currentModel={session.currentModel}
        models={session.models}
        thinking={session.thinking}
        onCompact={session.compact}
        onNewSession={session.newSession}
        onListModels={session.listModels}
        onPickModel={(model) => {
          session.setModel(model);
          setShowActions(false);
        }}
        onPickThinking={session.setThinking}
      />

      <SessionInfo
        open={showInfo}
        onOpenChange={setShowInfo}
        info={{
          name: session.room.name ?? peer?.session_name,
          host: peer?.hostname,
          path: session.room.cwd,
          room: peer?.room_id,
          model: session.model,
          thinking: session.thinking,
          relay: session.relayUrl,
          pairedAt: peer?.paired_at,
          owner: peer?.remote_epk,
        }}
      />

      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        relayUrl={session.relayUrl}
        onSaveRelayUrl={(url) => void session.setRelayUrl(url)}
        theme={session.prefs.theme}
        onSetTheme={(next) => session.setPrefs({ theme: next })}
        hideToolCalls={session.prefs.hideToolCalls}
        onToggleHideToolCalls={() =>
          session.setPrefs({ hideToolCalls: !session.prefs.hideToolCalls })
        }
        voiceNoticeAck={session.prefs.voiceNoticeAck}
        onAckVoiceNotice={() => session.setPrefs({ voiceNoticeAck: true })}
        devicePubkey={session.identity ? publicKeyB64Of(session.identity) : undefined}
      />

      {/* ── scrollback ──────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
        aria-live="polite"
        aria-label="Agent transcript"
      >
        {entries === 0 ? (
          <p className="font-mono text-[13px]" style={{ color: DIM }}>
            Connected. Nothing in this session yet — type below, or resync to pull
            the Pi&apos;s recent history.
          </p>
        ) : (
          <Transcript
            state={session.transcript}
            onAnswer={session.answerQuestion}
            hideToolCalls={session.prefs.hideToolCalls}
          />
        )}
      </div>

      {/* ── notices ─────────────────────────────────────────────────────── */}
      {session.notices.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {session.notices.map((notice) => (
            <NoticeLine
              key={notice.id}
              notice={notice}
              onDismiss={() => session.dismissNotice(notice.id)}
            />
          ))}
        </div>
      ) : null}

      {/* ── composer ────────────────────────────────────────────────────── */}
      <div className="border-t pt-3" style={{ borderColor: "var(--pi-border-soft)" }}>
        <Composer
          disabled={session.relayStatus !== "online"}
          working={working}
          model={session.model}
          currentModel={session.currentModel}
          directory={peerLabel}
          queuedText={session.queued[0]?.text}
          voiceNoticeAck={session.prefs.voiceNoticeAck}
          onAckVoiceNotice={() => session.setPrefs({ voiceNoticeAck: true })}
          onQueue={session.setQueued}
          onSend={session.sendMessage}
          onInterrupt={() => {
            const lastAgent = [...session.transcript.entries]
              .reverse()
              .find((e) => e.kind === "agent");
            if (lastAgent) session.cancelTurn(lastAgent.id);
          }}
        />
      </div>
    </div>
  );
}

function NoticeLine({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const tone =
    notice.tone === "error" ? RED : notice.tone === "warn" ? YELLOW : MUTED;
  return (
    <div className="flex min-w-0 items-baseline gap-2 font-mono text-[11px]">
      <span aria-hidden style={{ color: tone }}>
        ◆
      </span>
      <span className="min-w-0 break-words" style={{ color: tone }}>
        {notice.text}
      </span>
      <button type="button" onClick={onDismiss} className="shrink-0" style={{ color: DIM }}>
        dismiss
      </button>
    </div>
  );
}
