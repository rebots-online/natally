// natally — T0.7 verify: zod roundtrip over every exported billing contract
// schema (ARCHITECTURE §9, §13). Accept: `billing types: roundtrip OK`.

import { expect, test } from "vitest";
import type { ZodType } from "zod";
import type {
  CheckoutSession,
  ConsumedCode,
  ConsumeResult,
  DenyList,
  LicensePayload,
  ManifestAsset,
  ModelManifest,
  Offering,
  Reading,
  TrialPolicy,
} from "../src/types";
import {
  CheckoutSessionSchema,
  ConsumedCodeSchema,
  ConsumeResultSchema,
  DenyListSchema,
  LicensePayloadSchema,
  ManifestAssetSchema,
  ModelManifestSchema,
  OfferingSchema,
  ReadingSchema,
  TrialPolicySchema,
} from "../src/types";

function roundtrip<T>(schema: ZodType<T>, fixture: T): void {
  const once = schema.parse(fixture);
  expect(once).toEqual(fixture);
  expect(schema.parse(once)).toEqual(fixture);
}

const hex64 = (c: string): string => c.repeat(64);

const trialPolicies: TrialPolicy[] = [
  { mode: "count", readings: 3, trialModel: "qwen3-1.7b-q4_k_m" },
  { mode: "time", days: 14, trialModel: "qwen3-1.7b-q4_k_m" },
  { mode: "rate", cooldownDays: 3, trialModel: "qwen3-1.7b-q4_k_m" },
];

const reading: Reading = {
  id: "r_0001",
  ts: 1760000000000,
  personId: "p_robin",
  chartId: "c_natal_robin",
};

const licensePayload: LicensePayload = {
  sub: "u_robin",
  tier: "unlimited",
  iat: 1760000000,
  exp: null,
  iss: "natally-license-bridge",
  jti: "jti_01HZZXQ7K4",
};

const consumedCode: ConsumedCode = {
  codeHash: hex64("9"),
  redeemedAt: 1760000000000,
};

const offering: Offering = {
  id: "natally_unlimited_p1y",
  priceString: "$49.00",
  tier: "unlimited",
  durationIso: "P1Y",
};

const checkoutSessions: CheckoutSession[] = [
  { kind: "redirect", url: "https://checkout.example.com/pay/cs_test", offering },
  { kind: "iap", offering },
  { kind: "rc", offering },
];

const consumeResults: ConsumeResult[] = [
  { allowed: true },
  { allowed: false, reason: "trial-exhausted" },
  { allowed: false, reason: "rate-limited" },
  { allowed: false, reason: "unlicensed" },
  { allowed: false, reason: "insufficient-credit" },
];

const denyList: DenyList = {
  issuedAt: 1760000000000,
  revokedJti: ["jti_01HZZXQ7K4", "jti_01HZZXQ7K5"],
  sig: "b64ed2559sig==",
};

const manifestAssets: ManifestAsset[] = [
  {
    id: "qwen3-1.7b-q4_k_m",
    kind: "llm",
    file: "llm/qwen3-1.7b-q4_k_m.gguf",
    bytes: 1_100_000_000,
    sha256: hex64("a"),
    quant: "q4_k_m",
    trialEligible: true,
  },
  {
    id: "bge-small-en-v1_5-q8",
    kind: "embedder",
    file: "embedder/bge-small-en-v1.5-q8.onnx",
    bytes: 33_000_000,
    sha256: hex64("c"),
  },
  {
    id: "kokoro-v1_0",
    kind: "voice",
    file: "voice/kokoro-v1.0.onnx",
    bytes: 310_000_000,
    sha256: hex64("e"),
  },
  {
    id: "kokoro-v1_0-voices",
    kind: "voices",
    file: "voices/kokoro-v1.0-voices.bin",
    bytes: 6_000_000,
    sha256: hex64("1"),
  },
];

const manifest: ModelManifest = { version: "1", assets: manifestAssets };

test("billing types: roundtrip OK", () => {
  for (const policy of trialPolicies) roundtrip(TrialPolicySchema, policy);
  roundtrip(ReadingSchema, reading);
  roundtrip(LicensePayloadSchema, licensePayload);
  roundtrip(ConsumedCodeSchema, consumedCode);
  roundtrip(OfferingSchema, offering);
  for (const session of checkoutSessions) roundtrip(CheckoutSessionSchema, session);
  for (const result of consumeResults) roundtrip(ConsumeResultSchema, result);
  roundtrip(DenyListSchema, denyList);
  for (const asset of manifestAssets) roundtrip(ManifestAssetSchema, asset);
  roundtrip(ModelManifestSchema, manifest);

  // Rejection sanity: the contracts refuse what they must not accept.
  expect(() => LicensePayloadSchema.parse({ ...licensePayload, tier: "pro" })).toThrow();
  expect(() => CheckoutSessionSchema.parse({ kind: "banana", offering })).toThrow();
  expect(() => ConsumedCodeSchema.parse({ codeHash: "nothex", redeemedAt: 0 })).toThrow();
});
