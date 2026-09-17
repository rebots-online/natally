import { z } from "zod";
import {
  type DenyList,
  DenyListSchema,
  type LicenseToken,
  LicenseTokenPayloadSchema,
  SignedDenyListSchema,
} from "../types.js";

// B.3 wire contract: unpadded base64url(JSON header).base64url(JSON payload).
// base64url(64-byte Ed25519 signature), signing the first two segments verbatim.
// All signed timestamps are integer Unix seconds; clocks passed to APIs use seconds.
export const LICENSE_HEADER = Object.freeze({ alg: "EdDSA" } as const);
export const LICENSE_ISSUER = "natally-license-bridge";
export const DENY_LIST_MAX_AGE = 24 * 60 * 60;
export const MAX_TOKEN_LENGTH = 16_384;

// T0.7 currently narrows exp to null. Keep every other shared field, allowing the
// null-or-future requirement of B.3 without mutating T0.7's shared schema.
export const VerifiableLicensePayloadSchema = LicenseTokenPayloadSchema.extend({
  iat: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  exp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export type VerifiableLicensePayload = z.infer<typeof VerifiableLicensePayloadSchema>;

export class TokenError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TokenError";
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new TokenError("invalid-base64url");
  }
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new TokenError("invalid-base64url");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new TokenError("noncanonical-base64url");
  return bytes;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TokenError("invalid-json");
  }
}

function decodeJson(value: string): unknown {
  try {
    return parseJson(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(value)));
  } catch {
    throw new TokenError("invalid-token-json");
  }
}

export function licenseSigningInput(payload: VerifiableLicensePayload): string {
  const parsed = VerifiableLicensePayloadSchema.parse(payload);
  const encode = (value: unknown) =>
    encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(LICENSE_HEADER)}.${encode(parsed)}`;
}

/** This parses an untrusted transport; it never grants an entitlement. */
export function parseLicenseToken(token: LicenseToken) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    throw new TokenError("malformed-token");
  }
  const parts = token.split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (parts.length !== 3 || !headerPart || !payloadPart || !signaturePart) {
    throw new TokenError("malformed-token");
  }
  const header = z.strictObject({ alg: z.literal("EdDSA") }).safeParse(decodeJson(headerPart));
  const payload = VerifiableLicensePayloadSchema.safeParse(decodeJson(payloadPart));
  if (!header.success || !payload.success) throw new TokenError("invalid-claims");
  const signature = decodeBase64Url(signaturePart);
  if (signature.length !== 64) throw new TokenError("invalid-signature");
  return {
    payload: payload.data,
    signature,
    message: new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  };
}

/** Fixed field order is shared with verify.rs and must be used by the bridge. */
export function denyListSigningInput(value: DenyList): Uint8Array<ArrayBuffer> {
  const payload = DenyListSchema.parse(value);
  if (!Number.isSafeInteger(payload.issuedAt)) throw new TokenError("invalid-deny-list-date");
  return new TextEncoder().encode(
    JSON.stringify({ issuedAt: payload.issuedAt, revokedJti: payload.revokedJti }),
  );
}

export function parseSignedDenyList(value: unknown) {
  const parsed = SignedDenyListSchema.safeParse(value);
  if (!parsed.success || parsed.data.payload.revokedJti.length > 100_000) {
    throw new TokenError("invalid-deny-list");
  }
  denyListSigningInput(parsed.data.payload);
  if (decodeBase64Url(parsed.data.signature).length !== 64) {
    throw new TokenError("invalid-deny-list-signature");
  }
  return parsed.data;
}
