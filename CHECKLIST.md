# natally — implementation checklist — v3

Regenerated **de novo 2026-09-17** from `DOCS/ARCHITECTURE.md` v3 (the §13 public-HF
rewrite + §19 shared storage + §20 Windows packaging + §21 offers/$ROCHE/language law).
Predecessor preserved: `CHECKLIST.md.bak.20260917_091435.pre-v3`. Marker discipline (SC2):
`✅` only from observed runs with evidence citations. Every task's **Spec** cites its
architecture section.

**Census at generation: 41 ✅ / 4 [X] / 40 [ ].**

## Execution protocol

Unchanged: atomic, idempotent, order-independent (⛓ integrators excepted); disjoint
Owns; Verify + Accept observe durable end-state; commit+push per line; no mocks.

---

## Phase T — Scaffolding & contracts

- ✅ **T0.1–T0.10** — all scaffold/contract tasks complete with observed runs (evidence
  in v2 predecessor and commit lineage `e5e6926…77d0dd8`).

## Phase P — Ephemeris

- ✅ **P.1, P.2, P.4** — conformance, solar rules, chart builder; P.4 observed
  end-to-end in-browser (real natal chart from intake, `77d0dd8`).
- [X] **P.3 Worker/off-thread host** — web worker green; native transport awaits I.2.

## Phase L — Lore

- ✅ **L.1–L.5** — store, embedder, extraction, retrieval (kNN∪2-hop, `61dc3a3`),
  write-every-turn pipeline (flush-once-per-turn, `61dc3a3`).

## Phase B — Billing & licensing

- ✅ **B.1, B.2** — trial gate (119 tests), reading ledger + consume.
- ✅ **B.3** — token verify + storage (web + Rust written; keychain via I.2).
- ✅ **B.4** — codes (NATALLY- Crockford, 4 outcomes exact, `ca0fef0`).
- ✅ **B.5a** — hosted-redirect adapter + bridge client + SSRF guards (`c1ceef3`).
- ✅ **B.5b** — RevenueCat adapter (SDK injected, `aba35cc`).
- [X] **B.5c Adapter registry** — files written (300/300 tests incl. 5 new), final gate
  interrupted; **Verify:** `pnpm vitest run packages/billing/tests/registry.test.ts` ·
  **Accept:** `registry: frozen-order availability, hides absent rails, purchase dispatch,
  redeem via B.4, duplicate-registration error`.
- [ ] **B.6 License bridge service** — axum, 6 webhooks, mint/verify, deny-list (§9.4).
  **Owns:** `services/license-bridge/**`.

## Phase C / V / U / M / X / G / S / I / R — as in v2 with these amendments:

- ✅ **C.1–C.4, V.2, U.1, U.2, U.4, M.1, X.1, G.1, S.1, I.1, R.1–R.4, R.6** — all
  evidence-cited in the v2 predecessor and commit lineage.
- [ ] **V.1 Kokoro native (Rust)** — §10 native leg. **Owns:** `src-tauri/src/voice/`.
- [ ] **U.3 Plates + Atlas screens** — 3D torus wheel, hover callouts (§18.1 wiring law).
- [ ] **U.5 Settings** — 6 sections. **Owns:** `screens/settings/`.
- [ ] **U.6 Paywall + checkout** — 13 frames + **§21.1/§21.2 approved copy and language
  law** (no tech terms; exact strings from the offer table).
- [ ] **U.7 About + glossary-callout** — AGPL line, provenance, hover-term callouts.
- [ ] **U.8 Splash** — typewriter (D21), real engine-load progress.
- [ ] **U.9 Stage (sprite MascotRenderer)** — §18.2 law: porthole, docked-open, sprite
  idle cycle, animated Asleep, reduced-motion. **Owns:** `ui/stage.tsx`, sprite assets.
- [ ] **X.2 Delete-everything** — private data + claim release per §19.5 (never shared
  bytes another app needs). **Owns:** `data/destroy.ts`.
- [ ] **I.2 Tauri command registry** — mounts P.3/L.1/B.3/C.1-native/M.1-native.
- [ ] **I.3 Capability layer** — single selection point.
- [ ] **I.4 Full workspace gate** — check.sh green at 2 workers [X]; budget assert owed.
- [ ] **R.5 build-all + release flow** — single `release.lock` stamp (CC14).
- [ ] **R.7 Dormant CI + guards** — workflows + license-lint.

## NEW: Model sourcing (§13 public HF contract)

- [ ] **MS.1 Build-time manifest** — committed JSON catalogue with absolute URLs +
  sha256 pins for all six assets (Qwen3.5-2B, LFM2.5, Kokoro q8 + tokenizer + af_heart,
  MiniLM). **Owns:** `apps/local/src/mirror/catalogue.json` + `scripts/gen-manifest.mjs`.
  **Verify:** `node scripts/gen-manifest.mjs --check` · **Accept:** `manifest: 6 assets,
  all absolute huggingface.co URLs, sha256 pins present`.
