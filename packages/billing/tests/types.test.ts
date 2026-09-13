import { stdout } from "node:process";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  type AppUserId,
  type CheckoutSession,
  CheckoutSessionSchema,
  type ConsumedCode,
  ConsumedCodeSchema,
  type ConsumeResult,
  ConsumeResultSchema,
  type DenyList,
  DenyListSchema,
  type LicenseToken,
  type LicenseTokenPayload,
  LicenseTokenPayloadSchema,
  LicenseTokenSchema,
  type ManifestAsset,
  ManifestAssetSchema,
  type ModelManifest,
  ModelManifestSchema,
  type Offering,
  OfferingSchema,
  type PurchaseAdapter,
  type PurchaseAdapterId,
  PurchaseAdapterIdSchema,
  type Reading,
  ReadingSchema,
  type SignedDenyList,
  SignedDenyListSchema,
  type TrialPolicy,
  TrialPolicySchema,
} from "../src/types.js";

const hash = "ab".repeat(32);
const offering: Offering = {
  id: "unlimited-lifetime",
  priceString: "CA$49.99",
  tier: "unlimited",
};
const licensePayload: LicenseTokenPayload = {
  sub: "app-user-1",
  tier: "unlimited",
  iat: 1_789_200_000,
  exp: null,
  iss: "natally-license-bridge",
  jti: "license-1",
};
const asset: ManifestAsset = {
  id: "trial-llm",
  kind: "llm",
  file: "models/trial-llm.onnx",
  bytes: 128_000_000,
  sha256: hash,
  quant: "q4",
  trialEligible: true,
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error("Billing fixture did not serialize as valid JSON", { cause });
  }
}

function roundtrip<T>(schema: z.ZodType<T>, value: T): T {
  const serialized = JSON.stringify(schema.parse(value));
  const result = schema.parse(parseJson(serialized));
  expect(result).toStrictEqual(value);
  return result;
}

