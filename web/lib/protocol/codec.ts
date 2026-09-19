/**
 * Wire codec: base64 + the two envelope layers.
 *
 * Framing is JSONL on the socket, but the browser WebSocket API already
 * delivers one message per frame, so this module deals in single messages.
 *
 * Encoding rules that matter (mirrors `app/lib/data/transport/ws_transport.dart`):
 *   - The relay registry and the outer envelope's `peer`/`hello.pubkey` use
 *     **standard** base64 (RFC 4648 §4, with padding).
 *   - QR payloads and persisted peer records may carry **url-safe** base64.
 *     Everything inbound is therefore normalized to standard before use.
 */

import type { ClientMessage, OuterEnvelope, ServerMessage } from "./types";

/** Relay rejects a decoded `ct` larger than this (1 MiB). */
export const MAX_CT_BYTES = 1024 * 1024;

export function b64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function b64Decode(value: string): Uint8Array {
  // Pad defensively: QR/storage values are sometimes unpadded.
  const pad = (4 - (value.length % 4)) % 4;
  const padded = value + "=".repeat(pad);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    // `atob` only speaks standard base64; url-safe payloads (`-`/`_`) need a swap.
    binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Re-encode url-safe (or unpadded) base64 into the relay's canonical form. */
export function toStandardB64(value: string): string {
  return b64Encode(b64Decode(value));
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Encode an inner message for the outer envelope's `ct` field. */
export function encodeInner(message: ClientMessage): string {
  return b64Encode(utf8Encode(JSON.stringify(message)));
}

/**
 * Decode an inbound `ct`. Returns `null` when the payload is malformed or
 * oversized — the caller drops the frame rather than tearing down the socket,
 * matching the app's tolerant inbound handling.
 */
export function decodeInner(ct: string): ServerMessage | null {
  try {
    const bytes = b64Decode(ct);
    if (bytes.length > MAX_CT_BYTES) return null;
    return JSON.parse(utf8Decode(bytes)) as ServerMessage;
  } catch {
    return null;
  }
}

export function encodeOuter(peer: string, room: string, ct: string): string {
  const frame: OuterEnvelope = { peer, room, ct };
  return JSON.stringify(frame);
}

/** A frame is an outer envelope when it carries both `peer` and `ct`. */
export function isOuterEnvelope(frame: unknown): frame is OuterEnvelope {
  if (typeof frame !== "object" || frame === null) return false;
  const f = frame as Record<string, unknown>;
  return typeof f.peer === "string" && typeof f.ct === "string";
}
