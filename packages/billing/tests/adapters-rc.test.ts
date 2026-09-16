// natally — B.5b RevenueCat adapter tests (TEST_RUBRIC TR-3/B.5b matrix:
// paywall → entitlement poll → bridge mint → real B.3 verify → token;
// honest absence on no-entitlement / mint-less bridge; available() gating on
// the SDK key; restore chain).
//
// No mocks in shipped code — the RC web SDK handle is an injected structural
// parameter and the tests inject a plain object implementing exactly that
// surface (tests may stub, src never does). Token verification on the happy
// path is the REAL B.3 `verifyToken` against a real WebCrypto Ed25519 keypair;
// the unverifiable path queues a token that genuinely fails verification.

import { describe, expect, it } from "vitest";
import { BridgeError, type TokenVerifier } from "../src/bridge-client";
import {
  DEFAULT_OFFERING_ID,
  RC_ENTITLEMENT_ID,
  RevenueCatAdapterError,
  createRevenueCatAdapter,
  type RevenueCatAdapterOptions,
  type RevenueCatCustomerInfo,
  type RevenueCatHandle,
} from "../src/adapters/revenuecat";
import { encodeToken } from "../src/token/format";
import { TOKEN_ISSUER, verifyToken } from "../src/token/verify-web";
import type { LicensePayload, LicenseToken, Offering, PurchaseAdapter } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APP_USER = "user-robin";
const SDK_KEY = "rc_web_sdk_key_test";
const PURCHASE_REF = "rc-purchase-0001";
const OFFERING: Offering = { id: "unlimited-lifetime", priceString: "$49", tier: "unlimited" };

const LOCKED: RevenueCatCustomerInfo = { entitlements: {} };
const UNLOCKED: RevenueCatCustomerInfo = {
  entitlements: { [RC_ENTITLEMENT_ID]: { latestPurchaseId: PURCHASE_REF } },
};

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

async function mintToken(
  keypair: TestKeypair,
  overrides: Partial<LicensePayload> = {},
): Promise<LicenseToken> {
  const payload: LicensePayload = {
    sub: APP_USER,
    tier: "unlimited",
    iat: 1_700_000_000,
    exp: null,
    iss: TOKEN_ISSUER,
    jti: "jti-b5b-0001",
    ...overrides,
  };
  return encodeToken(payload, async (signingInput) =>
    new Uint8Array(await crypto.subtle.sign("Ed25519", keypair.privateKey, signingInput)),
  );
}

/** Real B.3 verifier with only the baked key bound; appUserId flows per call. */
function verifierFor(publicKeyRaw: Uint8Array): TokenVerifier {
  return (token, appUserId) => verifyToken(token, { publicKey: publicKeyRaw, appUserId });
}

// ---------------------------------------------------------------------------
// Injected fake RC handle — a plain object over the structural surface
// ---------------------------------------------------------------------------

interface FakeRcCalls {
  readonly paywalls: string[];
  customerInfoAttempts: number;
  restores: number;
}

interface RcSchedule {
  /** Sequential getCustomerInfo results; the last one is sticky. */
  readonly poll?: readonly RevenueCatCustomerInfo[];
  /** The first N getCustomerInfo calls throw (SDK hiccup / offline). */
  readonly failFirstPolls?: number;
  /** restore() result; `undefined` ⇒ restore throws (offline). */
  readonly restored?: RevenueCatCustomerInfo;
}

function fakeRc(schedule: RcSchedule): { handle: RevenueCatHandle; readonly calls: FakeRcCalls } {
  const calls: FakeRcCalls = { paywalls: [], customerInfoAttempts: 0, restores: 0 };
  const snapshots = [...(schedule.poll ?? [])];
  const sticky: RevenueCatCustomerInfo = snapshots[snapshots.length - 1] ?? { entitlements: {} };
  const handle: RevenueCatHandle = {
    async presentPaywall(offeringId: string): Promise<unknown> {
      calls.paywalls.push(offeringId);
      return { rc: "paywall-result" };
    },
    async getCustomerInfo(): Promise<RevenueCatCustomerInfo> {
      calls.customerInfoAttempts += 1;
      if (
        schedule.failFirstPolls !== undefined &&
        calls.customerInfoAttempts <= schedule.failFirstPolls
      ) {
        throw new Error("test rc: customer info offline");
      }
      return snapshots.shift() ?? sticky;
    },
    async restore(): Promise<RevenueCatCustomerInfo> {
      calls.restores += 1;
      if (schedule.restored !== undefined) return schedule.restored;
      throw new Error("test rc: restore offline");
    },
  };
  return { handle, calls };
}

