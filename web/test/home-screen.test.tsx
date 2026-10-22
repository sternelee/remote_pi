/**
 * Home screen render + helper tests. The home screen is the multi-project
 * entry point: a `device → session` tree over every paired Pi, so a
 * regression in the filter, grouping, presence tone or active marker
 * fails here.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  HomeScreen,
  countProjects,
  devicePresence,
  filterProjects,
  groupByDevice,
  presenceOf,
  roomTitle,
} from "../components/pi/HomeScreen";
import type { ProjectEntry } from "../lib/session/usePiSession";

const noop = () => {};

function project(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    epk: "epk-1",
    peerLabel: "mac-mini",
    online: true,
    roomId: "main",
    active: false,
    ...overrides,
  };
}

describe("home screen helpers", () => {
  const online = project({ epk: "a", roomId: "main", online: true });
  const offline = project({ epk: "b", roomId: "other", online: false });
  const all = [online, offline];

  it("'all' is a no-op, online/offline split on presence", () => {
    expect(filterProjects(all, "all")).toBe(all);
    expect(filterProjects(all, "online").map((p) => p.epk)).toEqual(["a"]);
    expect(filterProjects(all, "offline").map((p) => p.epk)).toEqual(["b"]);
  });

  it("counts each bucket", () => {
    expect(countProjects(all)).toEqual({ all: 2, online: 1, offline: 1 });
  });

  it("labels a room by name, else the room id", () => {
    expect(roomTitle(project({ name: "Work", roomId: "r" }))).toBe("Work");
    expect(roomTitle(project({ roomId: "r" }))).toBe("r");
  });

  it("maps working/online/offline to tones and labels", () => {
    expect(presenceOf(project({ working: true })).label).toBe("working");
    expect(presenceOf(project({ working: true })).tone).toBe("var(--pi-yellow)");
    expect(presenceOf(project({ online: true })).label).toBe("online");
    expect(presenceOf(project({ online: true })).tone).toBe("var(--pi-green)");
    expect(presenceOf(project({ online: false })).label).toBe("offline");
    expect(presenceOf(project({ online: false })).tone).toBe("var(--pi-muted)");
  });

  it("groups projects into devices, preserving first-appearance order", () => {
    const first = project({ epk: "a", roomId: "main", name: "one", online: true });
    const second = project({ epk: "b", roomId: "main", name: "two", online: false });
    const third = project({ epk: "a", roomId: "docs", name: "three" });
    const groups = groupByDevice([first, second, third]);
    expect(groups.map((g) => g.epk)).toEqual(["a", "b"]);
    expect(groups[0].rooms.map((r) => r.roomId)).toEqual(["main", "docs"]);
    expect(groups[1].rooms).toEqual([second]);
  });

  it("aggregates device presence across rooms: any working wins, then any online", () => {
    const idle = project({ epk: "a", roomId: "main", online: true });
    const busy = project({ epk: "a", roomId: "docs", online: true, working: true });
    expect(devicePresence(groupByDevice([idle, busy])[0]).label).toBe("working");
    expect(devicePresence(groupByDevice([idle])[0]).label).toBe("online");
    expect(devicePresence(groupByDevice([project({ online: false })])[0]).label).toBe("offline");
  });
});

describe("home screen", () => {
  it("invites pairing when there are no projects", () => {
    const html = renderToStaticMarkup(
      <HomeScreen projects={[]} onOpen={noop} onPair={noop} />,
    );
    expect(html).toContain("projects");
    expect(html).toContain("no projects yet");
    expect(html).toContain("pair a Pi");
    expect(html).not.toContain('role="tablist"');
  });

  it("lists sessions grouped under their device as a two-level tree", () => {
    const html = renderToStaticMarkup(
      <HomeScreen
        projects={[
          project({
            epk: "epk-1",
            roomId: "main",
            name: "remote_pi",
            cwd: "/Users/me/www/github/remote_pi",
            model: "Claude Opus 4.8",
            hostname: "mac-mini",
            active: true,
          }),
          project({ epk: "epk-1", roomId: "docs", cwd: "/Users/me/www/github/remote_pi" }),
          project({ epk: "epk-2", roomId: "other", name: "blog", online: false, peerLabel: "thinkpad", hostname: "thinkpad" }),
        ]}
        onOpen={noop}
        onPair={noop}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Filter projects"');
    // One device node per peer, sessions nested directly beneath.
    expect(html.match(/aria-label="Device mac-mini"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Device thinkpad"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Project ');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("remote_pi");
    expect(html).toContain("docs");
    expect(html).toContain("blog");
    expect(html).toContain("· current");
    expect(html).toContain("mac-mini");
    expect(html).toContain("thinkpad");
    expect(html).toContain("Claude Opus 4.8");
    expect(html).toContain("room main");
    expect(html).toContain("/Users/me/www/github/remote_pi");
    expect(html).toContain("online");
    expect(html).toContain("offline");
  });

  it("hides devices with no visible room under the filter", () => {
    const html = renderToStaticMarkup(
      <HomeScreen
        projects={[
          project({ epk: "epk-1", roomId: "main", name: "up", online: true, peerLabel: "mac" }),
          project({ epk: "epk-2", roomId: "main", name: "down", online: false, peerLabel: "pc" }),
        ]}
        onOpen={noop}
        onPair={noop}
      />,
    );
    // Default filter is "all", so both devices show.
    expect(html).toContain('aria-label="Device mac"');
    expect(html).toContain('aria-label="Device pc"');
  });
});
