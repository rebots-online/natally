// natally — redeem codes: single-use + hash-based (ARCHITECTURE §9.5,
// TEST_RUBRIC TR-3/B.4). Pure WebCrypto; reuses B.3's canonical JSON
// (token/format.ts) and Ed25519 verify primitives (token/verify-web.ts).
//
// THE FORMAT AND THE COMPRESSION RULING (documented v1 contract)
//
// A redeem code is `NATALLY-XXXX-XXXX-XXXX` — 12 Crockford base32 chars
// (alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ; I/L/O/U excluded) = 60 bits —
// or the EXTENDED `NATALLY-XXXX-XXXX-XXXX-XXXX-XXXX` — 20 chars = 100 bits.
// A full Ed25519 signature is 64 bytes = 512 bits and CANNOT fit, so per the
// architect ruling the v1 contract is:
//
//   compact (12 chars / 60 bits):  tier(2) | expDays(24) | sigTrunc(34)
//   extended (20 chars / 100 bits): tier(2) | expDays(24) | keyId(8) | sigTrunc(66)
//
// - `tier`   2 bits. Only id 1 ("unlimited") is mintable; 0/2/3 decode as
//            invalid (reserved).
// - `expDays` 24 bits, day-granular: epoch days; the code is valid through the
//            END of that day (expiry deadline = expDays*86400000 + 86399999).
// - `keyId`  8 bits, an 8-bit slice of the license public key — realized as
//            byte 0 of SHA-256(pubkeyRaw), so the verifier can re-derive it
//            from the baked key alone and reject foreign-key codes offline.
// - `sigTrunc` the leading 34/66 bits of the Ed25519 signature over
//            utf8(canonicalJson({exp: expDays, tier})). It is a FAST REJECT
//            FILTER, checked whenever the full signature is at hand (the
//            bridge registry's canonical record rides it in via the
//            `fullSignature` option); offline, where only 60/100 bits exist,
//            it is carried but not recomputable — the offline verdict rests on
//            charset/shape, keyId (extended), expiry and the consumed ledger,
//            and a forged code must still guess the full unguessable bit
//            string. This is the honest resolution of the 60-bit budget.
//
// Shape semantics (documented, verifier-enforced):
// - extended = verifies FULLY OFFLINE (every embedded field is checked
//   locally; a wired registry lookup is deliberately ignored).
// - compact  = a BRIDGE-REGISTRY LOOKUP HANDLE when `lookupRegistered` is
//   wired (the record's tier/exp are authoritative; a miss is invalid), and
//   falls back to the offline bit-decode verdict when no registry dep is
//   provided (the local ledger + temporal check path).
//
// Crockford normalization on input: uppercase; I/i and L/l map to 1, O/o maps
// to 0; U/u is INVALID (Crockford excludes U entirely and maps it to nothing).
// Any other character outside the alphabet, a wrong length, or a missing
// `NATALLY` prefix is invalid. The single-use hash is SHA-256 of the
// CANONICAL code string (uppercase, dashed, normalized) — confusable typings
// hash identically. Ledger access is injected: `hasBeenConsumed(hash)` for the
// read, with the write (`markConsumed`) owned by the redeem flow; the consumed
// row itself is the §9.5 `ConsumedCode` shape.

import { ConsumedCodeSchema, type ConsumedCode } from "./types";
import { canonicalJson, utf8Bytes, type SignFn } from "./token/format";
import { rawEd25519PublicKeyToSpki } from "./token/verify-web";

// ---------------------------------------------------------------------------
// Alphabet, shapes, bit budget
// ---------------------------------------------------------------------------

/** The literal code prefix; required, case-insensitive on input. */
export const CODE_PREFIX = "NATALLY" as const;

/** Crockford base32 alphabet — I, L, O, U are excluded (§9.5). */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;

/** Compact shape: 12 chars = 60 bits — the bridge-registry lookup handle. */
export const COMPACT_CHARS = 12;
/** Extended shape: 20 chars = 100 bits — verifies fully offline. */
export const EXTENDED_CHARS = 20;

/** Milliseconds in one day (the exp field's granularity). */
export const DAY_MS = 86_400_000;

const COMPACT_TRUNC_BITS = 34;
const EXTENDED_TRUNC_BITS = 66;

const EXP_DAYS_BITS = 24;
const MAX_EXP_DAYS = 2 ** EXP_DAYS_BITS - 1;

/** The redeem outcomes, mapped 1:1 to the paywall's code-error variants. */
export type CodeOutcome = "valid" | "invalid" | "already-used" | "expired";

/** The tier a code grants; only the paid tier exists today (§9.3/§9.4). */
export type CodeTier = "unlimited";

