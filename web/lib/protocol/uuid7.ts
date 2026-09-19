/**
 * UUIDv7 — time-ordered UUID.
 *
 * The Remote Pi protocol requires UUIDv7 for every message that expects a
 * reply (`id`), so ids sort chronologically without coordination. Mirrors
 * `app/lib/protocol/uuid7.dart` and the extension's generator: 48-bit
 * big-endian unix-ms timestamp, version nibble 7, variant bits `10`.
 */

const HEX = "0123456789abcdef";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function hex(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) {
    s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return s;
}

export function uuid7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48-bit timestamp, big-endian.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // version 7 + variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return (
    hex(bytes, 0, 4) +
    "-" +
    hex(bytes, 4, 6) +
    "-" +
    hex(bytes, 6, 8) +
    "-" +
    hex(bytes, 8, 10) +
    "-" +
    hex(bytes, 10, 16)
  );
}
