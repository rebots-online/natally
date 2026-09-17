import { describe, expect, it } from "vitest";
import { type ResolveResult, resolveExistingFirst, type VerifyBytes } from "../src/resolver.js";
import type { Asset, ContentIdentity, Lease, Lookup, SharedAssets } from "../src/types.js";

const scope = "natally-shared";
const digest = "ab".repeat(32);
const asset: Asset = { assetId: "kokoro-weights", revision: "r1" };
const identity: ContentIdentity = {
  sha256: digest,
  bytes: 1024,
  objectPath: `objects/sha256/ab/${digest}`,
};

function makeLease(): Lease {
  return {
    consumer: "test-consumer",
    digest,
    scope,
    acquiredAt: Date.now(),
    state: "active",
  };
}

/** In-memory SharedAssets with real mutex semantics on `lock` (serializes holders). */
class MockStore implements SharedAssets {
  lookupCalls = 0;
  lockCalls = 0;
  acquireCalls = 0;
  published: Lease | null = null;
  lookupResults: Lookup[] = [];

  private waiters: Array<() => void> = [];
  private locked = false;

  async lock<T>(_key: string, run: () => Promise<T>): Promise<T> {
    this.lockCalls += 1;
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    try {
      return await run();
    } finally {
      this.locked = false;
      const next = this.waiters.shift();
      if (next !== undefined) next();
    }
  }

  async lookup(_asset: Asset, _signal: AbortSignal): Promise<Lookup> {
    this.lookupCalls += 1;
    const scripted = this.lookupResults.shift();
    if (scripted !== undefined) return scripted;
    if (this.published !== null) return { kind: "ready", lease: this.published };
    return { kind: "missing" };
  }

  async acquire(_asset: Asset, _signal: AbortSignal): Promise<Lease> {
    this.acquireCalls += 1;
    const lease = makeLease();
    // Publication is atomic with acquire in this mock: one writer wins.
    if (this.published === null) this.published = lease;
    return lease;
  }
}

const okVerify: VerifyBytes = async () => true;
const failingVerify: VerifyBytes = async () => false;

function isLease(result: ResolveResult): result is Lease {
  return "digest" in result && !("kind" in result);
}

async function resolveAsset(
  store: SharedAssets,
  verify: VerifyBytes = okVerify,
): Promise<ResolveResult> {
  return resolveExistingFirst(scope, asset, identity, store, new AbortController().signal, verify);
}

describe("resolveExistingFirst", () => {
  it("lookup-first: returns the ready lease with no lock and no acquire", async () => {
    const store = new MockStore();
    const lease = makeLease();
    store.published = lease;
    const result = await resolveAsset(store);
    expect(isLease(result)).toBe(true);
    expect(result).toBe(lease);
    expect(store.lookupCalls).toBe(1);
    expect(store.lockCalls).toBe(0);
    expect(store.acquireCalls).toBe(0);
  });

  it("lock-recheck: missing asset locks once and re-lookups inside the lock", async () => {
    const store = new MockStore();
    const result = await resolveAsset(store);
    expect(isLease(result)).toBe(true);
    expect(store.lookupCalls).toBe(2); // once outside, once inside the lock
    expect(store.lockCalls).toBe(1);
    expect(store.acquireCalls).toBe(1);
  });

  it("single-writer: 10 concurrent resolvers on one missing asset produce exactly one acquire", async () => {
    const store = new MockStore();
    const results = await Promise.all(Array.from({ length: 10 }, () => resolveAsset(store)));
    expect(store.acquireCalls).toBe(1); // exactly ONE publish
    expect(store.lockCalls).toBeGreaterThanOrEqual(1);
    const leases = results.filter(isLease);
    expect(leases).toHaveLength(10);
    // Concurrent callers share the resulting lease.
    for (const lease of leases) {
      expect(lease).toBe(store.published);
    }
  });

  it("needs-grant short-circuits with zero lock and zero acquire calls", async () => {
    const store = new MockStore();
    store.lookupResults = [{ kind: "needs-grant", reason: "SAF grant denied" }];
    const result = await resolveAsset(store);
    expect(result).toEqual({ kind: "needs-grant", reason: "SAF grant denied" });
    expect(store.lockCalls).toBe(0);
    expect(store.acquireCalls).toBe(0);
    expect(store.lookupCalls).toBe(1);
  });

  it("unavailable short-circuits with zero lock and zero acquire calls", async () => {
    const store = new MockStore();
    store.lookupResults = [{ kind: "unavailable", reason: "provider offline" }];
    const result = await resolveAsset(store);
    expect(result).toEqual({ kind: "unavailable", reason: "provider offline" });
    expect(store.lockCalls).toBe(0);
    expect(store.acquireCalls).toBe(0);
  });

  it("corrupt acquire: one retry, second corruption surfaces as {kind:'corrupt'}", async () => {
    const store = new MockStore();
    const result = await resolveAsset(store, failingVerify);
    expect(result).toEqual({
      kind: "corrupt",
      reason: expect.stringContaining("failed verification after 2 acquire attempt(s)"),
    });
    expect(store.acquireCalls).toBe(2); // exactly one retry
    expect(store.lockCalls).toBe(1);
  });

  it("bytes-verify failure on a ready lease falls through to the locked path, then corrupt", async () => {
    const store = new MockStore();
    store.published = makeLease();
    const result = await resolveAsset(store, failingVerify);
    expect(result).toEqual({
      kind: "corrupt",
      reason: expect.stringContaining("failed verification"),
    });
    expect(store.acquireCalls).toBe(2);
  });

  it("invalid identity (digest/objectPath mismatch) is rejected without store calls", async () => {
    const store = new MockStore();
    const badIdentity: ContentIdentity = {
      sha256: digest,
      bytes: 1024,
      objectPath: `objects/sha256/cd/${digest}`, // shard must match digest prefix
    };
    const result = resolveExistingFirst(
      scope,
      asset,
      badIdentity,
      store,
      new AbortController().signal,
      okVerify,
    );
    expect(await result).toEqual({
      kind: "corrupt",
      reason: expect.stringContaining("invalid content identity"),
    });
    expect(store.lookupCalls).toBe(0);
    expect(store.lockCalls).toBe(0);
    expect(store.acquireCalls).toBe(0);
  });

  it("aborted signal short-circuits before any store call", async () => {
    const store = new MockStore();
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveExistingFirst(scope, asset, identity, store, controller.signal, okVerify),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.lookupCalls).toBe(0);
  });
});
