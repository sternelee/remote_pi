/**
 * Access sharing between this user's own devices.
 *
 * Pairing is per-identity: a new browser is a new peer id, and the Pi-side
 * pairing token is single-use and expires in 60s, so a second phone cannot
 * pair with "the same link". The one credential that makes another device
 * *this* device is the identity itself — so a share link carries the private
 * JWK plus the paired-Pi records, base64url-encoded in the URL hash fragment.
 *
 * The fragment (#…) never leaves the browser: it is not sent to the Worker or
 * the relay and cannot appear in a server log. But anyone who gets the full
 * link can act as this device — the settings copy says so out loud.
 *
 * Pure string in / string out so it stays testable without a DOM.
 */

import { b64Decode, b64Encode, utf8Decode, utf8Encode } from "../protocol/codec";
import type { StoredIdentity } from "../crypto/ed25519";
import type { PeerRecord } from "../storage/store";

export const SHARE_VERSION = 1;

/** What a share link carries: enough for a fresh phone to be this device. */
export interface SharePayload {
  v: typeof SHARE_VERSION;
  identity: StoredIdentity;
  peers: PeerRecord[];
  /** Relay URL to persist as the receiving device's default. */
  relayUrl?: string;
  /** Peer to reconnect to on first open, like `Settings.last_peer_epk`. */
  lastPeerEpk?: string;
}

/** Thrown when a #/share hash exists but its payload is unusable. */
export class ShareLinkError extends Error {}

/** Encode a payload as the base64url blob carried in the hash. */
export function encodeSharePayload(payload: SharePayload): string {
  return b64Encode(utf8Encode(JSON.stringify(payload)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new ShareLinkError(`Missing "${field}".`);
  return value;
}

/** Decode and structurally validate a share blob. Throws `ShareLinkError`. */
export function decodeSharePayload(raw: string): SharePayload {
  let parsed: unknown;
  try {
    // `b64Decode` accepts both url-safe and padded standard forms.
    parsed = JSON.parse(utf8Decode(b64Decode(raw)));
  } catch {
    throw new ShareLinkError("Share link payload is not valid base64url JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ShareLinkError("Share link payload is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== SHARE_VERSION) {
    throw new ShareLinkError(`Unsupported share link version ${String(record.v)}.`);
  }
  const identity = record.identity;
  if (typeof identity !== "object" || identity === null) {
    throw new ShareLinkError('Share link is missing "identity".');
  }
  const identityRecord = identity as Record<string, unknown>;
  requireString(identityRecord.publicKeyB64, "identity.publicKeyB64");
  // `d` is the private half — without it the receiving device could not sign
  // the relay challenge, so a public-key-only payload is refused early.
  const jwk = identityRecord.privateJwk;
  if (typeof jwk !== "object" || jwk === null || typeof (jwk as { d?: unknown }).d !== "string") {
    throw new ShareLinkError("Share link identity has no private key.");
  }
  if (!Array.isArray(record.peers)) throw new ShareLinkError('Share link is missing "peers".');
  const peers = record.peers.map((peer) => {
    if (typeof peer !== "object" || peer === null) {
      throw new ShareLinkError("Share link has a malformed peer entry.");
    }
    const entry = peer as Record<string, unknown>;
    return {
      remote_epk: requireString(entry.remote_epk, "peers[].remote_epk"),
      session_name: requireString(entry.session_name, "peers[].session_name"),
      relay_url: requireString(entry.relay_url, "peers[].relay_url"),
      paired_at: requireString(entry.paired_at, "peers[].paired_at"),
      room_id: requireString(entry.room_id, "peers[].room_id"),
      ...(typeof entry.hostname === "string" ? { hostname: entry.hostname } : {}),
      ...(typeof entry.nickname === "string" ? { nickname: entry.nickname } : {}),
      ...(typeof entry.harness === "string" ? { harness: entry.harness } : {}),
      ...(typeof entry.harness_version === "string"
        ? { harness_version: entry.harness_version }
        : {}),
    } satisfies PeerRecord;
  });
  return {
    v: SHARE_VERSION,
    identity: {
      publicKeyB64: identityRecord.publicKeyB64 as string,
      privateJwk: jwk as JsonWebKey,
    },
    peers,
    ...(typeof record.relayUrl === "string" ? { relayUrl: record.relayUrl } : {}),
    ...(typeof record.lastPeerEpk === "string" ? { lastPeerEpk: record.lastPeerEpk } : {}),
  };
}

// ── hash fragment ─────────────────────────────────────────────────────────

const SHARE_PREFIX = "#/share=";

/** The hash value that carries a share payload (leading `#`). */
export function buildShareHash(payload: SharePayload): string {
  return SHARE_PREFIX + encodeSharePayload(payload);
}

/**
 * Parse a `location.hash` as a share link: `null` when the hash is anything
 * else (the caller falls through to normal routing), `ShareLinkError` when it
 * is a share hash whose payload cannot be used.
 */
export function parseShareHash(hash: string): SharePayload | null {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  return decodeSharePayload(hash.slice(SHARE_PREFIX.length));
}

/**
 * Build the full share URL: the current page (its own hash stripped — the
 * session route is not part of the share) plus the share fragment.
 */
export function shareLinkFrom(pageUrl: string, payload: SharePayload): string {
  return `${pageUrl.split("#")[0]}${buildShareHash(payload)}`;
}
