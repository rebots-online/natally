import { LICENSE_ISSUER } from "./token/format.js";
import { decodeLicensePublicKey } from "./token/verify-web.js";

/**
 * B.4 — redeem codes (§9.5). Two families share one shape, `NATALLY-XXXX-XXXX-XXXX`
 * (12 Crockford base32 characters, no I/L/O/U):
 *
 * - **Individually-redeemable:** opaque bridge-issued randoms; only the bridge can
 *   validate them (B.6 registry). This module maps them to `invalid` until the
 *   bridge client (B.5a) supplies an online check.
 * - **Hash-based:** offline-verifiable — payload `{tier, exp}` + Ed25519 signature
 *   over the NATALLY-… canonical text, verified with the baked bridge public key;
 *   single-use is enforced against an injected consumed-code ledger (sha256-stored).
 *
 * Outcomes are exactly the paywall's four: `valid | invalid | already-used | expired`.
 */

export const CODE_PREFIX = "NATALLY-";
export const CODE_BODY_LENGTH = 12;
/** Crockford base32: no I, L, O, U (§9.5 — the confusable digits never appear). */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type CodeOutcome =
  | { result: "valid"; tier: string; expiresAt: number | null }
  | { result: "invalid"; reason: "shape" | "charset" | "signature" | "payload" }
  | { result: "already-used"; codeHash: string }
  | { result: "expired"; expiresAt: number };

export interface ConsumedCodeLedger {
  has(codeHash: string): Promise<boolean>;
  add(codeHash: string): Promise<void>;
}

export interface CodeVerifyDependencies {
  /** Ed25519 public key (raw 32 bytes, base64url) baked from VITE_LICENSE_PUBKEY. */
  readonly publicKey: string;
  /** sha256 hex of the canonical code text — matches the bridge's storage. */
  sha256Hex(text: string): Promise<string>;
  verifyEd25519(message: string, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
  readonly ledger: ConsumedCodeLedger;
  readonly now?: () => number;
}

/**
 * `NATALLY-` + one or more dash-separated groups of four base32 characters. The
 * minimal three-group form is the bridge's single-use random; hash-based codes are
 * longer because they carry payload + Ed25519 signature in the same convention.
 */
export function isCodeShape(value: string): boolean {
  if (!value.startsWith(CODE_PREFIX)) return false;
  const body = value.slice(CODE_PREFIX.length);
  return /^(?:[0-9A-Z]{4})(?:-[0-9A-Z]{4})+$/.test(body);
}

export function crockfordChars(value: string): boolean {
  const body = value.slice(CODE_PREFIX.length);
  return body
    .replace(/-/g, "")
    .split("")
    .every((character) => CROCKFORD_ALPHABET.includes(character));
}

function crockfordToBytes(body: string): Uint8Array {
  const symbols = body.replace(/-/g, "");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const symbol of symbols) {
    buffer = (buffer << 5) | CROCKFORD_ALPHABET.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (bits > 0) bytes.push((buffer << (8 - bits)) & 0xff);
  return new Uint8Array(bytes);
}

function bytesToCrockford(bytes: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export interface MintedHashCode {
  readonly code: string;
  readonly tier: string;
  readonly expiresAt: number | null;
}

/** Pack payload+signature into the NATALLY shape (bridge-side minting; test surface). */
export function packHashCode(
  payload: { readonly tier: string; readonly expiresAt: number | null },
  signature: Uint8Array,
): string {
  const payloadJson = JSON.stringify(
    payload.expiresAt === null
      ? { tier: payload.tier }
      : { tier: payload.tier, exp: payload.expiresAt },
  );
  const payloadBytes = new TextEncoder().encode(payloadJson);
  if (payloadBytes.length > 0xffff) throw new RangeError("Code payload too large");
  // 2-byte big-endian payload length makes unpack exact despite base32 pad bits.
  const bytes = new Uint8Array(2 + payloadBytes.length + signature.length);
  bytes[0] = payloadBytes.length >> 8;
  bytes[1] = payloadBytes.length & 0xff;
  bytes.set(payloadBytes, 2);
  bytes.set(signature, 2 + payloadBytes.length);
  let body = bytesToCrockford(bytes);
  while (body.length % 4 !== 0) body += CROCKFORD_ALPHABET[0];
  const groups = body.match(/.{4}/g) ?? [];
  return `${CODE_PREFIX}${groups.join("-")}`;
}

function unpackHashCode(code: string): { payload: unknown; signature: Uint8Array } | null {
  const bytes = crockfordToBytes(code.slice(CODE_PREFIX.length));
  // Layout: 2-byte payload length | JSON payload | Ed25519 signature (64 bytes).
  if (bytes.length <= 2 + 64) return null;
  const payloadLength = (bytes[0]! << 8) | bytes[1]!;
  if (payloadLength === 0 || bytes.length < 2 + payloadLength + 64) return null;
  const payloadBytes = bytes.slice(2, 2 + payloadLength);
  const signature = bytes.slice(2 + payloadLength, 2 + payloadLength + 64);
  try {
    return {
      payload: JSON.parse(new TextDecoder().decode(payloadBytes)),
      signature,
    };
  } catch {
    return null;
  }
}

export async function redeemCode(code: string, deps: CodeVerifyDependencies): Promise<CodeOutcome> {
  const trimmed = code.trim().toUpperCase();
  if (!isCodeShape(trimmed)) return { result: "invalid", reason: "shape" };
  if (!crockfordChars(trimmed)) return { result: "invalid", reason: "charset" };

  const codeHash = await deps.sha256Hex(trimmed);
  if (await deps.ledger.has(codeHash)) return { result: "already-used", codeHash };

  const unpacked = unpackHashCode(trimmed);
  if (!unpacked) return { result: "invalid", reason: "payload" };
  const payload = unpacked.payload as { tier?: unknown; exp?: unknown };
  if (typeof payload.tier !== "string" || payload.tier.length === 0)
    return { result: "invalid", reason: "payload" };
  if (payload.exp !== undefined && typeof payload.exp !== "number")
    return { result: "invalid", reason: "payload" };

  const publicKey = decodeLicensePublicKey(deps.publicKey);
  const message = signingInput({
    tier: payload.tier,
    expiresAt: typeof payload.exp === "number" ? payload.exp : null,
  });
  const valid = await deps.verifyEd25519(message, unpacked.signature, publicKey);
  if (!valid) return { result: "invalid", reason: "signature" };

  if (typeof payload.exp === "number") {
    const now = (deps.now ?? Date.now)();
    if (now >= payload.exp) return { result: "expired", expiresAt: payload.exp };
  }

  await deps.ledger.add(codeHash);
  return {
    result: "valid",
    tier: payload.tier,
    expiresAt: typeof payload.exp === "number" ? payload.exp : null,
  };
}

/**
 * Canonical signing input (bridge and client agree): issuer + the exact payload JSON.
 * The code binds the signature by carrying it \u2014 the code text itself is never signed,
 * because the text cannot exist before the signature does.
 */
export function signingInput(payload: {
  readonly tier: string;
  readonly expiresAt: number | null;
}): string {
  return `${LICENSE_ISSUER}:${JSON.stringify(
    payload.expiresAt === null
      ? { tier: payload.tier }
      : { tier: payload.tier, exp: payload.expiresAt },
  )}`;
}
