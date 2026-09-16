// natally — B.5c adapter-registry tests (TEST_RUBRIC TR-3/B.5c).
//
// Real adapters throughout: the available rails are REAL B.5a hosted adapters
// (set `configUrl`) and a REAL B.5b RevenueCat adapter (set `sdkKey`); the
// absent rails are the same real factories with blank config (`configUrl` /
// `sdkKey` undefined — the honest `.env` absence). Redeem delegation runs the
// REAL B.4 `mintHashBased` → `verifyCode` pair over real WebCrypto Ed25519
// (node 24 + browsers) for a valid/expired code pair. The only test-scope
// stubs are the injected opener recorder, the always-offline transport
// (restore is out of this matrix), and the RC handle/bridge-mint plain
// objects — tests may stub injected parameters; src never does.

import { describe, expect, it } from "vitest";
import { createHostedAdapter, type HostedRail } from "../src/adapters/hosted";
import {
  createAdapterRegistry,
  PAYMENT_ORDER,
  paymentsAvailable,
  type RedeemCodeFn,
  RegistryError,
} from "../src/adapters/registry";
import { createRevenueCatAdapter } from "../src/adapters/revenuecat";
import type { TokenVerifier, Transport } from "../src/bridge-client";
import { DAY_MS, keyIdForPubkey, mintHashBased, verifyCode } from "../src/codes";
import type { SignFn } from "../src/token/format";
import { verifyToken } from "../src/token/verify-web";
import type { Offering } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures: one real WebCrypto Ed25519 keypair, one clock, one offering
// ---------------------------------------------------------------------------

const APP_USER = "user-robin";
const BRIDGE = "https://bridge.natally.example";
const CHECKOUT_URL: Record<HostedRail, string> = {
  stripe: "https://checkout.stripe.example/c/pay",
  polar: "https://polar.example/checkout",
  lemonsqueezy: "https://lemonsqueezy.example/buy",
  paypal: "https://paypal.example/buy",
  square: "https://square.example/checkout",
};
const OFFERING: Offering = { id: "unlimited-lifetime", priceString: "$49", tier: "unlimited" };

const EXP_DAYS = 20_000;
/** Last millisecond of expiry day EXP_DAYS — the exact day-granular deadline. */
const EXP = EXP_DAYS * DAY_MS + (DAY_MS - 1);
const NOW = EXP_DAYS * DAY_MS;
const PAST_EXP_DAYS = 5;
const PAST_EXP = PAST_EXP_DAYS * DAY_MS + (DAY_MS - 1);

interface TestKeypair {
  readonly privateKey: CryptoKey;
  readonly publicKeyRaw: Uint8Array;
}

async function makeKeypair(): Promise<TestKeypair> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyRaw };
}

function signerFor(privateKey: CryptoKey): SignFn {
  return async (signingInput) =>
    new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, signingInput));
}

/** Real B.3 verifier bound to the test keypair (the wiring-time binding). */
function verifierFor(publicKeyRaw: Uint8Array): TokenVerifier {
  return (token, appUserId) => verifyToken(token, { publicKey: publicKeyRaw, appUserId });
}

function offlineTransport(): Transport {
  return async () => {
    throw new Error("test transport: offline");
  };
}

// ---------------------------------------------------------------------------
// Real adapter instances (B.5a / B.5b) — blank config ⇒ honest absence
// ---------------------------------------------------------------------------

function hostedRail(
  rail: HostedRail,
  publicKeyRaw: Uint8Array,
  configUrl: string | undefined,
): { adapter: ReturnType<typeof createHostedAdapter>; openerCalls: string[] } {
  const openerCalls: string[] = [];
  const adapter = createHostedAdapter({
    rail,
    configUrl,
    bridgeUrl: BRIDGE,
    appUserId: APP_USER,
    opener: (url) => {
      openerCalls.push(url);
    },
    transport: offlineTransport(),
    verifyToken: verifierFor(publicKeyRaw),
    pollIntervalMs: 1,
    pollCapMs: 1,
  });
  return { adapter, openerCalls };
}

function revenueCatRail(
  publicKeyRaw: Uint8Array,
  sdkKey: string | undefined,
): ReturnType<typeof createRevenueCatAdapter> {
  return createRevenueCatAdapter({
    sdkKey,
    appUserId: APP_USER,
    purchases: {
      presentPaywall: async () => undefined,
      getCustomerInfo: async () => ({ entitlements: {} }),
      restore: async () => ({ entitlements: {} }),
    },
    bridgeMint: async () => null,
    verifyToken: verifierFor(publicKeyRaw),
    onToken: () => undefined,
    entitlementPollIntervalMs: 1,
    entitlementPollCapMs: 1,
  });
}

/**
 * The mixed wiring the paywall would see: three present rails (stripe,
 * revenuecat, polar — wired in NON-canonical order), the other three hosted
 * rails absent (blank configUrl), plus a second RevenueCat instance built
 * WITHOUT an sdkKey to prove a wired-but-absent instance is hidden too.
 */