- [ ] **MS.2 Manifest loader update** — parse the baked catalogue (not a fetch);
  MirrorNetwork origin-allowlist test for `huggingface.co`. **Owns:**
  `apps/local/src/mirror/manifest.ts` update. **Verify:** `pnpm vitest run
  apps/local/src/mirror` · **Accept:** `manifest: baked JSON parsed, multi-repo absolute
  URLs resolve, non-huggingface.co origin rejected`.

## NEW: Shared storage (§19)

- [ ] **SS.1 Scope config generator** — `scripts/generate-storage-config.mjs` →
  `config/asset-storage.generated.json`; Vite + Cargo consume; `cargo:rerun-if-changed`.
  **Owns:** the script, the generated file, `apps/local/src/storage/build-config.ts`,
  `src-tauri/src/storage_config.rs`. **Verify:** `node scripts/generate-storage-config.mjs
  production && cargo check --manifest-path apps/local/src-tauri/Cargo.toml` ·
  **Accept:** `scope config: generated once, consumed by both targets, schema validated`.
- [ ] **SS.2 Content-identity store types** — ContentIdentity, CatalogueAlias,
  AccessLocator, UsageClaim/Lease; the `SharedAssets` interface + `Lookup` union.
  **Owns:** `packages/billing/src/storage-types.ts` (or a new `packages/storage/`).
  **Verify:** `pnpm vitest run packages/billing/tests/storage-types.test.ts` ·
  **Accept:** `storage types: roundtrip, lease lifecycle, Lookup union exhaustive`.
- [ ] **SS.3 Resolve-existing-first resolver** — `resolveExistingFirst(scope, asset,
  store, signal)` with scope+digest locking and single-writer semantics.
  **Owns:** `packages/billing/src/storage-resolver.ts`. **Verify:** `pnpm vitest run
  packages/billing/tests/storage-resolver.test.ts` · **Accept:** `resolver: lookup-first,
  lock-recheck, single-writer publish, concurrent callers share one object`.
- [ ] **SS.4 Browser adapter** — same-origin OPFS/Cache Storage shared library under
  the storage scope; Web Locks API for scope+digest coordination.
  **Owns:** `apps/local/src/storage/web.ts`. **Verify:** `pnpm vitest run
  apps/local/src/storage` · **Accept:** `web adapter: cross-tab reuse zero-network,
  partial-object recovery, quota handling`.
- [ ] **SS.5 Linux adapter** — `$XDG_DATA_HOME/<scope>` root; file locks; atomic rename.
  **Owns:** `apps/local/src-tauri/src/storage/linux.rs`. **Verify:** `cargo test` ·
  **Accept:** `linux adapter: shared root resolved, digest lock, verified publish`.
- [ ] **SS.6 Windows adapter** — `FOLDERID_Profile` + `Shared AI Assets/<scope>/`;
  `LockFileEx`; discovery/migration from LocalAppData. **Owns:**
  `apps/local/src-tauri/src/storage/windows.rs`. **Verify:** `cargo test` (Windows CI) ·
  **Accept:** `windows adapter: profile root, known-folder resolution, prior-download
  discovery, atomic publish`.
- [ ] **SS.7 Android adapter** — SAF tree grant + persisted URI permissions;
  `BlobStoreManager` for immutable blobs; ContentResolver descriptor semantics.
  **Owns:** `apps/local/src-tauri/gen/android/...` (Kotlin glue) + Rust bridge.
  **Verify:** on-device test · **Accept:** `android adapter: SAF grant persisted,
  blob identity shared, zero-network cross-app reuse`.
- [ ] **SS.8 Downloader integration** — MirrorDownloader consults the resolver before
  network; catalogue removal → release-of-claim. **Owns:** `apps/local/src/mirror/
  download.ts` + `catalogue.ts` updates. **Verify:** `pnpm vitest run
  apps/local/src/mirror` · **Accept:** `downloader: shared hit = zero network bytes,
  absence = download, removal = claim released`.

## NEW: Windows packaging (§20)

- [ ] **WP.1 Partner Center identity** — reserve and persist Store identity values;
  packaging contract file. **Owns:** `config/windows-store-identity.json` +
  documentation. **Verify:** identity file present and validated · **Accept:** `identity:
  STORE_IDENTITY_NAME, STORE_PUBLISHER, UpgradeCode committed and referenced`.
- [ ] **WP.2 AppxManifest generator** — XML template + generator with escaping,
  unresolved-token rejection. **Owns:** `scripts/gen-appx-manifest.mjs` +
  `config/appx-template.xml`. **Verify:** `node scripts/gen-appx-manifest.mjs --check` ·
  **Accept:** `appx manifest: generates valid XML, all tokens resolved, runFullTrust
  declared`.
