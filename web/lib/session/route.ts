/**
 * Hash routing for the client shell.
 *
 * The PWA is a single prerendered page, so navigation lives in the URL hash:
 * `#/` (project list), `#/pair`, and `#/session/<epk>/<room>`. Keeping the
 * active project in the hash means a reload or a shared link lands back on the
 * same Pi room instead of the list.
 *
 * Pure string in / string out so it stays testable without a DOM.
 */

export type HashRoute =
  | { view: "home" }
  | { view: "pair" }
  | { view: "session"; epk: string; roomId: string };

/** Parse a `location.hash` value into a route. Anything unrecognised is home. */
export function parseHash(hash: string): HashRoute {
  const trimmed = hash.replace(/^#/, "").replace(/^\/+/, "");
  if (!trimmed) return { view: "home" };
  const segments = trimmed.split("/").filter(Boolean);
  if (segments[0] === "pair" && segments.length === 1) return { view: "pair" };
  if (segments[0] === "session" && segments.length === 3) {
    const epk = decodeURIComponent(segments[1]);
    const roomId = decodeURIComponent(segments[2]);
    if (epk && roomId) return { view: "session", epk, roomId };
  }
  return { view: "home" };
}

/** Serialise a route back into a `location.hash` value (leading `#`). */
export function routeToHash(route: HashRoute): string {
  switch (route.view) {
    case "pair":
      return "#/pair";
    case "session":
      return `#/session/${encodeURIComponent(route.epk)}/${encodeURIComponent(route.roomId)}`;
    default:
      return "#/";
  }
}