async function buildMixedRegistry(keypair: TestKeypair) {
  const polar = hostedRail("polar", keypair.publicKeyRaw, CHECKOUT_URL.polar);
  const rcUnconfigured = revenueCatRail(keypair.publicKeyRaw, undefined);
  const stripe = hostedRail("stripe", keypair.publicKeyRaw, CHECKOUT_URL.stripe);
  const lemonsqueezy = hostedRail("lemonsqueezy", keypair.publicKeyRaw, undefined);
  const rcConfigured = revenueCatRail(keypair.publicKeyRaw, "rc_web_sdk_key_test");
  const paypal = hostedRail("paypal", keypair.publicKeyRaw, undefined);
  const square = hostedRail("square", keypair.publicKeyRaw, undefined);

  const consumed = new Set<string>();
  const redeemCode: RedeemCodeFn = (code) =>
    verifyCode(code, {
      publicKey: keypair.publicKeyRaw,
      now: NOW,
      hasBeenConsumed: (hash) => consumed.has(hash),
    });

  const registry = createAdapterRegistry({
    adapters: [
      polar.adapter,
      rcUnconfigured, // available() false — must be filtered, never shadow the configured rail
      stripe.adapter,
      lemonsqueezy.adapter,
      rcConfigured,
      paypal.adapter,
      square.adapter,
    ],
    redeemCode,
  });

  return {
    registry,
    redeemCode,
    stripeOpenerCalls: stripe.openerCalls,
    rcUnconfigured,
  };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("registry: hides absent rails, exposes present set", () => {
  it("paymentsAvailable hides absent rails and lists the present set in canonical order", async () => {
    const keypair = await makeKeypair();
    const { registry, rcUnconfigured } = await buildMixedRegistry(keypair);

    // Honest absence at the factory level (blank .env keys ⇒ rail hidden).
    expect(rcUnconfigured.available()).toBe(false);

    // The wired-but-absent RC instance is filtered; the present set is
    // exactly {stripe, revenuecat, polar} — in canonical order, no duplicates,
    // regardless of the wiring array's scrambled order.
    expect(registry.availableIds).toEqual(["stripe", "revenuecat", "polar"]);
    expect(registry.availableIds).toEqual(
      PAYMENT_ORDER.filter((id) => ["stripe", "revenuecat", "polar"].includes(id)),
    );

    // The paywall's honest line: authored labels for the present rails only.
    expect(paymentsAvailable(registry)).toEqual(["Card — Stripe", "RevenueCat", "Card — Polar"]);
    // Absent rails produce no label at all.
    for (const absent of ["lemonsqueezy", "paypal", "square"] as const) {
      expect(registry.availableIds).not.toContain(absent);
      expect(PAYMENT_ORDER.includes(absent) && registry.availableIds.includes(absent)).toBe(false);
    }
  });

  it("purchase delegates to the present rail's checkout (hosted redirect opens and returns the session)", async () => {
    const keypair = await makeKeypair();
    const { registry, stripeOpenerCalls } = await buildMixedRegistry(keypair);

    const session = await registry.purchase("stripe", OFFERING);
    const expectedUrl = `${CHECKOUT_URL.stripe}?appUserId=${APP_USER}&offering=${OFFERING.id}`;
    expect(session).toEqual({ kind: "redirect", url: expectedUrl, offering: OFFERING });
    expect(stripeOpenerCalls).toEqual([expectedUrl]);
  });

  it("purchase on an absent or unavailable rail throws the typed rail-absent RegistryError", async () => {
    const keypair = await makeKeypair();
    const { registry } = await buildMixedRegistry(keypair);

    const unavailable = await registry.purchase("paypal", OFFERING).then(
      () => null,
      (error: unknown) => error,
    );
    expect(unavailable).toBeInstanceOf(RegistryError);
    expect((unavailable as RegistryError).reason).toBe("rail-absent");
    expect((unavailable as RegistryError).adapterId).toBe("paypal");

    // Never wired at all ⇒ the same typed absence.
    const lone = createAdapterRegistry({
      adapters: [hostedRail("stripe", keypair.publicKeyRaw, CHECKOUT_URL.stripe).adapter],
      redeemCode: async () => ({ outcome: "invalid" }),
    });
    await expect(lone.purchase("square", OFFERING)).rejects.toBeInstanceOf(RegistryError);
  });

  it("redeem delegates to the B.4 verifyCode wrapper and passes the outcome through", async () => {
    const keypair = await makeKeypair();
    const { registry } = await buildMixedRegistry(keypair);
    const signer = signerFor(keypair.privateKey);
    const keyId = await keyIdForPubkey(keypair.publicKeyRaw);

    const valid = await registry.redeem(
      await mintHashBased({ tier: "unlimited", exp: EXP }, signer, { keyId }),
    );
    expect(valid).toEqual({ outcome: "valid", tier: "unlimited", exp: EXP });

    const expired = await registry.redeem(
      await mintHashBased({ tier: "unlimited", exp: PAST_EXP }, signer, { keyId }),
    );
    expect(expired).toEqual({ outcome: "expired" });

    // Garbage input passes through as the honest invalid outcome.
    const invalid = await registry.redeem("NOT-A-CODE");
    expect(invalid).toEqual({ outcome: "invalid" });
  });
});
