"use client";

import { useEffect, useRef } from "react";

/**
 * Overflow menu for the session rail.
 *
 * Settings, resync and reconnect are occasional actions, so on narrow screens
 * they collapse behind one `menu` control instead of wrapping the status rail
 * across several lines. Rendered inline (absolutely positioned) rather than
 * through a Radix portal: it stays in the static markup for the render tests,
 * matching the Dialog primitive in this project, and needs no extra dependency
 * for three items.
 *
 * Controlled by the parent so opening it can close the info/actions/settings
 * panels (and vice versa) — only one rail surface is ever open.
 */
export function SessionMenu({
  open,
  onOpenChange,
  onSettings,
  onResync,
  onReconnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettings: () => void;
  onResync: () => void;
  onReconnect: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="underline-offset-2 hover:underline"
        style={{ color: open ? "var(--pi-fg)" : "var(--pi-muted)" }}
        title="Relay, resync and reconnect"
      >
        menu
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Session menu"
          className="absolute top-full right-0 z-50 mt-1 flex min-w-[10rem] flex-col border p-1 font-mono text-[12px]"
          style={{ borderColor: "var(--pi-border)", background: "var(--pi-popover)" }}
        >
          <MenuItem
            label="settings"
            hint="relay, theme, prefs"
            onClick={() => {
              onSettings();
              onOpenChange(false);
            }}
          />
          <MenuItem
            label="resync"
            hint="re-fetch recent history"
            onClick={() => {
              onResync();
              onOpenChange(false);
            }}
          />
          <MenuItem
            label="reconnect"
            hint="restart the relay socket"
            onClick={() => {
              onReconnect();
              onOpenChange(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex flex-col items-start px-2 py-1 text-left hover:bg-[var(--pi-border)]"
      style={{ color: "var(--pi-fg)" }}
    >
      <span>{label}</span>
      <span className="text-[11px]" style={{ color: "var(--pi-dim)" }}>
        {hint}
      </span>
    </button>
  );
}