/** Mintable tier ids; everything else decodes as invalid (reserved). */
const TIER_ID_BY_CODE: Readonly<Record<CodeTier, number>> = { unlimited: 1 };

/** A hash-based code's embedded payload; `exp` is epoch milliseconds. */
export interface HashBasedCodePayload {
  readonly tier: CodeTier;
  readonly exp: number;
}

/** Which bit layout `mintHashBased` packs; default is `extended`. */
export type CodeShape = "compact" | "extended";

export interface MintHashBasedOptions {
  /** Default `extended` (the fully-offline-verifiable shape). */
  readonly shape?: CodeShape;
  /**
   * Required for extended mints: the 8-bit key slice the verifier re-derives
   * as SHA-256(pubkeyRaw)[0] (e.g. `keyIdForPubkey(await sha256(pubkey))` —
   * the bridge derives it from its `LICENSE_ED25519` public half).
   */
  readonly keyId?: number;
}

/** What the bridge registry returns for a known individually-redeemable code. */
export interface RegisteredCodeRecord {
  readonly tier: CodeTier;
  /** Epoch milliseconds; the code is valid through this instant. */
  readonly exp: number;
}

export interface VerifyCodeOptions {
  /** base64 (config `VITE_LICENSE_PUBKEY`) or raw 32-byte Ed25519 public key. */
  readonly publicKey: string | Uint8Array;
  /** Verification instant, epoch ms. Default: the wall clock. */
  readonly now?: number;
  /** Local single-use ledger read (the redeem flow writes after success). */
  readonly hasBeenConsumed?: (codeHash: string) => boolean;
  /** Bridge-registry lookup for the compact handle shape (optional). */
  readonly lookupRegistered?: (canonicalCode: string) => RegisteredCodeRecord | null;
  /**
   * The FULL 64-byte Ed25519 signature from the code's canonical record
   * (bridge registry). When present: the embedded truncation is checked as a
   * fast reject filter, then the signature is fully verified (WebCrypto,
   * Ed25519, offline) over the reconstructed payload bytes.
   */
  readonly fullSignature?: Uint8Array;
}

/** `{outcome, tier?, exp?}` — tier/exp present only on `valid`. */
export interface VerifyCodeResult {
  readonly outcome: CodeOutcome;
  readonly tier?: CodeTier;
  readonly exp?: number;
}

// ---------------------------------------------------------------------------
// Crockford base32 + canonical form
// ---------------------------------------------------------------------------

function groupChars(chars: string): string {
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4));
  }
  return `${CODE_PREFIX}-${groups.join("-")}`;
}

function bitsToChars(value: bigint, charCount: number): string {
  let chars = "";
  for (let i = 0; i < charCount; i += 1) {
    const index = Number((value >> BigInt(5 * (charCount - 1 - i))) & 0x1fn);
    chars += CROCKFORD_ALPHABET[index] ?? "";
  }
  return chars;
}

function charsToBits(chars: string): bigint {
  let value = 0n;
  for (const char of chars) {
    const index = CROCKFORD_ALPHABET.indexOf(char);
    if (index < 0) return -1n;
    value = (value << 5n) | BigInt(index);
  }
  return value;
}

/**
 * Crockford normalization (§9.5): uppercase, strip dashes, map I/i and L/l to
 * 1 and O/o to 0, reject U/u and anything else outside the alphabet; the
 * `NATALLY` prefix is required and the body must be exactly 12 or 20 chars.
 * Returns the canonical dashed form, or null for invalid input.
 */
export function normalizeCode(raw: string): string | null {
  const upper = raw.toUpperCase();
  if (!upper.startsWith(CODE_PREFIX)) return null;
  const bodyRaw = upper.slice(CODE_PREFIX.length).replaceAll("-", "");
  if (bodyRaw.length !== COMPACT_CHARS && bodyRaw.length !== EXTENDED_CHARS) return null;
  let body = "";
  for (const char of bodyRaw) {
    if (char === "I" || char === "L") {
      body += "1";
      continue;
    }
    if (char === "O") {
      body += "0";
      continue;
    }
    if (!CROCKFORD_ALPHABET.includes(char)) return null;
    body += char;
  }
  return groupChars(body);
}

// ---------------------------------------------------------------------------
// Hashes (WebCrypto only)
// ---------------------------------------------------------------------------

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * The single-use ledger key: SHA-256 (lowercase hex) of the CANONICAL code
 * string. Confusable typings of the same code hash identically (§9.5).
 */
export async function consumedCodeHash(canonicalCode: string): Promise<string> {
  return bytesToHex(await sha256Bytes(utf8Bytes(canonicalCode)));
}

