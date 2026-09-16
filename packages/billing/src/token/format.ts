// natally — compact license token format (ARCHITECTURE §9.3).
//
// A LicenseToken is the compact three-segment string
//
//     base64url(header) "." base64url(payload) "." base64url(Ed25519 signature)
//
// signed with Ed25519 over the UTF-8 bytes of the dotted `header.payload`
// prefix (COSE/CWT-esque, JWT-shaped; no external crypto dependency — the
// signature bytes are produced/consumed by verify-web.ts (web) and verify.rs
// (native design) against the build-baked public key `VITE_LICENSE_PUBKEY`).
//
// Determinism: the payload is serialized with `canonicalJson` (recursively
// key-sorted), so minting the same payload twice yields byte-identical
// segments and therefore identical signature inputs. Verification never
// re-serializes — it signs/verifies the transmitted bytes verbatim, so both
// legs agree regardless of serializer.

import type { LicensePayload, LicenseToken } from "../types";

/** Token algorithm (Ed25519 / EdDSA per §9.3). */
export const TOKEN_ALG = "EdDSA" as const;
/** Token type marker; pinned exactly so foreign tokens decode as malformed. */
export const TOKEN_TYP = "JWT+COSE-ish v1" as const;

/** Fixed header every natally license token carries. */
export interface TokenHeader {
  readonly alg: typeof TOKEN_ALG;
  readonly typ: typeof TOKEN_TYP;
}

export const TOKEN_HEADER: TokenHeader = { alg: TOKEN_ALG, typ: TOKEN_TYP };

/** Structural JSON value check for canonical serialization (throws on non-JSON). */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalJson(element)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("natally.billing: canonical JSON supports JSON values only");
}

/** UTF-8 bytes in a fresh `ArrayBuffer` (crypto-call compatible). */
export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

/** base64url (RFC 4648 §5, unpadded) encoding of `bytes`. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * base64url decoding. Throws on characters outside the (base64url-tolerant)
 * alphabet — callers catch and classify as `malformed`.
 */
export function base64UrlToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The async signature primitive: Ed25519 over the signing input bytes. */
export type SignFn = (signingInput: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

/**
 * Mint a compact token: canonical header, canonical payload, Ed25519
 * signature (via `sign`) over the dotted prefix. Deterministic for a given
 * payload + key.
 */
export async function encodeToken(payload: LicensePayload, sign: SignFn): Promise<LicenseToken> {
  const headerSegment = bytesToBase64Url(utf8Bytes(canonicalJson(TOKEN_HEADER)));
  const payloadSegment = bytesToBase64Url(utf8Bytes(canonicalJson(payload)));
  const signingInput = utf8Bytes(`${headerSegment}.${payloadSegment}`);
  const signature = await sign(signingInput);
  return `${headerSegment}.${payloadSegment}.${bytesToBase64Url(signature)}` as LicenseToken;
}

/** Successful decode: parsed header, raw payload (validated by verify-web), signature bytes and the exact signed prefix. */
export interface DecodedToken {
  readonly header: TokenHeader;
  readonly payload: unknown;
  readonly signature: Uint8Array<ArrayBuffer>;
  readonly signingInput: Uint8Array<ArrayBuffer>;
}

export type DecodeOutcome =
  | { readonly ok: true; readonly token: DecodedToken }
  | { readonly ok: false; readonly reason: "malformed" };

function isTokenHeader(value: unknown): value is TokenHeader {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.alg === TOKEN_ALG && record.typ === TOKEN_TYP;
}

/**
 * Structural decode of the compact form. Any deviation — wrong segment count,
 * non-base64url characters, unparsable header/payload JSON, wrong alg/typ —
 * is `malformed`. Signature validity is NOT checked here (that needs the
 * public key: see verify-web.ts `verifyToken`).
 */
export function decodeToken(token: string): DecodeOutcome {
  const malformed: DecodeOutcome = { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return malformed;
  const headerSegment = parts[0];
  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0 ||
    signatureSegment.length === 0
  ) {
    return malformed;
  }
  let headerBytes: Uint8Array<ArrayBuffer>;
  let payloadBytes: Uint8Array<ArrayBuffer>;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    headerBytes = base64UrlToBytes(headerSegment);
    payloadBytes = base64UrlToBytes(payloadSegment);
    signature = base64UrlToBytes(signatureSegment);
  } catch {
    return malformed;
  }
  let headerValue: unknown;
  let payloadValue: unknown;
  try {
    headerValue = JSON.parse(new TextDecoder().decode(headerBytes)) as unknown;
    payloadValue = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
  } catch {
    return malformed;
  }
  if (!isTokenHeader(headerValue)) return malformed;
  return {
    ok: true,
    token: {
      header: headerValue,
      payload: payloadValue,
      signature,
      // The signed prefix is the transmitted bytes verbatim — no re-serialization.
      signingInput: utf8Bytes(`${headerSegment}.${payloadSegment}`),
    },
  };
}
