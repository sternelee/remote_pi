"use client";

/**
 * Ephemeral session chrome driven by one-way `extension_ui_request` controls.
 *
 * Purely presentational so `test/interactions-render.test.tsx` can render each
 * piece from static props. `SessionScreen` reads them off `session.uiControl`.
 * Terminal grammar: dim labels, cyan values, bordered widget blocks.
 */

import type { UiControlState } from "@/lib/session/ui_control";

const DIM = "var(--pi-dim)";
const CYAN = "var(--pi-cyan)";
const FG = "var(--pi-fg)";

/** The `setTitle` value as a dim chip; nothing when unset. */
export function SessionTitle({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <div className="truncate font-mono text-[12px]" style={{ color: DIM }} title={title}>
      title: {title}
    </div>
  );
}

/** One line per `setStatus` entry (`key: value`); nothing when empty. */
export function StatusList({ statuses }: { statuses: Record<string, string> }) {
  const entries = Object.entries(statuses);
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 font-mono text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0 break-words">
          <span style={{ color: DIM }}>{key}: </span>
          <span style={{ color: CYAN }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/** One bordered block per `setWidget` entry; nothing when empty. */
export function WidgetList({ widgets }: { widgets: UiControlState["widgets"] }) {
  const entries = Object.entries(widgets);
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {entries.map(([key, widget]) => (
        <div
          key={key}
          className="min-w-0 border px-2 py-1 font-mono text-[11px]"
          style={{ borderColor: "var(--pi-border)", color: FG }}
        >
          <div className="truncate" style={{ color: DIM }} title={key}>
            {key}
          </div>
          <div className="whitespace-pre-wrap break-words">{widget.lines.join("\n")}</div>
        </div>
      ))}
    </div>
  );
}
