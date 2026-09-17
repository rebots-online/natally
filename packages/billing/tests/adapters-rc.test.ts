import { describe, expect, it, vi } from "vitest";
import { createRevenueCatAdapter, type RevenueCatSdk } from "../src/adapters/revenuecat.js";
import type { BridgeTransport } from "../src/bridge-client.js";

function fakeSdk(overrides: Partial<RevenueCatSdk> = {}): RevenueCatSdk {
  return {
    presentPaywall: vi.fn(async () => undefined),
    hasEntitlement: vi.fn(async () => true),
    activePurchaseId: vi.fn(async () => "rc-purchase-1"),
    restore: vi.fn(async () => undefined),
    ...overrides,
  };
}

function transport(mintStatus = 200) {
  const posts: { path: string; body: unknown }[] = [];
  const t: BridgeTransport = {
    post: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body });
      return {
        status: mintStatus,
        json: async () => (mintStatus === 200 ? { token: "minted-token" } : { error: "denied" }),
      };
    }),
  };
  return { t, posts };
}

const offering = { id: "natally_default", priceString: "$48", tier: "unlimited" } as const;

describe("RevenueCat adapter (B.5b)", () => {
  it("paywall → entitlement → /mint → token: checkout mints when the sheet leaves an active entitlement", async () => {
    const sdk = fakeSdk();
    const { t, posts } = transport();
    const adapter = createRevenueCatAdapter({ sdk, transport: t, appUserId: "user-1" });
    const session = await adapter.checkout({ ...offering });
    expect(session.kind).toBe("rc");
    expect(sdk.presentPaywall).toHaveBeenCalledWith("natally_default");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      path: "/mint",
      body: { appUserId: "user-1", purchaseRef: "rc-purchase-1" },
    });
  });

  it("checkout without an active entitlement mints nothing (no invented tokens)", async () => {
    const sdk = fakeSdk({ hasEntitlement: vi.fn(async () => false) });
    const { t, posts } = transport();
    const adapter = createRevenueCatAdapter({ sdk, transport: t, appUserId: "user-1" });
    await adapter.checkout({ ...offering });
    expect(posts).toHaveLength(0);
  });

  it("restore: RC restore + entitlement → minted token", async () => {
    const sdk = fakeSdk();
    const { t } = transport();
    const adapter = createRevenueCatAdapter({ sdk, transport: t, appUserId: "user-1" });
    await expect(adapter.restore("user-1")).resolves.toBe("minted-token");
    expect(sdk.restore).toHaveBeenCalledWith("user-1");
  });

  it("restore without entitlement or purchase id returns null, never throws", async () => {
    const noEntitlement = fakeSdk({ hasEntitlement: vi.fn(async () => false) });
    const a = createRevenueCatAdapter({
      sdk: noEntitlement,
      transport: transport().t,
      appUserId: "u",
    });
    await expect(a.restore("u")).resolves.toBeNull();

    const noPurchase = fakeSdk({ activePurchaseId: vi.fn(async () => null) });
    const b = createRevenueCatAdapter({
      sdk: noPurchase,
      transport: transport().t,
      appUserId: "u",
    });
    await expect(b.restore("u")).resolves.toBeNull();
  });

  it("a failed /mint surfaces the error (never a fabricated token)", async () => {
    const sdk = fakeSdk();
    const { t } = transport(403);
    const adapter = createRevenueCatAdapter({ sdk, transport: t, appUserId: "user-1" });
    await expect(adapter.restore("user-1")).rejects.toThrow(/\/mint failed \(403\)/);
  });

  it("availability is presence-of-SDK truth (the web key is configured at build)", async () => {
    const adapter = createRevenueCatAdapter({
      sdk: fakeSdk(),
      transport: transport().t,
      appUserId: "u",
    });
    expect(adapter.available()).toBe(true);
  });
});
