"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Pins the scheme for an explicit choice and clears the attribute for `system`,
 * letting the `:root { color-scheme: light dark }` default track the OS again.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export function subscribeSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange(query.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/*
 * The resolved theme is mirrored to a module-level store so deep leaves (e.g.
 * the Streamdown syntax highlighting in Markdown.tsx) can react to it without
 * threading a prop down through Transcript.
 */
let resolved: ResolvedTheme = "dark";
const listeners = new Set<(theme: ResolvedTheme) => void>();

export function currentResolvedTheme(): ResolvedTheme {
  return resolved;
}

export function publishResolvedTheme(theme: ResolvedTheme): void {
  if (theme === resolved) return;
  resolved = theme;
  for (const listener of listeners) listener(theme);
}

export function subscribeResolvedTheme(listener: (theme: ResolvedTheme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(currentResolvedTheme);
  useEffect(() => subscribeResolvedTheme(setTheme), []);
  return theme;
}

/**
 * Applies `mode` to the document and reports the resolved theme. Subscribes to
 * the OS preference only while `mode` is `system`.
 */
export function useTheme(mode: ThemeMode): ResolvedTheme {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (mode !== "system") return;
    return subscribeSystemTheme(setPrefersDark);
  }, [mode]);

  const theme = resolveTheme(mode, prefersDark);

  useEffect(() => {
    applyTheme(mode);
    publishResolvedTheme(theme);
  }, [mode, theme]);

  return theme;
}
