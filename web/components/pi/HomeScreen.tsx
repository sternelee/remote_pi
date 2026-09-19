"use client";

import { useMemo, useState } from "react";
import type { ProjectEntry } from "@/lib/session/usePiSession";

const FG = "var(--pi-fg)";
const DIM = "var(--pi-dim)";
const MUTED = "var(--pi-muted)";
const GREEN = "var(--pi-green)";
const YELLOW = "var(--pi-yellow)";
const ROSE = "var(--pi-rose)";

export type HomeFilter = "all" | "online" | "offline";

export const HOME_FILTERS: HomeFilter[] = ["all", "online", "offline"];

/** Pure filter used by the tabs; exported so it is testable on its own. */
export function filterProjects(projects: ProjectEntry[], filter: HomeFilter): ProjectEntry[] {
  if (filter === "all") return projects;
  return projects.filter((project) => (filter === "online" ? project.online : !project.online));
}

export function countProjects(projects: ProjectEntry[]): Record<HomeFilter, number> {
  return {
    all: projects.length,
    online: projects.filter((p) => p.online).length,
    offline: projects.filter((p) => !p.online).length,
  };
}

/** The last path segment, used when a room has no name but has a cwd. */
export function baseName(path?: string): string | undefined {
  if (!path) return undefined;
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || undefined;
}

export function projectTitle(project: ProjectEntry): string {
  return project.name ?? baseName(project.cwd) ?? project.roomId;
}

/** Presence/working tone for the dot + label, mirroring the Flutter status pill. */
export function presenceOf(project: ProjectEntry): { tone: string; label: string } {
  if (project.working) return { tone: YELLOW, label: "working" };
  if (project.online) return { tone: GREEN, label: "online" };
  return { tone: MUTED, label: "offline" };
}

/**
 * The home screen: every project (room) across paired Pis, as one list.
 *
 * Studio-picks a project with a click; the connection itself lives in
 * `usePiSession`, so this stays presentational and render-testable.
 */
export function HomeScreen({
  projects,
  onOpen,
  onPair,
}: {
  projects: ProjectEntry[];
  onOpen: (epk: string, roomId: string) => void;
  onPair: () => void;
}) {
  const [filter, setFilter] = useState<HomeFilter>("all");
  const counts = useMemo(() => countProjects(projects), [projects]);
  const visible = useMemo(() => filterProjects(projects, filter), [projects, filter]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-6 font-mono text-[13px] sm:px-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-[15px]" style={{ color: FG }}>
          projects
        </h1>
        <button
          type="button"
          onClick={onPair}
          className="underline-offset-2 hover:underline"
          style={{ color: DIM }}
        >
          pair another Pi
        </button>
      </header>

      {projects.length > 0 ? (
        <div
          role="tablist"
          aria-label="Filter projects"
          className="flex flex-wrap items-center gap-2"
        >
          {HOME_FILTERS.map((value) => {
            const selected = filter === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(value)}
                className="rounded-none border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: selected ? ROSE : "var(--pi-border)",
                  color: selected ? FG : MUTED,
                }}
              >
                {value} <span style={{ color: DIM }}>{counts[value]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <div
          className="border-l-2 pl-3"
          style={{ borderColor: "var(--pi-border-strong)", color: MUTED }}
        >
          <p style={{ color: FG }}>no projects yet</p>
          <p className="mt-1">
            Pair a Pi to start a session. Every working directory it exposes shows up here.
          </p>
          <button
            type="button"
            onClick={onPair}
            className="mt-2 underline-offset-2 hover:underline"
            style={{ color: ROSE }}
          >
            pair a Pi
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="border-l-2 pl-3" style={{ borderColor: "var(--pi-border-strong)", color: MUTED }}>
          no {filter} projects
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((project) => {
            const { tone, label } = presenceOf(project);
            const title = projectTitle(project);
            return (
              <li key={`${project.epk}:${project.roomId}`}>
                <button
                  type="button"
                  onClick={() => onOpen(project.epk, project.roomId)}
                  aria-current={project.active ? "true" : undefined}
                  className="block w-full border-l-2 pl-3 text-left hover:bg-[var(--pi-popover)]"
                  style={{
                    borderColor: project.active ? ROSE : "var(--pi-border-strong)",
                  }}
                >
                  <span className="flex items-baseline gap-2">
                    <span aria-hidden="true" style={{ color: tone }}>
                      ●
                    </span>
                    <span style={{ color: FG }}>{title}</span>
                    {project.active ? <span style={{ color: ROSE }}>· current</span> : null}
                    <span className="ml-auto text-[11px]" style={{ color: tone }}>
                      {label}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px]" style={{ color: MUTED }}>
                    {project.peerLabel}
                    {project.hostname ? ` · ${project.hostname}` : ""}
                    {project.model ? ` · ${project.model}` : ""}
                    {` · room ${project.roomId}`}
                  </span>
                  {project.cwd ? (
                    <span className="block truncate text-[11px]" style={{ color: DIM }}>
                      {project.cwd}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