// ---------------------------------------------------------------------------
// Harness — adapter wired to the fake handle, a recording mint, the REAL B.3
// verifier, and a delivered-token recorder
// ---------------------------------------------------------------------------

interface Harness {
  readonly adapter: PurchaseAdapter;
  readonly calls: FakeRcCalls;
  readonly mintRefs: string[];
  readonly delivered: LicenseToken[];
  readonly keypair: TestKeypair;
  readonly mintTestToken: (overrides?: Partial<LicensePayload>) => Promise<LicenseToken>;
}

async function harness(
  schedule: RcSchedule,
  mint: (purchaseRef: string) => Promise<LicenseToken | null>,
  overrides: Partial<RevenueCatAdapterOptions> = {},
): Promise<Harness> {
  const keypair = await makeKeypair();
  const { handle, calls } = fakeRc(schedule);
  const mintRefs: string[] = [];
  const delivered: LicenseToken[] = [];
  const adapter = createRevenueCatAdapter({
    sdkKey: SDK_KEY,
    appUserId: APP_USER,
    purchases: handle,
    bridgeMint: async (purchaseRef) => {
      mintRefs.push(purchaseRef);
      return await mint(purchaseRef);
    },
    verifyToken: verifierFor(keypair.publicKeyRaw),
    onToken: (token) => {
      delivered.push(token);
    },
    entitlementPollIntervalMs: 1,
    entitlementPollCapMs: 60,
    ...overrides,
  });
  const mintTestToken = (mintOverrides: Partial<LicensePayload> = {}) =>
    mintToken(keypair, mintOverrides);
  return { adapter, calls, mintRefs, delivered, keypair, mintTestToken };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe("revenuecat adapter: paywall → entitlement → mint → token", () => {
  it("rc adapter: paywall→entitlement→mint→token flow OK", async () => {
    let mintedToken: LicenseToken | null = null;
    const h = await harness({ poll: [LOCKED, UNLOCKED] }, async () => mintedToken);
    mintedToken = await h.mintTestToken({ jti: "jti-b5b-0001" });

    const session = await h.adapter.checkout(OFFERING);

    // The session is the RC kind carrying the offering; the token is separate.
    expect(session.kind).toBe("rc");
    expect(session.offering).toBe(OFFERING);
    expect(session.url).toBeUndefined();
    // Paywall was presented with the default offering id…
    expect(h.calls.paywalls).toEqual([DEFAULT_OFFERING_ID]);
    // …then customer info was polled: the locked snapshot, then the entitlement.
    expect(h.calls.customerInfoAttempts).toBe(2);
    // The mint was requested with exactly the RC purchase id…
    expect(h.mintRefs).toEqual([PURCHASE_REF]);
    // …and the VERIFIED token was delivered exactly once.
    expect(h.delivered).toEqual([mintedToken]);
    expect(h.delivered).toHaveLength(1);
    const delivered = h.delivered[0] ?? "";
    await expect(
      verifyToken(delivered, { publicKey: h.keypair.publicKeyRaw, appUserId: APP_USER }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("no unlimited entitlement after the paywall ⇒ typed not-unlocked and no mint call", async () => {
    const h = await harness({ poll: [LOCKED] }, async () => null);

    const error = await h.adapter.checkout(OFFERING).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RevenueCatAdapterError);
    expect((error as RevenueCatAdapterError).reason).toBe("not-unlocked");
    // The paywall WAS presented; the absence is the entitlement's, honestly typed.
    expect(h.calls.paywalls).toEqual([DEFAULT_OFFERING_ID]);
    // No entitlement ⇒ the bridge was never asked to mint, nothing was delivered.
    expect(h.mintRefs).toEqual([]);
    expect(h.delivered).toEqual([]);
  });

  it("bridge cannot mint (null) though the entitlement exists ⇒ typed mint-failed, nothing delivered", async () => {
    const h = await harness({ poll: [UNLOCKED] }, async () => null);

    const error = await h.adapter.checkout(OFFERING).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RevenueCatAdapterError);
    expect((error as RevenueCatAdapterError).reason).toBe("mint-failed");
    // The mint WAS attempted with the purchase id; its absence is honest.
    expect(h.mintRefs).toEqual([PURCHASE_REF]);
    expect(h.delivered).toEqual([]);
  });

  it("an unverifiable minted token (foreign sub) is a typed BridgeError, never delivered", async () => {
    let mintedToken: LicenseToken | null = null;
    const h = await harness({ poll: [UNLOCKED] }, async () => mintedToken);
    // Genuinely unverifiable: signed for a different sub than the account.
    mintedToken = await h.mintTestToken({ sub: "user-someone-else", jti: "jti-b5b-0002" });

    const error = await h.adapter.checkout(OFFERING).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).reason).toBe("unverifiable");
    expect(h.mintRefs).toEqual([PURCHASE_REF]);
    expect(h.delivered).toEqual([]);
  });

  it("a failing customer-info snapshot (offline SDK) is tolerated until the entitlement appears", async () => {
    let mintedToken: LicenseToken | null = null;
    const h = await harness(
      { poll: [UNLOCKED], failFirstPolls: 1 },
      async () => mintedToken,
    );
    mintedToken = await h.mintTestToken({ jti: "jti-b5b-0003" });

    const session = await h.adapter.checkout(OFFERING);

    expect(session.kind).toBe("rc");
    expect(h.calls.customerInfoAttempts).toBe(2); // 1 throw + 1 unlock
    expect(h.delivered).toHaveLength(1);
  });

  it("the offering id flows to presentPaywall; the default is natally_default", async () => {
    const custom = await harness({}, async () => null, {
      offeringId: "unlimited_lifetime",
      entitlementPollCapMs: 20,
    });
    await custom.adapter.checkout(OFFERING).catch(() => null); // caps out — we only watch the paywall arg
    expect(custom.calls.paywalls).toEqual(["unlimited_lifetime"]);

    const defaulted = await harness({ poll: [LOCKED] }, async () => null, {
      entitlementPollCapMs: 20,
    });
    await defaulted.adapter.checkout(OFFERING).catch(() => null);
    expect(defaulted.calls.paywalls).toEqual([DEFAULT_OFFERING_ID]);
  });
});

describe("revenuecat adapter: restore chain and availability gating", () => {
  it("restore: entitlement → mint → verified token (real B.3 verify)", async () => {
    let mintedToken: LicenseToken | null = null;
    const h = await harness({ restored: UNLOCKED }, async () => mintedToken);
    mintedToken = await h.mintTestToken({ jti: "jti-b5b-0004" });

    await expect(h.adapter.restore(APP_USER)).resolves.toBe(mintedToken);
    expect(h.calls.restores).toBe(1);
    expect(h.mintRefs).toEqual([PURCHASE_REF]);
  });

  it("restore: honest absence — no entitlement, offline restore, mint-less bridge ⇒ null", async () => {
    const noEntitlement = await harness({ restored: LOCKED }, async () => null);
    await expect(noEntitlement.adapter.restore(APP_USER)).resolves.toBeNull();
    expect(noEntitlement.mintRefs).toEqual([]); // no mint call on absence

    const offline = await harness({}, async () => null); // fake restore() throws
    await expect(offline.adapter.restore(APP_USER)).resolves.toBeNull();

    const mintless = await harness({ restored: UNLOCKED }, async () => null);
    await expect(mintless.adapter.restore(APP_USER)).resolves.toBeNull();
  });

  it("restore: an unverifiable minted token is never returned — typed BridgeError", async () => {
    let mintedToken: LicenseToken | null = null;
    const h = await harness({ restored: UNLOCKED }, async () => mintedToken);
    mintedToken = await h.mintTestToken({ sub: "user-someone-else", jti: "jti-b5b-0005" });
    const wrongSub = await h.adapter.restore(APP_USER).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(wrongSub).toBeInstanceOf(BridgeError);
    expect((wrongSub as BridgeError).reason).toBe("unverifiable");

    mintedToken = "garbage" as LicenseToken; // genuinely malformed
    const malformed = await h.adapter.restore(APP_USER).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(malformed).toBeInstanceOf(BridgeError);
    expect((malformed as BridgeError).reason).toBe("unverifiable");
  });

  it("available() gates on the SDK key; checkout without it is typed not-configured, restore is honest null", async () => {
    const hidden = await harness({}, async () => null, { sdkKey: undefined });
    const blank = await harness({}, async () => null, { sdkKey: "" });
    expect(hidden.adapter.available()).toBe(false);
    expect(blank.adapter.available()).toBe(false);

    const error = await hidden.adapter.checkout(OFFERING).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RevenueCatAdapterError);
    expect((error as RevenueCatAdapterError).reason).toBe("not-configured");
    await expect(hidden.adapter.restore(APP_USER)).resolves.toBeNull();

    const shown = await harness({}, async () => null);
    expect(shown.adapter.available()).toBe(true);
  });
});