describe("billing contracts", () => {
  it.each<TrialPolicy>([
    { mode: "count", readings: 3, trialModel: "trial-llm" },
    { mode: "time", days: 7, trialModel: "trial-llm" },
    { mode: "rate", cooldownDays: 2, trialModel: "trial-llm" },
  ])("roundtrips the $mode trial policy", (policy) => {
    roundtrip(TrialPolicySchema, policy);
  });

  it("preserves omitted policy limits without introducing defaults", () => {
    const policy = roundtrip(TrialPolicySchema, {
      mode: "count",
      trialModel: "trial-llm",
    });
    expect(policy).not.toHaveProperty("readings");
    expect(policy).not.toHaveProperty("days");
    expect(policy).not.toHaveProperty("cooldownDays");
  });

  it.each(["readings", "days", "cooldownDays"] as const)("rejects invalid %s limits", (field) => {
    for (const invalid of [-1, 0, 1.5, Infinity, NaN, "3"]) {
      expect(
        TrialPolicySchema.safeParse({
          mode: "count",
          trialModel: "trial-llm",
          [field]: invalid,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown trial modes and a missing model", () => {
    expect(
      TrialPolicySchema.safeParse({ mode: "unlimited", trialModel: "trial-llm" }).success,
    ).toBe(false);
    expect(TrialPolicySchema.safeParse({ mode: "count" }).success).toBe(false);
  });

  it("roundtrips reading identity, time, and chart references", () => {
    const reading: Reading = {
      id: "reading-1",
      ts: 1_789_200_000,
      personId: "person-1",
      chartId: "chart-1",
    };
    roundtrip(ReadingSchema, reading);
    for (const field of ["id", "personId", "chartId"] as const) {
      expect(ReadingSchema.safeParse({ ...reading, [field]: "" }).success).toBe(false);
    }
    expect(ReadingSchema.safeParse({ ...reading, ts: -1 }).success).toBe(false);
    expect(ReadingSchema.safeParse({ ...reading, ts: "today" }).success).toBe(false);
  });

  it("roundtrips the opaque license transport and its separately decoded payload", () => {
    // A transport fixture is not a cryptographically verified license.
    const token: LicenseToken = "hEOhASegWCBwYXlsb2FkWEBzaWduYXR1cmU";
    roundtrip(LicenseTokenSchema, token);
    roundtrip(LicenseTokenPayloadSchema, licensePayload);
    expect(LicenseTokenSchema.safeParse("").success).toBe(false);
    expect(LicenseTokenSchema.safeParse(licensePayload).success).toBe(false);
  });

  it.each([
    { tier: "trial" },
    { exp: 1_789_300_000 },
    { iss: "other-issuer" },
    { sub: "" },
    { jti: "" },
    { iat: -1 },
  ])("rejects altered fixed license claims or invalid identifiers: %j", (patch) => {
    expect(LicenseTokenPayloadSchema.safeParse({ ...licensePayload, ...patch }).success).toBe(
      false,
    );
  });

  it("requires explicit non-expiry and a revocable token identifier", () => {
    const withoutExpiry: Partial<LicenseTokenPayload> = { ...licensePayload };
    const withoutJti: Partial<LicenseTokenPayload> = { ...licensePayload };
    delete withoutExpiry.exp;
    delete withoutJti.jti;
    expect(LicenseTokenPayloadSchema.safeParse(withoutExpiry).success).toBe(false);
    expect(LicenseTokenPayloadSchema.safeParse(withoutJti).success).toBe(false);
  });

  it("roundtrips empty and populated revocation payloads inside signed envelopes", () => {
    for (const revokedJti of [[], ["license-1", "license-2"]]) {
      const payload: DenyList = { issuedAt: 1_789_200_000, revokedJti };
      const envelope: SignedDenyList = { payload, signature: "c2lnbmF0dXJl" };
      roundtrip(DenyListSchema, payload);
      roundtrip(SignedDenyListSchema, envelope);
    }
  });

  it("rejects unsigned envelopes and malformed revocation entries", () => {
    const payload: DenyList = { issuedAt: 0, revokedJti: [] };
    expect(SignedDenyListSchema.safeParse({ payload }).success).toBe(false);
    expect(SignedDenyListSchema.safeParse({ payload, signature: "" }).success).toBe(false);
    expect(DenyListSchema.safeParse({ ...payload, revokedJti: [""] }).success).toBe(false);
    expect(DenyListSchema.safeParse({ ...payload, issuedAt: -1 }).success).toBe(false);
  });

  it("roundtrips a consumed code hash and redemption time without raw coupon text", () => {
    const consumed: ConsumedCode = { codeHash: hash, redeemedAt: 1_789_200_000 };
    roundtrip(ConsumedCodeSchema, consumed);
    expect(ConsumedCodeSchema.safeParse({ ...consumed, codeHash: "COUPON-TEXT" }).success).toBe(
      false,
    );
    expect(ConsumedCodeSchema.safeParse({ ...consumed, code: "COUPON-TEXT" }).success).toBe(false);
  });

  it("roundtrips localized prices and optional ISO durations", () => {
    roundtrip(OfferingSchema, offering);
    roundtrip(OfferingSchema, {
      ...offering,
      priceString: "49,99 €",
      durationIso: "P1Y",
    });
    expect(OfferingSchema.safeParse({ ...offering, durationIso: "yearly" }).success).toBe(false);
    expect(OfferingSchema.safeParse({ ...offering, tier: "premium" }).success).toBe(false);
  });

  it.each<CheckoutSession>([
    { kind: "redirect", url: "https://checkout.example/session/1", offering },
    { kind: "iap", offering },
    { kind: "rc", offering },
  ])("roundtrips $kind checkout sessions", (session) => {
    roundtrip(CheckoutSessionSchema, session);
  });

  it("rejects invalid checkout kinds, URLs, and nested offerings", () => {
    expect(CheckoutSessionSchema.safeParse({ kind: "cash", offering }).success).toBe(false);
    expect(
      CheckoutSessionSchema.safeParse({ kind: "redirect", offering, url: "invalid" }).success,
    ).toBe(false);
    expect(
      CheckoutSessionSchema.safeParse({
        kind: "rc",
        offering: { ...offering, tier: "premium" },
      }).success,
    ).toBe(false);
  });

  it("accepts exactly the six assigned purchase rails", () => {
    const ids: PurchaseAdapterId[] = [
      "stripe",
      "revenuecat",
      "polar",
      "lemonsqueezy",
      "paypal",
      "square",
    ];
    expect(PurchaseAdapterIdSchema.options).toStrictEqual(ids);
    for (const id of ids) roundtrip(PurchaseAdapterIdSchema, id);
    for (const id of ["btcpay", "play", "Stripe", "lemon-squeezy", ""]) {
      expect(PurchaseAdapterIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("exposes synchronous availability and asynchronous checkout and account restore", () => {
    expectTypeOf<AppUserId>().toEqualTypeOf<string>();
    expectTypeOf<PurchaseAdapter["id"]>().toEqualTypeOf<PurchaseAdapterId>();
    expectTypeOf<PurchaseAdapter["available"]>().toEqualTypeOf<() => boolean>();
    expectTypeOf<PurchaseAdapter["checkout"]>().toEqualTypeOf<
      (offering: Offering) => Promise<CheckoutSession>
    >();
    expectTypeOf<PurchaseAdapter["restore"]>().toEqualTypeOf<
      (account: AppUserId) => Promise<LicenseToken | null>
    >();
  });

  it("roundtrips allowed results and every consumption denial reason", () => {
    const results: ConsumeResult[] = [
      { allowed: true },
      { allowed: false },
      { allowed: false, reason: "trial-exhausted" },
      { allowed: false, reason: "rate-limited" },
      { allowed: false, reason: "unlicensed" },
      { allowed: false, reason: "insufficient-credit" },
    ];
    for (const result of results) roundtrip(ConsumeResultSchema, result);
    expect(ConsumeResultSchema.safeParse({ allowed: false, reason: "unknown" }).success).toBe(
      false,
    );
    expect(ConsumeResultSchema.safeParse({ allowed: "false" }).success).toBe(false);
  });

  it("roundtrips every model asset kind and the complete manifest", () => {
    const assets: ManifestAsset[] = [
      asset,
      { ...asset, id: "embedder", kind: "embedder", trialEligible: false },
      { ...asset, id: "kokoro", kind: "voice" },
      { ...asset, id: "voice-pack", kind: "voices" },
    ];
    const manifest: ModelManifest = { version: "1", assets };
    for (const entry of assets) roundtrip(ManifestAssetSchema, entry);
    roundtrip(ModelManifestSchema, manifest);
    roundtrip(ModelManifestSchema, { version: "1", assets: [] });
  });

  it("preserves absent asset options and explicit zero-byte sizes", () => {
    const minimal: ManifestAsset = {
      id: "voice-pack",
      kind: "voices",
      file: "models/voices.bin",
      bytes: 0,
      sha256: hash,
    };
    const parsed = roundtrip(ManifestAssetSchema, minimal);
    expect(parsed).not.toHaveProperty("quant");
    expect(parsed).not.toHaveProperty("trialEligible");
  });

  it.each([
    { kind: "speech" },
    { bytes: -1 },
    { bytes: 0.5 },
    { bytes: Infinity },
    { bytes: "128000000" },
    { sha256: "a".repeat(63) },
    { sha256: "a".repeat(65) },
    { sha256: "g".repeat(64) },
    { file: "" },
    { trialEligible: "true" },
  ])("rejects malformed assets both directly and inside manifests: %j", (patch) => {
    const invalid = { ...asset, ...patch };
    expect(ManifestAssetSchema.safeParse(invalid).success).toBe(false);
    expect(ModelManifestSchema.safeParse({ version: "1", assets: [invalid] }).success).toBe(false);
  });

  it("billing types: roundtrip OK", () => {
    // Emit the acceptance line only after the full set survives serialization.
    roundtrip(TrialPolicySchema, { mode: "count", readings: 3, trialModel: asset.id });
    roundtrip(ReadingSchema, { id: "r1", ts: 0, personId: "p1", chartId: "c1" });
    roundtrip(LicenseTokenSchema, "opaque-cose-transport");
    roundtrip(LicenseTokenPayloadSchema, licensePayload);
    roundtrip(DenyListSchema, { issuedAt: 0, revokedJti: [licensePayload.jti] });
    roundtrip(SignedDenyListSchema, {
      payload: { issuedAt: 0, revokedJti: [] },
      signature: "c2lnbmF0dXJl",
    });
    roundtrip(ConsumedCodeSchema, { codeHash: hash, redeemedAt: 0 });
    roundtrip(OfferingSchema, offering);
    roundtrip(CheckoutSessionSchema, { kind: "rc", offering });
    roundtrip(PurchaseAdapterIdSchema, "revenuecat");
    roundtrip(ConsumeResultSchema, { allowed: false, reason: "insufficient-credit" });
    roundtrip(ManifestAssetSchema, asset);
    roundtrip(ModelManifestSchema, { version: "1", assets: [asset] });
    stdout.write("billing types: roundtrip OK\n");
  });
});
