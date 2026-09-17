/**
 * §19.3 resolve-existing-first resolver.
 *
 * Algorithm (DOCS/ARCHITECTURE.md §19.3 + §19.5):
 *   validate identity → lookup (shared providers first, then authorized
 *   legacy/private caches — the store abstraction owns ordering; the resolver
 *   calls it once before locking) → on `missing`, acquire the `scope:digest`
 *   lock and re-lookup inside the lock (single-writer: two apps arriving
 *   simultaneously produce one published object) → still missing → `acquire`
 *   and verify persisted bytes (full content: size + digest + compatible
 *   metadata) before treating the lease as ready.
 *
 * `needs-grant` / `unavailable` short-circuit: never start a download after a
 * denied/expired grant. A corrupt acquire is retried exactly once (re-download
 * path); a second corruption surfaces as `{ kind: "corrupt" }`.
 */
import {
  type Asset,
  assertNever,
  type ContentIdentity,
  ContentIdentitySchema,
  type Lease,
  type Lookup,
  type SharedAssets,
} from "./types.js";

/** Injected byte verification — platform hashing is another task's Owns (SS.8-adjacent). */
export type VerifyBytes = (lease: Lease, expected: ContentIdentity) => Promise<boolean>;

export type ResolveResult = Lease | Lookup;

/** Abort once the caller's signal has fired; checked before every store call. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("resolveExistingFirst aborted", "AbortError");
  }
}

/**
 * A lease is compatible with the expected identity only when it references the
 * same digest, is active, has not expired, and its persisted bytes verify
 * (full-content size + digest + metadata via the injected verifier).
 */
async function leaseIsCompatible(
  lease: Lease,
  identity: ContentIdentity,
  verifyBytes: VerifyBytes,
): Promise<boolean> {
  if (lease.digest !== identity.sha256) return false;
  if (lease.state !== "active") return false;
  if (lease.expiresAt !== undefined && lease.expiresAt <= Date.now()) return false;
  return verifyBytes(lease, identity);
}

/**
 * Resolve an asset existing-first. Returns the active read lease on success,
 * or the terminal Lookup outcome ({kind:"corrupt"|"needs-grant"|"unavailable"})
 * when resolution is not possible. Never throws for domain outcomes.
 */
export async function resolveExistingFirst(
  scope: string,
  asset: Asset,
  identity: ContentIdentity,
  store: SharedAssets,
  signal: AbortSignal,
  verifyBytes: VerifyBytes,
): Promise<ResolveResult> {
  // 1. Validate identity (SC1: closed, template-checked shapes).
  const parsed = ContentIdentitySchema.safeParse(identity);
  if (!parsed.success) {
    return { kind: "corrupt", reason: `invalid content identity: ${parsed.error.message}` };
  }
  if (asset.assetId.length === 0 || asset.revision.length === 0) {
    return { kind: "corrupt", reason: "invalid asset: empty assetId or revision" };
  }

  throwIfAborted(signal);

  // 2. Lookup-first, before any lock. The store orders shared providers before
  //    authorized legacy/private caches.
  const first = await store.lookup(asset, signal);
  if (first.kind === "ready") {
    if (await leaseIsCompatible(first.lease, identity, verifyBytes)) {
      return first.lease;
    }
    // Existing lease failed verification: fall through to the locked
    // re-acquire path below (the published object must be re-produced).
  } else if (first.kind === "needs-grant" || first.kind === "unavailable") {
    // Never start a download after a denied/expired grant.
    return first;
  }
  // `missing`, or a `ready` lease that failed verification, proceeds.

  throwIfAborted(signal);

  // 3. Single-writer: acquire the scope:digest lock and re-lookup inside it.
  const lockKey = `${scope}:${identity.sha256}`;
  return store.lock(lockKey, async (): Promise<ResolveResult> => {
    throwIfAborted(signal);
    const rechecked = await store.lookup(asset, signal);
    if (rechecked.kind === "ready") {
      if (await leaseIsCompatible(rechecked.lease, identity, verifyBytes)) {
        // Another writer published while we waited for the lock — share it.
        return rechecked.lease;
      }
      // Fall through to acquire: the published object is not compatible.
    } else if (rechecked.kind === "needs-grant" || rechecked.kind === "unavailable") {
      return rechecked;
    }

    // 4. Still missing (or incompatible): acquire and verify persisted bytes.
    //    One retry after a corrupt result (re-download path); a second
    //    corruption surfaces as {kind:"corrupt"}.
    const MAX_ACQUIRE_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      const lease = await store.acquire(asset, signal);
      if (await leaseIsCompatible(lease, identity, verifyBytes)) {
        return lease;
      }
      if (attempt === MAX_ACQUIRE_ATTEMPTS) {
        return {
          kind: "corrupt",
          reason: `persisted bytes for ${identity.sha256} failed verification after ${attempt} acquire attempt(s)`,
        };
      }
    }
    return assertNever(false as never, "acquire loop exhausted unreachable branch");
  });
}
