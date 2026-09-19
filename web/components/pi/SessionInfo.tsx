"use client";

/**
 * Session info panel — the web counterpart of the app's session info dialog.
 *
 * Purely presentational: `SessionScreen` flattens the live session into
 * `SessionInfoData`, which keeps this file render-testable without standing up
 * a whole `PiSession`. Terminal grammar (left-border card, label/value rows,
 * selectable values) matches `QuickActions` and the rest of the status rail.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FG = "var(--pi-fg)";
const DIM = "var(--pi-dim)";

export interface SessionInfoData {
  /** Room name, falling back to the paired session name. */
  name?: string;
  /** Pi hostname. */
  host?: string;
  /** Working directory the Pi runs in. */
  path?: string;
  /** Room id. */
  room?: string;
  model?: string;
  thinking?: string;
  relay?: string;
  /** ISO timestamp of when this device paired. */
  pairedAt?: string;
  /** Pi's owner public key. */
  owner?: string;
}

/** Rows the panel shows, in order; a missing value renders as an em dash. */
const ROWS: { label: string; key: keyof SessionInfoData; short?: boolean }[] = [
  { label: "Name", key: "name" },
  { label: "Host", key: "host" },
  { label: "Path", key: "path" },
  { label: "Room", key: "room" },
  { label: "Model", key: "model" },
  { label: "Thinking", key: "thinking" },
  { label: "Relay", key: "relay" },
  { label: "Paired", key: "pairedAt" },
  { label: "Owner", key: "owner", short: true },
];

function shorten(value: string, chars = 20): string {
  return value.length > chars ? `${value.slice(0, chars)}…` : value;
}

export function SessionInfo({
  open,
  onOpenChange,
  info,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: SessionInfoData;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md font-mono text-[13px] leading-[1.55]"
        aria-label="Session info"
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-[13px]" style={{ color: "var(--pi-fg-strong)" }}>
            Session info
          </DialogTitle>
          <DialogDescription className="sr-only">
            Details about the connected Pi and this session.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-0.5">
          {ROWS.map(({ label, key, short }) => {
            const raw = info[key];
            const value = raw ? (short ? shorten(raw) : raw) : "—";
            return (
              <div key={key} className="contents">
                <dt style={{ color: DIM }}>{label}</dt>
                <dd
                  className="min-w-0 select-all break-words"
                  style={{ color: FG }}
                  title={raw && !short ? raw : undefined}
                >
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