/** The §9.5 consumed-code ledger row for a hash, schema-validated. */
export function asConsumedCode(codeHash: string, redeemedAt: number): ConsumedCode {
  return ConsumedCodeSchema.parse({ codeHash, redeemedAt });
}

/** The 8-bit pubkey slice embedded in extended codes: SHA-256(pubkeyRaw)[0]. */
export async function keyIdForPubkey(publicKey: Uint8Array): Promise<number> {
  return (await sha256Bytes(new Uint8Array(publicKey)))[0] ?? 0;
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/").replaceAll("=", "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function publicKeyBytes(publicKey: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const raw = typeof publicKey === "string" ? base64ToBytes(publicKey) : new Uint8Array(publicKey);
  if (raw.byteLength !== 32) {
    throw new Error(
      "natally.billing: code public key must decode to 32 raw Ed25519 bytes (VITE_LICENSE_PUBKEY, base64)",
    );
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Payload bits (the ruling's layouts)
// ---------------------------------------------------------------------------

interface CompactFields {
  readonly shape: "compact";
  readonly tierId: number;
  readonly expDays: number;
  readonly truncation: bigint;
}

interface ExtendedFields {
  readonly shape: "extended";
  readonly tierId: number;
  readonly expDays: number;
  readonly keyId: number;
  readonly truncation: bigint;
}

type PayloadFields = CompactFields | ExtendedFields;

/** First `count` bits of the byte string, MSB-first, as a BigInt. */
function takeBits(bytes: Uint8Array, count: number): bigint {
  let value = 0n;
  for (let i = 0; i < count; i += 1) {
    const bit = ((bytes[i >> 3] ?? 0) >> (7 - (i & 7))) & 1;
    value = (value << 1n) | BigInt(bit);
  }
  return value;
}

/** The exact bytes signed (and re-signed over at verify): the ENCODED truth. */
function payloadMessage(tier: CodeTier, expDays: number): Uint8Array<ArrayBuffer> {
  return utf8Bytes(canonicalJson({ exp: expDays, tier }));
}

function decodeFields(body: string): PayloadFields | null {
  const value = charsToBits(body);
  if (value < 0n) return null;
  if (body.length === EXTENDED_CHARS) {
    return {
      shape: "extended",
      tierId: Number((value >> 98n) & 3n),
      expDays: Number((value >> 74n) & 0xff_ffffn),
      keyId: Number((value >> 66n) & 0xffn),
      truncation: value & ((1n << BigInt(EXTENDED_TRUNC_BITS)) - 1n),
    };
  }
  return {
    shape: "compact",
    tierId: Number((value >> 58n) & 3n),
    expDays: Number((value >> 34n) & 0xff_ffffn),
    truncation: value & ((1n << BigInt(COMPACT_TRUNC_BITS)) - 1n),
  };
}

function tierOf(tierId: number): CodeTier | null {
  for (const [tier, id] of Object.entries(TIER_ID_BY_CODE)) {
    if (id === tierId) return tier as CodeTier;
  }
  return null;
}

/** Last millisecond of the encoded expiry day (the deadline, inclusive). */
function expiryDeadline(expDays: number): number {
  return expDays * DAY_MS + (DAY_MS - 1);
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

/**
 * Mint a hash-based code: signs `canonicalJson({exp, tier})` (the encoded
 * payload) with the injected Ed25519 `sign` (B.3's SignFn) and packs the
 * ruling's bits. Default shape is the fully-offline `extended`; pass
 * `{ shape: "compact" }` for the 60-bit registry-handle layout. Throws on a
 * defective mint call (bad tier/exp, non-Ed25519 signature, missing keyId) —
 * never on user input.
 */
export async function mintHashBased(
  payload: HashBasedCodePayload,
  sign: SignFn,
  options: MintHashBasedOptions = {},
): Promise<string> {
  const tierId = TIER_ID_BY_CODE[payload.tier];
  if (tierId === undefined) {
    throw new Error(`natally.billing: no mintable code tier ${String(payload.tier)}`);
  }
  if (!Number.isInteger(payload.exp) || payload.exp < 0) {
    throw new Error(`natally.billing: code exp must be a non-negative epoch ms, got ${String(payload.exp)}`);
  }
  const expDays = Math.floor(payload.exp / DAY_MS);
  if (expDays > MAX_EXP_DAYS) {
    throw new Error(`natally.billing: code exp exceeds the 24-bit day field (year 2125)`);
  }
  const message = payloadMessage(payload.tier, expDays);
  const signature = await sign(message);
  if (signature.byteLength !== 64) {
    throw new Error(
      `natally.billing: hash-based codes sign with Ed25519 (64-byte signatures), got ${String(signature.byteLength)}`,
    );
  }
  const shape = options.shape ?? "extended";
  if (shape === "extended") {
    const keyId = options.keyId;
    if (keyId === undefined || !Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
      throw new Error("natally.billing: extended codes require keyId (0-255, sha256(pubkey)[0])");
    }
    const bits =
      (BigInt(tierId) << 98n) |
      (BigInt(expDays) << 74n) |
      (BigInt(keyId) << 66n) |
      takeBits(signature, EXTENDED_TRUNC_BITS);
    return groupChars(bitsToChars(bits, EXTENDED_CHARS));
  }
  const bits =
    (BigInt(tierId) << 58n) | (BigInt(expDays) << 34n) | takeBits(signature, COMPACT_TRUNC_BITS);
  return groupChars(bitsToChars(bits, COMPACT_CHARS));
}

/**
 * Mint an individually-redeemable (bridge-issued style) code: 12 random
 * Crockford chars from `crypto.getRandomValues` — a registry HANDLE with no
 * offline meaning; verifyCode resolves it via `lookupRegistered`.
 */
export function mintRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return groupChars(bitsToChars(value >> 4n, COMPACT_CHARS));
}

// ---------------------------------------------------------------------------
// Verification (outcome precedence: invalid → already-used → expired → valid)
// ---------------------------------------------------------------------------

const INVALID: VerifyCodeResult = { outcome: "invalid" };

async function importVerifyKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("raw", raw, "Ed25519", false, ["verify"]);
  } catch {
    // Older engines reject raw import for Ed25519; retry the SPKI-wrapped form
    // (same fallback contract as B.3's verify-web.ts).
    return await crypto.subtle.importKey("spki", rawEd25519PublicKeyToSpki(raw), "Ed25519", false, [
      "verify",
    ]);
  }
}

/**
 * Verify a redeem code against the baked public key, offline. Rejection
 * order: malformed charset/shape/keyId/signature → `invalid`; consumed →
 * `already-used`; past expiry → `expired`; else `valid` with the tier and
 * expiry. The extended shape ignores `lookupRegistered` by design (it
 * verifies fully offline); the compact shape with a wired lookup is a pure
 * registry handle (a miss is invalid).
 */
export async function verifyCode(
  rawCode: string,
  options: VerifyCodeOptions,
): Promise<VerifyCodeResult> {
  const canonical = normalizeCode(rawCode);
  if (canonical === null) return INVALID;
  const body = canonical.slice(CODE_PREFIX.length + 1).replaceAll("-", "");
  const codeHash = await consumedCodeHash(canonical);
  const now = options.now ?? Date.now();

  // Registry-handle path (compact shape, lookup wired): the record is
  // authoritative for tier/exp; the local ledger enforces single-use.
  const lookup = options.lookupRegistered;
  if (body.length === COMPACT_CHARS && lookup !== undefined) {
    const record = lookup(canonical);
    if (record === null) return INVALID;
    if (options.hasBeenConsumed?.(codeHash)) return { outcome: "already-used" };
    if (now > record.exp) return { outcome: "expired" };
    return { outcome: "valid", tier: record.tier, exp: record.exp };
  }

  const fields = decodeFields(body);
  if (fields === null) return INVALID;
  const tier = tierOf(fields.tierId);
  if (tier === null) return INVALID;

  const pubkeyRaw = publicKeyBytes(options.publicKey);

  // Offline key binding (extended shape): the embedded 8-bit slice must match
  // the verifier's own derivation from the baked key.
  if (fields.shape === "extended") {
    const expectedKeyId = (await sha256Bytes(pubkeyRaw))[0];
    if (expectedKeyId === undefined || fields.keyId !== expectedKeyId) return INVALID;
  }

  // Full-confirmation path: when the canonical record's signature is at hand,
  // the truncation is the fast reject filter and the real Ed25519 verify runs
  // (WebCrypto, offline) over the reconstructed payload bytes.
  const fullSignature = options.fullSignature;
  if (fullSignature !== undefined) {
    const truncBits =
      fields.shape === "extended" ? EXTENDED_TRUNC_BITS : COMPACT_TRUNC_BITS;
    if (fullSignature.byteLength !== 64) return INVALID;
    if (takeBits(fullSignature, truncBits) !== fields.truncation) return INVALID;
    const key = await importVerifyKey(pubkeyRaw);
    const sigBytes = new Uint8Array(fullSignature.byteLength);
    sigBytes.set(fullSignature);
    const valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      sigBytes.buffer,
      payloadMessage(tier, fields.expDays),
    );
    if (!valid) return INVALID;
  }

  if (options.hasBeenConsumed?.(codeHash)) return { outcome: "already-used" };
  const exp = expiryDeadline(fields.expDays);
  if (now > exp) return { outcome: "expired" };
  return { outcome: "valid", tier, exp };
}
