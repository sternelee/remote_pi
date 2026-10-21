/**
 * Share-link codec tests. The share link is the only path a second phone
 * becomes this device (the Pi-side pairing token is single-use and expires in
 * 60s), so a malformed link must fail loudly here, never as an opaque
 * connect-time error.
 */

import { describe, expect, it } from "vitest";

import {
  ShareLinkError,
  buildShareHash,
  decodeSharePayload,
  encodeSharePayload,
  parseShareHash,
  shareLinkFrom,
  type SharePayload,
} from "../lib/pairing/share";
import type { StoredIdentity } from "../lib/crypto/ed25519";
import type { PeerRecord } from "../lib/storage/store";

const identity: StoredIdentity = {
  publicKeyB64: "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AAAAAAAAAAAAAAAAAAAAAAA=",
  privateJwk: {
    kty: "OKP",
    crv: "Ed25519",
    x: "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AAAAAAAAAAAAAAAAAAAAAAA",
    d: "shh-secret-private-half",
  },
};

const peer: PeerRecord = {
  remote_epk: "epk-1",
  session_name: "mac-mini",
  relay_url: "wss://relay.example/ws",
  paired_at: "2026-10-14T00:00:00.000Z",
  room_id: "main",
  hostname: "mac-mini",
  nickname: "mini",
};

function payload(overrides: Partial<SharePayload> = {}): SharePayload {
  return { v: 1, identity, peers: [peer], ...overrides };
}

describe("share payload codec", () => {
  it("round-trips identity, peers, relay URL and last peer", () => {
    const encoded = encodeSharePayload(payload({ relayUrl: "wss://r/ws", lastPeerEpk: "epk-1" }));
    // URL-safe and unpadded: the blob must survive being pasted in a fragment.
    expect(encoded).toMatch(/^[\w-]+$/);
    const decoded = decodeSharePayload(encoded);
    expect(decoded.identity).toEqual(identity);
    expect(decoded.peers).toEqual([peer]);
    expect(decoded.relayUrl).toBe("wss://r/ws");
    expect(decoded.lastPeerEpk).toBe("epk-1");
  });

  it("survives non-Latin1 names (UTF-8, not btoa of raw chars)", () => {
    const encoded = encodeSharePayload(
      payload({ peers: [{ ...peer, nickname: "小手机的迷你主机" }] }),
    );
    expect(decodeSharePayload(encoded).peers[0].nickname).toBe("小手机的迷你主机");
  });

  it("rejects non-JSON and non-base64url blobs", () => {
    expect(() => decodeSharePayload("!!!not-base64!!!")).toThrow(ShareLinkError);
    expect(() => decodeSharePayload(btoa("{nope"))).toThrow(ShareLinkError);
  });

  it("rejects an unsupported version", () => {
    const bad = btoa(JSON.stringify({ ...payload(), v: 2 }));
    expect(() => decodeSharePayload(bad)).toThrow(/version/i);
  });

  it("refuses a public-key-only identity — no private half, no signing", () => {
    const stripped = btoa(
      JSON.stringify(payload({ identity: { publicKeyB64: "a", privateJwk: { x: "b" } } })),
    );
    expect(() => decodeSharePayload(stripped)).toThrow(/private key/i);
  });

  it("refuses malformed peer entries", () => {
    const missingRoom = btoa(JSON.stringify(payload({ peers: [{ ...peer, room_id: "" }] })));
    expect(() => decodeSharePayload(missingRoom)).toThrow(/room_id/);
    const notArray = btoa(JSON.stringify(payload({ peers: "nope" as unknown as PeerRecord[] })));
    expect(() => decodeSharePayload(notArray)).toThrow(/peers/);
  });

  it("decodes a standard padded blob too (b64Decode tolerance)", () => {
    const urlSafe = encodeSharePayload(payload());
    const standard = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
    expect(decodeSharePayload(standard).peers).toEqual([peer]);
  });
});

describe("share hash handling", () => {
  it("builds a #/share= fragment and parses it back", () => {
    const hash = buildShareHash(payload());
    expect(hash.startsWith("#/share=")).toBe(true);
    const parsed = parseShareHash(hash);
    expect(parsed?.identity).toEqual(identity);
  });

  it("returns null for every non-share hash (routing falls through)", () => {
    expect(parseShareHash("#/")).toBeNull();
    expect(parseShareHash("#/pair")).toBeNull();
    expect(parseShareHash("#/session/epk-1/main")).toBeNull();
    expect(parseShareHash("")).toBeNull();
  });

  it("throws ShareLinkError only for a share hash with a bad payload", () => {
    expect(() => parseShareHash("#/share=!!!")).toThrow(ShareLinkError);
  });

  it("composes the full link from the page URL, stripping its own hash", () => {
    const link = shareLinkFrom("https://pwa.example/#/session/epk-1/main", payload());
    expect(link.startsWith("https://pwa.example/")).toBe(true);
    expect(link).not.toContain("#/session");
    expect(parseShareHash(link.slice(link.indexOf("#")))).not.toBeNull();
  });
});
