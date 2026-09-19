/**
 * Home screen render + helper tests. The home screen is the multi-project
 * entry point: one row per `peer × room`, so a regression in the filter,
 * presence tone or active marker fails here.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  HomeScreen,
  baseName,
  countProjects,
  filterProjects,
  presenceOf,
  projectTitle,
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

  it("derives a base name from a path, ignoring a trailing slash", () => {
    expect(baseName("/Users/me/www/github/remote_pi")).toBe("remote_pi");
    expect(baseName("/Users/me/www/github/remote_pi/")).toBe("remote_pi");
    expect(baseName("")).toBeUndefined();
    expect(baseName(undefined)).toBeUndefined();
  });

  it("prefers the room name, then the cwd basename, then the room id", () => {
    expect(projectTitle(project({ name: "Work", cwd: "/a/b", roomId: "r" }))).toBe("Work");
    expect(projectTitle(project({ cwd: "/a/b", roomId: "r" }))).toBe("b");
    expect(projectTitle(project({ roomId: "r" }))).toBe("r");
  });

  it("maps working/online/offline to tones and labels", () => {
    expect(presenceOf(project({ working: true })).label).toBe("working");
    expect(presenceOf(project({ working: true })).tone).toBe("var(--pi-yellow)");
    expect(presenceOf(project({ online: true })).label).toBe("online");
    expect(presenceOf(project({ online: true })).tone).toBe("var(--pi-green)");
    expect(presenceOf(project({ online: false })).label).toBe("offline");
    expect(presenceOf(project({ online: false })).tone).toBe("var(--pi-muted)");
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

  it("lists every project with presence, meta and the active marker", () => {
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
          project({ epk: "epk-2", roomId: "other", name: "docs", online: false }),
        ]}
        onOpen={noop}
        onPair={noop}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Filter projects"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("remote_pi");
    expect(html).toContain("· current");
    expect(html).toContain("mac-mini");
    expect(html).toContain("Claude Opus 4.8");
    expect(html).toContain("room main");
    expect(html).toContain("/Users/me/www/github/remote_pi");
    expect(html).toContain("docs");
    expect(html).toContain("online");
    expect(html).toContain("offline");
  });
});
