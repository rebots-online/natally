// natally — M.1: platform cache-location seam + cache keys (ARCHITECTURE
// §13: assets live under the platform cache dir on native, in Cache Storage
// on the web). I.3 wires the real resolvers into the storage implementations.

/**
 * Resolves the platform cache root for mirror assets.
 *
 * - native: a Tauri command returning the app cache dir (e.g.
 *   `$XDG_CACHE_HOME/<app>/models` on Linux, the platform equivalent
 *   elsewhere) — resolved via the command, never hardcoded paths;
 * - web: the Cache Storage namespace name (the resolver returns the name;
 *   the Cache-Storage AssetStorage then opens `caches.open(name)`).
 */
export interface CacheDirResolver {
  resolve(): Promise<string>;
}

/** Constant resolver — tests and the standalone web build. */
export function staticCacheDir(dir: string): CacheDirResolver {
  return { resolve: () => Promise.resolve(dir) };
}

/**
 * Deterministic, filesystem- and cache-key-safe name for an asset id: every
 * run of characters outside `[A-Za-z0-9._-]` collapses to `_`; an empty id
 * maps to `_` so the key is never empty.
 */
export function cacheKey(assetId: string): string {
  const key = assetId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return key.length > 0 ? key : "_";
}

/** Full cache name for an asset: `<cache dir>/<cache key>`. */
export async function cacheName(resolver: CacheDirResolver, assetId: string): Promise<string> {
  return `${await resolver.resolve()}/${cacheKey(assetId)}`;
}
