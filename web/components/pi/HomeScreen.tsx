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

/** One device node in the home tree: every room a paired Pi exposes. */
export interface DeviceGroup {
  epk: string;
  peerLabel: string;
  hostname?: string;
  /** True when any of the device's rooms is online. */
  online: boolean;
  /** True when any of the device's rooms is working. */
  working: boolean;
  rooms: ProjectEntry[];
}

function aggregatePresence(online: boolean, working: boolean): { tone: string; label: string } {
  if (working) return { tone: YELLOW, label: "working" };
  if (online) return { tone: GREEN, label: "online" };
  return { tone: MUTED, label: "offline" };
}

/**
 * Group a flat project list into devices, preserving first-appearance order
 * (the peers order from `usePiSession`). Presence aggregates over the rooms:
 * one working room makes the whole device "working".
 */
export function groupByDevice(projects: ProjectEntry[]): DeviceGroup[] {
  const byEpk = new Map<string, DeviceGroup>();
  for (const project of projects) {
    let group = byEpk.get(project.epk);
    if (!group) {
      group = {
        epk: project.epk,
        peerLabel: project.peerLabel,
        hostname: project.hostname,
        online: false,
        working: false,
        rooms: [],
      };
      byEpk.set(project.epk, group);
    }
    group.online ||= project.online;
    group.working ||= project.working ?? false;
    group.rooms.push(project);
  }
  return [...byEpk.values()];
}

/** Aggregate presence tone for a device header. */
export function devicePresence(group: DeviceGroup): { tone: string; label: string } {
  return aggregatePresence(group.online, group.working);
}

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

/** Room label under a device node: the room name, else the room id. */
export function roomTitle(room: ProjectEntry): string {
  return room.name ?? room.roomId;
}

/** Presence/working tone for the dot + label, mirroring the Flutter status pill. */
export function presenceOf(project: ProjectEntry): { tone: string; label: string } {
  if (project.working) return { tone: YELLOW, label: "working" };
  if (project.online) return { tone: GREEN, label: "online" };
  return { tone: MUTED, label: "offline" };
}

/**
 * The home screen: a two-level tree of devices and their sessions (rooms)
 * across paired Pis — `all → device → session`. The device level carries
 * only the peer identity; each session row shows its working directory.
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
  // The tabs filter sessions, not devices: a device with no visible room
  // under the current filter is hidden from the tree.
  const devices = useMemo(
    () => groupByDevice(filterProjects(projects, filter)),
    [projects, filter],
  );
  const visible = devices.flatMap((device) => device.rooms);

  return (
    <div className="pi-safe-pad-roomy mx-auto flex w-full max-w-2xl flex-col gap-3 font-mono text-[13px]">
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
        <ul className="flex flex-col gap-3">
          {devices.map((device) => {
            const deviceTone = devicePresence(device);
            return (
              <li key={device.epk} role="group" aria-label={`Device ${device.peerLabel}`}>
                {/* Device node: the tree's first level — the peer identity only. */}
                <div className="flex items-baseline gap-2 border-l-2 pl-3" style={{ borderColor: "var(--pi-border-strong)" }}>
                  <span aria-hidden="true" style={{ color: deviceTone.tone }}>
                    ●
                  </span>
                  <span className="min-w-0 break-words" style={{ color: DIM }}>
                    {device.peerLabel}
                  </span>
                  <span className="ml-auto text-[11px]" style={{ color: deviceTone.tone }}>
                    {deviceTone.label}
                  </span>
                </div>
                {/* Hostname rides under the nickname; when it IS the label, skip it. */}
                {device.hostname && device.peerLabel !== device.hostname ? (
                  <span className="block pl-3 text-[11px]" style={{ color: MUTED }}>
                    {device.hostname}
                  </span>
                ) : null}
                <div className="ml-[5px] border-l" style={{ borderColor: "var(--pi-border)" }}>
                  {/* Session nodes (rooms) with their working directories, flat under the device. */}
                  <ul className="flex flex-col gap-1.5 py-1 pl-4">
                    {device.rooms.map((room) => {
                      const { tone, label } = presenceOf(room);
                      return (
                        <li key={`${room.epk}:${room.roomId}`}>
                          <button
                            type="button"
                            onClick={() => onOpen(room.epk, room.roomId)}
                            aria-current={room.active ? "true" : undefined}
                            className="block w-full border-l border-[var(--pi-border)] pl-3 text-left hover:bg-[var(--pi-popover)]"
                          >
                            <span className="flex items-baseline gap-2">
                              <span aria-hidden="true" style={{ color: tone }}>
                                ●
                              </span>
                              <span className="min-w-0 break-words" style={{ color: FG }}>
                                {roomTitle(room)}
                              </span>
                              {room.active ? <span style={{ color: ROSE }}>· current</span> : null}
                              <span className="ml-auto text-[11px]" style={{ color: tone }}>
                                {label}
                              </span>
                            </span>
                            {room.cwd ? (
                              <span className="mt-0.5 block truncate text-[11px]" style={{ color: DIM }}>
                                {room.cwd}
                              </span>
                            ) : null}
                            <span className="mt-0.5 block truncate text-[11px]" style={{ color: MUTED }}>
                              {room.model ? `${room.model} · ` : ""}
                              {`room ${room.roomId}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
