/**
 * Ed25519 identity via WebCrypto.
 *
 * The mobile app keeps its device key in the OS Keychain; a browser has no
 * equivalent, so the key lives in IndexedDB as a JWK. That is a real reduction
 * in protection (see PROTOCOL.md § Modelo de proteção — the same trade-off the
 * extension makes on headless Linux) and is called out in the UI.
 *
 * WebCrypto's Ed25519 is required — Chrome 113+, Safari 17+, Firefox 129+.
 * There is deliberately no JS fallback: a hand-rolled curve implementation
 * would be a worse liability than refusing to run.
 */

import { b64Encode, toStandardB64 } from "../protocol/codec";

export interface StoredIdentity {
  /** Standard base64 of the raw 32-byte Ed25519 public key — the peer id. */
  publicKeyB64: string;
  /** JWK of the private key. Persisted so the identity survives reloads. */
  privateJwk: JsonWebKey;
}

/** Thrown when the browser cannot do Ed25519 — surfaced verbatim in the UI. */
export class Ed25519UnsupportedError extends Error {
  constructor() {
    super(
      "This browser has no Ed25519 support in WebCrypto. Remote Pi needs it to " +
        "authenticate with the relay. Use a recent Chrome, Safari or Firefox.",
    );
    this.name = "Ed25519UnsupportedError";
  }
}

let supported: boolean | null = null;

export async function isEd25519Supported(): Promise<boolean> {
  if (supported !== null) return supported;
  try {
    const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    supported = Boolean(key.privateKey);
  } catch {
    supported = false;
  }
  return supported;
}

async function assertSupported(): Promise<void> {
  if (!(await isEd25519Supported())) throw new Ed25519UnsupportedError();
}

export async function generateIdentity(): Promise<StoredIdentity> {
  await assertSupported();

  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

  return { publicKeyB64: b64Encode(raw), privateJwk };
}

/** Canonical peer id for an identity: standard base64 of the raw public key. */
export function publicKeyB64Of(identity: StoredIdentity): string {
  const fromJwk = identity.privateJwk.x;
  return fromJwk ? toStandardB64(fromJwk) : identity.publicKeyB64;
}

/**
 * Sign the relay's challenge nonce. The relay verifies with `ed25519-dalek`,
 * so the output must be the raw 64-byte signature.
 */
export async function signWithIdentity(
  identity: StoredIdentity,
  message: Uint8Array,
): Promise<Uint8Array> {
  await assertSupported();

  const key = await crypto.subtle.importKey(
    "jwk",
    identity.privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("Ed25519", key, message as BufferSource));
}
