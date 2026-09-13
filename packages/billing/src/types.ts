import { z } from "zod";

const identifier = z.string().min(1);
const timestamp = z.number().int().nonnegative();
const sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/);

export const TrialPolicySchema = z.strictObject({
  mode: z.enum(["count", "time", "rate"]),
  readings: z.number().int().positive().optional(),
  days: z.number().int().positive().optional(),
  cooldownDays: z.number().int().positive().optional(),
  trialModel: identifier,
});
export type TrialPolicy = z.infer<typeof TrialPolicySchema>;

export const ReadingSchema = z.strictObject({
  id: identifier,
  ts: timestamp,
  personId: identifier,
  chartId: identifier,
});
export type Reading = z.infer<typeof ReadingSchema>;

export type AppUserId = string;

/** Compact COSE-style transport; parsing its shape does not verify its signature. */
export const LicenseTokenSchema = z.string().min(1);
export type LicenseToken = z.infer<typeof LicenseTokenSchema>;

export const LicenseTokenPayloadSchema = z.strictObject({
  sub: identifier,
  tier: z.literal("unlimited"),
  iat: timestamp,
  exp: z.null(),
  iss: z.literal("natally-license-bridge"),
  jti: identifier,
});
export type LicenseTokenPayload = z.infer<typeof LicenseTokenPayloadSchema>;

/** Revocation payload; trust requires verification of its enclosing signature. */
export const DenyListSchema = z.strictObject({
  issuedAt: timestamp,
  revokedJti: z.array(identifier),
});
export type DenyList = z.infer<typeof DenyListSchema>;

/** Signature encoding and cryptographic verification belong to the license bridge. */
export const SignedDenyListSchema = z.strictObject({
  payload: DenyListSchema,
  signature: z.string().min(1),
});
export type SignedDenyList = z.infer<typeof SignedDenyListSchema>;

export const ConsumedCodeSchema = z.strictObject({
  codeHash: sha256,
  redeemedAt: timestamp,
});
export type ConsumedCode = z.infer<typeof ConsumedCodeSchema>;

export const OfferingSchema = z.strictObject({
  id: identifier,
  priceString: z.string().min(1),
  tier: z.literal("unlimited"),
  durationIso: z.iso.duration().optional(),
});
export type Offering = z.infer<typeof OfferingSchema>;

export const CheckoutSessionSchema = z.strictObject({
  kind: z.enum(["redirect", "iap", "rc"]),
  url: z.url().optional(),
  offering: OfferingSchema,
});
export type CheckoutSession = z.infer<typeof CheckoutSessionSchema>;

export const PurchaseAdapterIdSchema = z.enum([
  "stripe",
  "revenuecat",
  "polar",
  "lemonsqueezy",
  "paypal",
  "square",
]);
export type PurchaseAdapterId = z.infer<typeof PurchaseAdapterIdSchema>;

/** Restoring a purchase requests entitlement synchronization; it grants nothing here. */
export interface PurchaseAdapter {
  readonly id: PurchaseAdapterId;
  available(): boolean;
  checkout(offering: Offering): Promise<CheckoutSession>;
  restore(account: AppUserId): Promise<LicenseToken | null>;
}

export const ConsumeResultSchema = z.strictObject({
  allowed: z.boolean(),
  reason: z
    .enum(["trial-exhausted", "rate-limited", "unlicensed", "insufficient-credit"])
    .optional(),
});
export type ConsumeResult = z.infer<typeof ConsumeResultSchema>;

export const ManifestAssetSchema = z.strictObject({
  id: identifier,
  kind: z.enum(["llm", "embedder", "voice", "voices"]),
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256,
  quant: z.string().min(1).optional(),
  trialEligible: z.boolean().optional(),
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

export const ModelManifestSchema = z.strictObject({
  version: z.string().min(1),
  assets: z.array(ManifestAssetSchema),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;
