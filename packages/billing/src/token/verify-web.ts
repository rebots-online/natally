// natally — offline license token verification, web leg (ARCHITECTURE §9.3,
// TEST_RUBRIC TR-3/B.3). Pure WebCrypto: Ed25519 verify against the
// build-baked public key (`VITE_LICENSE_PUBKEY`, base64 raw 32 bytes —
// already resolved as `RuntimeConfig.licensePubkey`). No network is touched,
// ever: the deny-list is passed in by the caller (fetched by the bridge task
// when online, cached otherwise) and only ever blocks its listed jtis.
//
// Rejection order (each with its distinct reason, TR-3): malformed → sig →
// iss → sub → expired → revoked.

import type { DenyListPayload, LicensePayload } from "../types";
import { LicensePayloadSchema } from "../types";
import { decodeToken } from "./format";

/** The only issuer the baked key is allowed to have signed for (§9.3). */
export const TOKEN_ISSUER = LicensePayloadSchema.shape.iss.value;
/** The single paid tier (§9.3/§9.4). */
export const TOKEN_TIER = LicensePayloadSchema.shape.tier.value;

export type TokenVerifyReason = "sig" | "iss" | "sub" | "expired" | "revoked" | "malformed";

export type VerifyTokenResult =
  | { readonly ok: true; readonly payload: LicensePayload }
  | { readonly ok: false; readonly reason: TokenVerifyReason };

export interface VerifyTokenOptions {
  /** base64 (config `VITE_LICENSE_PUBKEY`) or raw 32-byte Ed25519 public key. */
  readonly publicKey: string | Uint8Array;
  /** Expected `sub`: the token must belong to this install's appUserId. */
  readonly appUserId: string;
  /** Verification instant, epoch seconds. Default: the wall clock, floored. */
  readonly now?: number;
  /** Latest known deny-list payload (bridge-signed envelope body). Optional. */
  readonly denyList?: DenyListPayload;
}

const ED25519 = "Ed25519";

/**
 * RFC 8410 SubjectPublicKeyInfo prefix for Ed25519: 12 fixed bytes followed by
 * the raw 32-byte public key. Used only where an engine rejects raw import.
 */
export const ED25519_SPKI_PREFIX: Uint8Array = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/** raw → SPKI wrap (documented fixed prefix; key bytes appended verbatim). */
export function rawEd25519PublicKeyToSpki(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  if (raw.byteLength !== 32) {
    throw new Error(
      `natally.billing: raw Ed25519 public key must be 32 bytes, got ${raw.byteLength}`,
    );
  }
  const spki = new Uint8Array(ED25519_SPKI_PREFIX.byteLength + 32);
  spki.set(ED25519_SPKI_PREFIX, 0);
  spki.set(raw, ED25519_SPKI_PREFIX.byteLength);
  return spki;
}

/** Lenient base64/base64url → bytes (config bakes standard base64). */
function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/").replaceAll("=", "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importVerifyKey(publicKey: string | Uint8Array): Promise<CryptoKey> {
  // A caller-supplied Uint8Array is copied into a fresh ArrayBuffer-backed
  // view so every WebCrypto call sees a plain BufferSource.
  const raw = typeof publicKey === "string" ? base64ToBytes(publicKey) : new Uint8Array(publicKey);
  if (raw.byteLength !== 32) {
    throw new Error(
      "natally.billing: license public key must decode to 32 raw Ed25519 bytes (VITE_LICENSE_PUBKEY, base64)",
    );
  }
  try {
    return await crypto.subtle.importKey("raw", raw, ED25519, false, ["verify"]);
  } catch {
    // Older engines reject raw import for Ed25519; retry the SPKI-wrapped form.
    return await crypto.subtle.importKey("spki", rawEd25519PublicKeyToSpki(raw), ED25519, false, [
      "verify",
    ]);
  }
}

/** Structural payload shape; `exp` is widened to number|null for verify (mint pins it to null, §9.3). */
interface PayloadShape {
  readonly sub: string;
  readonly tier: "unlimited";
  readonly iat: number;
  readonly exp: number | null;
  readonly iss: string;
  readonly jti: string;
}

function isWellFormedPayload(value: unknown): value is PayloadShape {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sub === "string" &&
    record.sub.length > 0 &&
    record.tier === TOKEN_TIER &&
    typeof record.iat === "number" &&
    Number.isInteger(record.iat) &&
    record.iat >= 0 &&
    (record.exp === null ||
      (typeof record.exp === "number" && Number.isInteger(record.exp) && record.exp >= 0)) &&
    typeof record.iss === "string" &&
    record.iss.length > 0 &&
    typeof record.jti === "string" &&
    record.jti.length > 0
  );
}

/**
 * Full offline verification of a compact license token. Throws only for a
 * broken configuration (undecodable/short `publicKey`, engine without
 * Ed25519) — every token-level defect is a `{ ok: false, reason }` result.
 */
export async function verifyToken(
  token: string,
  options: VerifyTokenOptions,
): Promise<VerifyTokenResult> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const decoded = decodeToken(token);
  if (!decoded.ok) return { ok: false, reason: "malformed" };
  if (!isWellFormedPayload(decoded.token.payload)) return { ok: false, reason: "malformed" };
  const payload = decoded.token.payload;
  // Ed25519 signatures are exactly 64 bytes; anything else cannot verify.
  if (decoded.token.signature.byteLength !== 64) return { ok: false, reason: "sig" };
  const key = await importVerifyKey(options.publicKey);
  const valid = await crypto.subtle.verify(
    ED25519,
    key,
    decoded.token.signature,
    decoded.token.signingInput,
  );
  if (!valid) return { ok: false, reason: "sig" };
  if (payload.iss !== TOKEN_ISSUER) return { ok: false, reason: "iss" };
  if (payload.sub !== options.appUserId) return { ok: false, reason: "sub" };
  // `exp` is null-or-future (§9.3): null is perpetual — revocation is the
  // deny-list's job, never an expiry. A past exp is an expiry.
  if (payload.exp !== null && payload.exp <= now) return { ok: false, reason: "expired" };
  // Deny-list blocks ONLY listed jtis; absence or non-membership never blocks,
  // and nothing here reaches the network.
  if (options.denyList?.revokedJti.includes(payload.jti)) {
    return { ok: false, reason: "revoked" };
  }
  return {
    ok: true,
    payload: {
      sub: payload.sub,
      tier: payload.tier,
      iat: payload.iat,
      // Mint contract pins exp to null (§9.3); a structurally valid future exp
      // is honored if a later bridge revision ever mints one — narrow cast.
      exp: payload.exp as LicensePayload["exp"],
      iss: payload.iss as LicensePayload["iss"],
      jti: payload.jti,
    },
  };
}