- [ ] **WP.3 Version ordinal mapping** — committed Windows release ordinal +
  `windowsPackageVersions(n)` generator; MSI/MSIX field limits enforced. **Owns:**
  `scripts/windows-version.mjs` + `config/windows-release-ordinal`. **Verify:**
  `node scripts/windows-version.mjs --check` · **Accept:** `windows versions: monotonic,
  field limits respected, ordinal persisted`.
- [ ] **WP.4 Build pipeline completion** — extend `scripts/build-windows.sh` to stage,
  MakeAppx pack/bundle, and sign on a Windows host. **Owns:** `scripts/build-windows.sh`
  update. **Verify:** Windows-host build run · **Accept:** `windows: msi + msix + bundle
  produced, signed, hashes recorded in release manifest`.
- [ ] **WP.5 Shared library bridge** — Windows storage adapter (SS.6) integration with
  the packaging; two-identity reuse test. **Owns:** integration test. **Verify:** on-
  device · **Accept:** `windows shared library: MSI + MSIX apps share one digest with
  zero network transfer`.

## NEW: Offers + ROCHE + language (§21)

- [ ] **OR.1 Offer catalog + copy** — the three offers with approved strings; catalog
  separation (lifetime/consumable/subscription); entitlement keys. **Owns:**
  `packages/billing/src/offers.ts` + copy JSON. **Verify:** `pnpm vitest run
  packages/billing/tests/offers.test.ts` · **Accept:** `offers: three paths, exact
  approved copy, catalog separation, depleted-balance-never-revokes-unlimited`.
- [ ] **OR.2 Customer language enforcement** — a test that scans all customer-facing
  copy for forbidden terms ("local", "inference", "ephemeris", model names, "token",
  "quantization", "API"). **Owns:** `packages/billing/tests/language-law.test.ts`.
  **Verify:** `pnpm vitest run packages/billing/tests/language-law.test.ts` ·
  **Accept:** `language law: zero forbidden terms in customer surfaces`.
- [ ] **OR.3 ROCHE currency contract** — integer units, authority split, fungibility
  matrix, grant/refund lifecycle table. **Owns:** `packages/billing/src/roche.ts`.
  **Verify:** `pnpm vitest run packages/billing/tests/roche.test.ts` · **Accept:**
  `roche: units, lifecycle events, fungibility rules, no-negative invariant`.
- [ ] **OR.4 Quote/reserve/settle state machine** — the server-side durable state
  machine with idempotency keys and reconciliation. **Owns:** server-side module in the
  bridge or hosted service. **Verify:** integration test · **Accept:** `spend: reserve-
  before-dispatch, settle-once, refund-on-failure, concurrent-safe, idempotent`.
- [ ] **OR.5 Microsoft Store adapter (schema amendment)** — add `'microsoft'` to
  `PurchaseAdapterId` (SC1 decision-entry); `StoreContext` adapter. **Owns:**
  `packages/billing/src/types.ts` amendment + `adapters/microsoft.ts`. **Verify:**
  `pnpm vitest run packages/billing/tests/adapters-microsoft.test.ts` · **Accept:**
  `microsoft adapter: StoreContext flow, backend validation, sync-once into RC`.

## Phase W3 — Screens from Stitch

- [ ] **W3-S2 Stitch v2 export** — frozen PNG refs + entity names verbatim + Pro tier.
  **Owns:** `LIBS/UI/STITCH-v2/`.
- [ ] **W3-People** — list/edit/remove + export-first nudge (J3). **Owns:**
  `screens/people/`.
- [ ] **W3-Screens (U.3, U.5–U.8)** — atlas wheel, settings, paywall/checkout (with
  §21 copy), about/glossary, splash. Wired from STITCH-v2 element names.

## Phase H — Hosted edition

- [ ] **H.1 Hosted scaffold** — `apps/hosted/` consuming the same UI source behind
  shared service interfaces. **Owns:** `apps/hosted/**`.
- [ ] **H.2 OpenRouter adapter** — free default + dynamic backoff + fallback list +
  training disclosure + `insufficient-credit` seam (§18.3). **Owns:**
  `apps/hosted/src/inference/openrouter.ts`.
- [ ] **H.3 Hosted voice/STT interfaces.**
- [ ] **H.4 Hosted billing** — $ROCHE metering via the quote/reserve/settle machine
  (OR.4); the `billing.consume` seam maps to ROCHE debits (not just x402).

## Phase W7 — Close-out

- [ ] **W7-1 TEST_RUBRIC gauntlet** + TC11 screencast.
- [ ] **W7-2 CC15 Milestone-1 provisional build** (single release.lock stamp).
- [ ] **W7-3 Registry & INC-9 write-backs.**
- [ ] **W7-4 On-device verification** (adb install, Windows-box run, AppImage run).

---

## Completion criteria

All `[ ]`/`[X]` resolved to ✅ with cited observed runs; I.4 normalized green; the
release.lock-unified stamped set in `dist/`; TEST_RUBRIC + CC15 screencast archived;
customer language law enforced (OR.2 green); shared-storage cross-app reuse demonstrated.
