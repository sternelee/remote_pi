"use client";

import { useState } from "react";

import { isValidRelayUrl } from "@/lib/pairing/qr";
import type { ThemeMode } from "@/lib/theme";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Settings surface, opened from the status rail.
 *
 * Deliberately a dialog rather than a route: the app has no settings page in
 * the web client, and everything here is a small, rarely-touched toggle.
 * Presentational (props in, callbacks out) so it can be render-tested without a
 * live session.
 */

const FG = "var(--pi-fg)";
const MUTED = "var(--pi-muted)";
const DIM = "var(--pi-dim)";
const ROSE = "var(--pi-rose)";
const RED = "var(--pi-red)";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];

function shorten(value: string, chars = 20): string {
  return value.length > chars ? `${value.slice(0, chars)}…` : value;
}

export function SettingsPanel({
  open,
  onOpenChange,
  relayUrl,
  onSaveRelayUrl,
  theme,
  onSetTheme,
  hideToolCalls,
  onToggleHideToolCalls,
  voiceNoticeAck,
  onAckVoiceNotice,
  devicePubkey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relayUrl: string;
  onSaveRelayUrl: (url: string) => void;
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  hideToolCalls: boolean;
  onToggleHideToolCalls: () => void;
  voiceNoticeAck: boolean;
  onAckVoiceNotice: () => void;
  devicePubkey?: string;
}) {
  const [draft, setDraft] = useState(relayUrl);
  const [error, setError] = useState<string | null>(null);

  function saveRelay() {
    const next = draft.trim();
    if (!isValidRelayUrl(next)) {
      setError("Enter an http(s) or ws(s) relay URL.");
      return;
    }
    setError(null);
    onSaveRelayUrl(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md font-mono text-[13px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-[13px]" style={{ color: FG }}>
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Relay URL, transcript preferences and device key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span style={{ color: MUTED }}>Appearance</span>
            <div className="flex items-baseline gap-2" role="radiogroup" aria-label="Theme">
              {THEMES.map((option) => {
                const selected = option.value === theme;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onSetTheme(option.value)}
                    className="border px-2 py-0.5 text-[11px]"
                    style={{ borderColor: selected ? ROSE : DIM, color: selected ? FG : MUTED }}
                  >
                    {selected ? "❯ " : ""}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span style={{ color: MUTED }}>Relay</span>
            <div className="flex min-w-0 items-baseline gap-2">
              <input
                aria-label="Relay URL"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveRelay();
                  }
                }}
                className="term-input min-w-0 flex-1 border px-2 py-0.5 text-[12px]"
                style={{ borderColor: DIM, color: FG }}
              />
              <button
                type="button"
                onClick={saveRelay}
                className="shrink-0 underline-offset-2 hover:underline"
                style={{ color: ROSE }}
              >
                save
              </button>
            </div>
            {error ? (
              <span className="text-[11px]" style={{ color: RED }}>
                {error}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onToggleHideToolCalls}
            aria-pressed={hideToolCalls}
            className="w-fit text-left underline-offset-2 hover:underline"
            style={{ color: FG }}
            title="Collapse tool calls and diffs out of the scrollback"
          >
            hide tool calls: {hideToolCalls ? "on" : "off"}
          </button>

          <div className="flex min-w-0 flex-col gap-1">
            <span style={{ color: MUTED }}>Voice</span>
            <span className="text-[11px] break-words" style={{ color: DIM }}>
              Voice input uses your browser&apos;s speech service — audio may leave this device.
            </span>
            <button
              type="button"
              onClick={onAckVoiceNotice}
              disabled={voiceNoticeAck}
              className="w-fit text-left underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
              style={{ color: voiceNoticeAck ? DIM : FG }}
            >
              {voiceNoticeAck ? "noted" : "got it"}
            </button>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span style={{ color: MUTED }}>Device key</span>
            <span className="break-words select-all text-[11px]" style={{ color: DIM }}>
              {devicePubkey ? shorten(devicePubkey) : "—"}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
