import { describe, expect, it } from "vitest";

import { parseHash, routeToHash } from "../lib/session/route";

describe("hash routing", () => {
  it("treats empty, bare and unknown hashes as home", () => {
    expect(parseHash("")).toEqual({ view: "home" });
    expect(parseHash("#")).toEqual({ view: "home" });
    expect(parseHash("#/")).toEqual({ view: "home" });
    expect(parseHash("#/nope/extra")).toEqual({ view: "home" });
  });

  it("parses the pair route", () => {
    expect(parseHash("#/pair")).toEqual({ view: "pair" });
    expect(parseHash("#/pair/extra")).toEqual({ view: "home" });
  });

  it("parses a session route and decodes both segments", () => {
    expect(parseHash("#/session/abc%2B%2F%3D/room%2Fone")).toEqual({
      view: "session",
      epk: "abc+/=",
      roomId: "room/one",
    });
  });

  it("rejects a session route with a missing segment", () => {
    expect(parseHash("#/session/epkonly")).toEqual({ view: "home" });
  });

  it("round-trips every route", () => {
    for (const route of [
      { view: "home" } as const,
      { view: "pair" } as const,
      { view: "session", epk: "a+b/c=", roomId: "main work" } as const,
    ]) {
      expect(parseHash(routeToHash(route))).toEqual(route);
    }
  });

  it("serialises the canonical hash forms", () => {
    expect(routeToHash({ view: "home" })).toBe("#/");
    expect(routeToHash({ view: "pair" })).toBe("#/pair");
    expect(routeToHash({ view: "session", epk: "e", roomId: "r" })).toBe("#/session/e/r");
  });
});
