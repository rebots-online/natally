# M.1 integration

The runtime entry points are `MirrorNetwork` / `fetchManifest` in `manifest.ts`,
`MirrorDownloader` in `download.ts`, `WebMirrorStorage` / `WebSpaceAdapter` in
`cache.ts`, and `CatalogueStore` in `catalogue.ts`. All constructors use explicit
dependencies. Importing these files does not fetch, open storage, or parse env.

```ts
const network = new MirrorNetwork(loadRuntimeConfig());
const manifest = await fetchManifest(network);
const storage = new WebMirrorStorage({
  cacheStorage: caches,
  locks: navigator.locks,
  origin: location.origin,
});
const downloader = new MirrorDownloader(network, storage, new WebSpaceAdapter());
const catalogue = new CatalogueStore(manifest, downloader);
await catalogue.refresh();
await catalogue.download(manifest.assets[0]!.id);
```

Use `CatalogueStore.subscribe` / `getSnapshot` for reactive consumption (including
`useSyncExternalStore`); snapshots and rows are frozen and references remain stable
between changes. `cancel(id)` preserves partial chunks. `remove(id)` interrupts a
local active transfer, awaits its settlement, then removes all cache versions for
that ID and its row. `refresh()` reconstructs rows from durable platform storage.
Absent assets remain in `manifest.assets` but have no installed/partial row.
`download` deduplicates concurrent calls for the same ID; platform locks also cover
different catalogue instances and web tabs.

Manifest data uses the existing T0.7 `ManifestAssetSchema` and `ModelManifestSchema`.
IDs, byte counts and SHA-256 values are required; duplicate IDs/files, unsafe
numeric sizes and URLs outside the mirror/bridge origins are rejected. Missing
`trialEligible` means false. B.1/U.5 must apply authorization using the manifest
flag or `catalogue.trialEligible(id)`; M.1 never grants entitlements.

## Platform dependencies

No additional npm dependencies are needed. The implementation uses the existing
`zod` contract plus browser APIs; SHA-256 is incremental with fixed-size working
state and is checked against Node crypto and known-answer vectors in tests.

Web requires a secure context, Cache Storage, Web Locks, fetch streams, and a usable
`navigator.storage.estimate()` result. Missing capacity is an error. Cache Storage
does not expose rename: chunks/checkpoints remain private until the verified
response is atomically published with `Cache.put`. A failed streamed put preserves
the previous entry. During publication, staging and final entries can coexist;
peak quota usage can approach twice the file size. The prescribed free-space gate
is the full asset size plus a rounded-up 10%, including on resume. A later browser
quota failure is surfaced, with the partial retained. Successful publication with
failed staging cleanup returns a `DownloadResult.cleanupError`; callers should
surface that condition and may retry cleanup under `storage.withLock`.

The mirror/bridge must serve assets directly: redirects are rejected, including
redirects to an otherwise allowed origin. Cross-origin deployments need CORS and
readable `Content-Range` / `Content-Encoding` response headers. Ranged responses
must use identity encoding and match the explicit manifest size. An ignored Range
request returning 200 restarts safely. Short 206 ranges continue until complete;
interrupted responses retain their persisted prefix, and bad digests discard it.
HTTP is accepted only on loopback for local fixture servers; runtime config owns
the production HTTPS requirement.

Native wiring is owned by the parent/platform task. Implement `MirrorStorage`
against real native cache-directory commands, including read/append/checkpoint,
atomic rename in `commit`, durable committed metadata, and complete ID removal.
`withLock` must serialize writes/removal for an ID across all active clients.
`SpaceAdapter.availableBytes()` must report actual free bytes on that cache
filesystem or throw. There is no fake native implementation or synthetic free-space
fallback here. M.1 does not own Rust command registration or root manifests.

## Verification

Run from the repository root with the installed tools:

```sh
node_modules/.bin/vitest run apps/local/src/mirror
node_modules/.bin/tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable --types node --strict --skipLibCheck apps/local/src/mirror/manifest.ts apps/local/src/mirror/cache.ts apps/local/src/mirror/download.ts apps/local/src/mirror/catalogue.ts apps/local/src/mirror/tests/browser.ts apps/local/src/mirror/tests/mirror.test.ts
```

The Vitest suite starts a loopback HTTP fixture server on an ephemeral port and
uses the installed Chrome binary through Node's WebSocket/CDP transport. Set
`MIRROR_TEST_CHROME` to an installed Chrome/Chromium executable when needed
(default `/usr/bin/google-chrome`). No browser package is downloaded. Test profiles
remain in ignored `tests/STAGING_chrome_*` directories for diagnosis. Vite serves
the owned modules using an isolated configuration and an owned scratch cache.

Observed native app integration and real native rename/free-space commands remain
the platform owner's verification responsibility.
