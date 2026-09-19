/**
 * Pairing QR payload + relay URL handling.
 *
 * URI scheme (see `.orchestration/contracts/pairing.md`):
 *   remotepi://pair?t=<b64url 16B>&epk=<b64url 32B>&n=<name>[&r=<url>][&rm=<roomId>]
 *
 *   t   ephemeral single-use token, valid 60s
 *   epk Ed25519 pubkey of the Pi — its relay peer id
 *   n   human-readable session name (max 80 chars)
 *   rm  Pi-side room id this QR was generated from (plan/17)
 *   r   legacy relay URL; tolerated, used only for mismatch detection
 */

import { b64Decode, toStandardB64 } from "../protocol/codec";

/** Matches the app's `kDefaultRelayUrl` (app/lib/data/transport/relay_config.dart). */
export const DEFAULT_RELAY_URL = "https://relay-rp1.jacobmoura.work";

export interface QrPairPayload {
  token: string;
  /** Standard base64 — normalized from the url-safe QR field. */
  epk: string;
  sessionName: string;
  relayUrl?: string;
  roomId?: string;
}

export class QrParseError extends Error {}

export function parseQrPayload(raw: string): QrPairPayload {
  const trimmed = raw.trim();
  let uri: URL;
  try {
    uri = new URL(trimmed);
  } catch {
    throw new QrParseError("Not a valid URI — expected a remotepi://pair?… link.");
  }
  if (uri.protocol !== "remotepi:" || uri.host !== "pair") {
    throw new QrParseError("Not a Remote Pi pairing link (expected remotepi://pair?…).");
  }

  const t = uri.searchParams.get("t");
  const epk = uri.searchParams.get("epk");
  const n = uri.searchParams.get("n");
  if (!t || !epk || !n) {
    throw new QrParseError("Pairing link is missing t, epk or n.");
  }

  // Validate lengths the way the app does, so a truncated QR fails here with a
  // clear message instead of as an opaque relay timeout.
  if (b64Decode(t).length !== 16) throw new QrParseError("Pairing token is not 16 bytes.");
  if (b64Decode(epk).length !== 32) throw new QrParseError("Pairing key is not 32 bytes.");

  return {
    token: t,
    epk: toStandardB64(epk),
    sessionName: n.slice(0, 80),
    relayUrl: uri.searchParams.get("r") ?? undefined,
    roomId: uri.searchParams.get("rm") ?? undefined,
  };
}

// ── relay URL ──────────────────────────────────────────────────────────────

/** Accepts http(s) or ws(s); the wire always speaks ws(s). */
export function toWsRelayUrl(relayUrl: string): string {
  const url = new URL(relayUrl.trim());
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error(`Unsupported relay scheme "${url.protocol}" — use http(s) or ws(s).`);
  }
  return url.toString();
}

export function isValidRelayUrl(relayUrl: string): boolean {
  try {
    const url = new URL(relayUrl.trim());
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && Boolean(url.host);
  } catch {
    return false;
  }
}
