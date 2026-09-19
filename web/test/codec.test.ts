import { describe, expect, it } from "vitest";

import {
  b64Decode,
  b64Encode,
  decodeInner,
  encodeInner,
  encodeOuter,
  isOuterEnvelope,
  toStandardB64,
} from "../lib/protocol/codec";
import { uuid7 } from "../lib/protocol/uuid7";
import type { ClientMessage } from "../lib/protocol/types";
import { allFixtures, fixture, fixtureNames, readFixture } from "./fixtures";

/**
 * Control frames are consumed by the relay itself and never travel inside a
 * `ct`, so they are excluded from the inner-envelope round-trip below.
 */
const CONTROL_FIXTURES = new Set([
  "subscribe_presence",
  "unsubscribe_presence",
  "presence_check",
  "peer_online",
  "peer_offline",
  "presence",
  "rooms",
  "rooms_check",
  "room_announced",
  "room_ended",
  "room_meta_updated",
  "subscribe_rooms",
  "unsubscribe_rooms",
]);

describe("base64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(Array.from(b64Decode(b64Encode(bytes)))).toEqual(Array.from(bytes));
  });

  it("normalizes url-safe and unpadded input to standard base64", () => {
    // 0xfb 0xff is "+/8=" in standard base64 and "-_8" in url-safe, unpadded.
    expect(toStandardB64("-_8")).toBe("+/8=");
    expect(toStandardB64("+/8=")).toBe("+/8=");
  });

  it("decodes unpadded standard input", () => {
    expect(Array.from(b64Decode("+/8"))).toEqual([0xfb, 0xff]);
  });
});

describe("uuid7", () => {
  it("matches the protocol's UUID shape (version 7, variant 10xx)", () => {
    expect(uuid7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts chronologically by embedded timestamp", () => {
    expect(uuid7(1_000_000_000_000) < uuid7(1_000_000_001_000)).toBe(true);
  });
});

describe("envelope codec", () => {
  it("round-trips every client message fixture", () => {
    for (const name of ["pair_request", "user_message", "cancel", "ping", "session_sync"]) {
      const original = fixture<ClientMessage>(name);
      expect(decodeInner(encodeInner(original)), name).toEqual(original);
    }
  });

  it("round-trips every non-control fixture, line by line", () => {
    let checked = 0;
    for (const name of fixtureNames) {
      if (CONTROL_FIXTURES.has(name)) continue;
      for (const line of readFixture(name)) {
        const decoded = decodeInner(encodeInner(line as ClientMessage));
        expect(decoded, name).toEqual(line);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });

  it("builds an outer envelope the relay recognises", () => {
    const peer = "RU9rXbR2dEVwM1AyZTM=";
    const frame = JSON.parse(
      encodeOuter(peer, "aB12CD34eF56", encodeInner(fixture<ClientMessage>("user_message"))),
    );
    expect(isOuterEnvelope(frame)).toBe(true);
    expect(frame).toMatchObject({ peer, room: "aB12CD34eF56" });
    expect(frame.ct).toBeTypeOf("string");
  });

  it("rejects payloads that are not inner envelopes", () => {
    expect(decodeInner("bm90IGpzb24=")).toBeNull(); // base64 of "not json"
    expect(decodeInner("%%%not-base64%%%")).toBeNull();
  });

  it("drops an oversized payload instead of throwing (relay limit is 1 MiB)", () => {
    expect(decodeInner("A".repeat(1024 * 1024 * 2))).toBeNull();
  });

  it("every fixture declares a type, and the set is the documented one", () => {
    const all = allFixtures();
    for (const [name, lines] of Object.entries(all)) {
      for (const line of lines) {
        expect(typeof (line as { type?: unknown }).type, name).toBe("string");
      }
    }
    // Spot-check that the shared vector set is the one being read, not an
    // accidentally-empty directory.
    expect(Object.keys(all).length).toBeGreaterThan(20);
  });
});
