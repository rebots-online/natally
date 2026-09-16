// natally — billing contracts (ARCHITECTURE §9 Licensing & entitlement, §13
// Model mirror contract). Pure types + zod schemas: the only import allowed in
// this module is zod. Runtime behaviour (COSE-style token encoding, ledger,
// adapters, bridge client) lives in sibling tasks.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A locally-stable app user id (keychain / IndexedDB scope, §9.3). */
export type AppUserId = string;

declare const licenseTokenBrand: unique symbol;

/**
 * Compact COSE/CWT-style license token string (§9.3): Ed25519-signed,
 * offline-verifiable against the build-baked public key. Carrier type only —
 * the compact encoder/verifier belongs to a later task.
 */
export type LicenseToken = string & {
  readonly [licenseTokenBrand]: "natally.billing.LicenseToken";
};

/** Epoch milliseconds (local ledger timestamps: Reading, ConsumedCode, DenyList). */
const epochMs = z.number().int().nonnegative();
/** Epoch seconds (CWT NumericDate convention for token claims, §9.3). */
const epochSeconds = z.number().int().nonnegative();
const nonEmpty = z.string().min(1);
/** Lowercase-or-uppercase hex SHA-256 digest. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/i);
/** ISO 8601 duration, e.g. `P1Y`, `P3M`, `P14D`. */
const isoDuration = z
  .string()
  .regex(
    /^P(?!$)(\d+(?:\.\d+)?Y)?(\d+(?:\.\d+)?M)?(\d+(?:\.\d+)?W)?(\d+(?:\.\d+)?D)?(T(?=\d)(\d+(?:\.\d+)?H)?(\d+(?:\.\d+)?M)?(\d+(?:\.\d+)?S)?)?$/,
  );

// ---------------------------------------------------------------------------
// §9.1 Trial policy
// ---------------------------------------------------------------------------

/**
 * Baked at build from `.env` (§15). `mode` selects which limit applies;
 * `trialModel` is exactly one model-catalogue id — trial users may run only
 * that asset; every other catalogue row renders the lock and routes to
 * `/paywall`.
 */
export const TrialPolicySchema = z.object({
  mode: z.enum(["count", "time", "rate"]),
  readings: z.number().int().positive().optional(),
  days: z.number().int().positive().optional(),
  cooldownDays: z.number().int().nonnegative().optional(),
  trialModel: nonEmpty,
});
export type TrialPolicy = z.infer<typeof TrialPolicySchema>;

// ---------------------------------------------------------------------------
// §9.2 Reading unit & usage ledger
// ---------------------------------------------------------------------------

/** One ledger row: consumed when the companion produces her first Tier-1-grounded turn referencing a plate. Append-only. */
export const ReadingSchema = z.object({
  id: nonEmpty,
  ts: epochMs,
  personId: nonEmpty,
  chartId: nonEmpty,
});
export type Reading = z.infer<typeof ReadingSchema>;

// ---------------------------------------------------------------------------
// §9.3 License token payload
// ---------------------------------------------------------------------------

/**
 * Ed25519-signed token payload (§9.3). `exp` is always `null`: a purchase is
 * perpetual; revocation is handled by the bridge-published deny-list, which
 * never blocks a verified unexpired token when offline.
 */
export const LicensePayloadSchema = z.object({
  sub: nonEmpty,
  tier: z.literal("unlimited"),
  iat: epochSeconds,
  exp: z.null(),
  iss: z.literal("natally-license-bridge"),
  jti: nonEmpty,
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

// ---------------------------------------------------------------------------
// §9.5 Consumed codes (single-use enforcement, local half of the ledger)
// ---------------------------------------------------------------------------

/** Bridge-issued redeem codes are stored SHA-256-hashed; re-use is denied locally. */
export const ConsumedCodeSchema = z.object({
  codeHash: sha256Hex,
  redeemedAt: epochMs,
});
export type ConsumedCode = z.infer<typeof ConsumedCodeSchema>;

// ---------------------------------------------------------------------------
// §9.4 Offerings, checkout sessions, purchase adapters
// ---------------------------------------------------------------------------

/** A purchasable offering as presented by a processor rail (single paid tier). */
export const OfferingSchema = z.object({
  id: nonEmpty,
  priceString: nonEmpty,
  tier: z.literal("unlimited"),
  durationIso: isoDuration.optional(),
});
export type Offering = z.infer<typeof OfferingSchema>;

/** Hosted URL (`redirect`), native store sheet (`iap`) or RevenueCat paywall (`rc`). */
export const CheckoutSessionSchema = z.object({
  kind: z.enum(["redirect", "iap", "rc"]),
  url: z.url().optional(),
  offering: OfferingSchema,
});
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

/** The six processor rails of §9.4 (presence driven by `.env`). */
export type PurchaseAdapterId =
  | "stripe"
  | "revenuecat"
  | "polar"
  | "lemonsqueezy"
  | "paypal"
  | "square";

/** One interface, six adapters (§9.4). No processor secret ever ships in a client. */
export interface PurchaseAdapter {
  readonly id: PurchaseAdapterId;
  /** True when this rail's `.env` keys are present — the paywall's honest "Ways to pay" readout. */
  available(): boolean;
  checkout(offering: Offering): Promise<CheckoutSession>;
  restore(account: AppUserId): Promise<LicenseToken | null>;
}

// ---------------------------------------------------------------------------
// §9.6 billing.consume seam (frozen now; local consult here, per-reading debit
// over Lightning/x402 in the hosted edition — same shape, R2's clause)
// ---------------------------------------------------------------------------

export const ConsumeResultSchema = z.object({
  allowed: z.boolean(),
  reason: z
    .enum(["trial-exhausted", "rate-limited", "unlicensed", "insufficient-credit"])
    .optional(),
});
export type ConsumeResult = z.infer<typeof ConsumeResultSchema>;

// ---------------------------------------------------------------------------
// §9.3 Deny-list (bridge-published, signed, dated)
// ---------------------------------------------------------------------------

/**
 * The unsigned body of a deny-list publication. `sig` on the envelope below is
 * the Ed25519 signature (base64) over the canonical serialization of exactly
 * this payload; checked when online, never blocking offline.
 */
export const DenyListPayloadSchema = z.object({
  issuedAt: epochMs,
  revokedJti: z.array(nonEmpty),
});
export type DenyListPayload = z.infer<typeof DenyListPayloadSchema>;

export const DenyListSchema = DenyListPayloadSchema.extend({
  sig: nonEmpty,
});
export type DenyList = z.infer<typeof DenyListSchema>;

// ---------------------------------------------------------------------------
// §13 Model mirror contract
// ---------------------------------------------------------------------------

/** One downloadable mirror asset. `quant` applies to quantized weights (e.g. `q4_k_m`). */
export const ManifestAssetSchema = z.object({
  id: nonEmpty,
  kind: z.enum(["llm", "embedder", "voice", "voices"]),
  file: nonEmpty,
  bytes: z.number().int().nonnegative(),
  sha256: sha256Hex,
  quant: nonEmpty.optional(),
  trialEligible: z.boolean().optional(),
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

/** `manifest.json` at `VITE_MODEL_MIRROR_BASE` — shared by the LLM catalogue and the voice mirror. */
export const ModelManifestSchema = z.object({
  version: nonEmpty,
  assets: z.array(ManifestAssetSchema),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;
