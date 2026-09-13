# Implementation report — 2026-09-12 — v1.12.21175

This checkpoint extends the approved checklist implementation with persistent storage,
chart construction, trial accounting, companion grounding and tools, local content,
model-cache management, and the web packaging script. It follows source commit
`06567aad95984837a3153f12cf32264197664091` (v1.11.21140).

## Vendoring remains detached

The complete wrapper and Swiss Ephemeris source remain ordinary project files under
`VENDORED/sweph-wasm/`, including `swisseph/`. There is no nested Git repository,
submodule, gitlink, or upstream branch tracking. Provenance is recorded in the vendor
lock and import manifest. The local build downloader cannot fetch upstream `master`
or overwrite customizations. The runtime dependency resolves the local directory.
This work was already committed and pushed to Forgejo and GitHub in `06567aa`.

## Implemented work

| Task | Delivered behavior |
|---|---|
| T0.9 | Shared transactional SQLite migrations, nine application tables, migration ledger, and optional sqlite-vec table. |
| P.2 | Explicit unknown-time inputs without an invented birth time; whole-sign solar houses and directional house overlays. |
| P.3 | Worker transport that runs the actual local WASM engine; dedicated-thread Rust transport awaiting native mounting. |
| P.4 | Canonical input IDs, engine-aware cache keys, immutable validated chart facts, async worker support, and cross-chart aspects. |
| L.1 | SQLite lore adapters, OPFS with IndexedDB fallback, remembered backend selection, and native command implementation. |
| L.3 | Deterministic entity extraction, provenance edges, and same-kind cosine merging at 0.92. |
| B.1/B.2 | Count/time/rate trial evaluation, serialized gate-and-charge, idempotent readings, and compensating refunds projected out of gate rows. |
| C.2 | Immutable chart-fact context, numeric/sign/house checks, one regeneration, then honest absence; unchecked candidates remain private. |
| C.3 | Five companion tools, masked DOM reads, confirmed and revalidated writes, persisted tool turns, and lore ingestion callbacks. |
| C.4 | Typed companion bus and replayed mascot-state reduction driven by actual events and capability signals. |
| M.1 | Manifest validation, streamed hash verification, resumable downloads, browser cache publication, quota handling, and model catalogue selection. |
| G.1 | 35 labelled educational glossary entries and 107 attributed GeoNames cities with typed loaders. |
| S.1 | Six local font files with licenses and provenance, imported into the app stylesheet. |
| R.4 | Non-destructive web packaging script, PWA manifest, and service-worker static-cache policy. |

The independent foundation review also resulted in a standalone entry-point type
contract, a token test scoped to the actual `@theme` block, and fuller version-surface
checks. The chart builder now snapshots the caller's time-known flag before awaiting
engine work. Identical chart IDs no longer suppress legitimate cross-chart aspects.
The hidden glyph-definition sprite has an accessibility title.

Dependencies added for storage are pinned `wa-sqlite` 1.0.0 and `sqlite-vec` 0.1.9.
The centralized version stamp is `1.12.21175`, with Android versionCode `100012`.
Root `.env` remains ignored; public fork identity is derived from its configured values.

## Observed verification

- SQLite DDL: **21 tests passed**, including a real sqlite-vec extension, 384-dimensional
  insertion and nearest-neighbour query, and migration rollback behavior.
- Worker ephemeris host: **14 tests passed** with the real local WASM in worker threads.
- Chart facts: **11 tests passed**; local ephemeris conformance invariants: **24 passed**.
- Solar policy: **96 tests passed**; trial policy: **119 passed**; reading ledger: **28 passed**.
- Lore storage: **16 tests passed**; extraction: **30 passed**.
- Companion fact fence: **109 tests passed**; DOM tools: **79 passed**; event bus: **28 passed**.
- Model mirror: **37 tests passed**, including real Chrome CacheStorage and local HTTP
  transfers. Test fixtures do not substitute for a provisioned production model mirror.
- Content: **51 tests passed**. Font provenance, decoding and stylesheet checks passed.
- Web packaging and service worker: **48 tests passed**, including an unchanged filesystem
  after `--dry-run`. This is script verification; a production app build has not run yet.
- The full app TypeScript check and the lore/ephemeris package checks returned no diagnostics.
- The version check reported `consistent (1.12.21175; versionCode 100012)`.
- Independent review accepted T0.2, T0.4, R.6 and P.4 after the fixes above.

These are task-level observations, not an end-to-end rubric verdict. The ephemeris
checks establish local invariants, not independent external numerical conformance.

## Remaining integration and release work

P.3, L.1 and M.1 remain `[X]` in the checklist: their implemented components have been
exercised, while native command mounting and adapters still need integration. Native
ephemeris needs a real engine implementation; the Rust transport does not fabricate one.
Browser SQLite currently supports a compatible vector-enabled module factory; a stock
wa-sqlite build does not itself supply sqlite-vec. Native model storage needs its real
space and atomic-file adapters.

Inference, embedding, voice, remaining screens, licensing execution, app persistence,
capability wiring, native packaging and deployment continue under the remaining tasks.
The production mirror must satisfy the download policy: large Hugging Face resolve URLs
redirect, so serving an approved static mirror is still required. The current service
worker caches static assets; an offline fresh navigation is not yet a verified journey.

No public release artifacts, production deployment, or SHIP-READY verdict are claimed
by this checkpoint. Prior reports and vendored provenance remain preserved.
