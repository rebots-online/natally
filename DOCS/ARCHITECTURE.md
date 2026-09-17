# natally — architecture (Gate 2 document 1 of 3)

Normative for the **local-app product** (Linux, Windows, Android, web PWA — all legs
local-inference) and for the monorepo seams the **hosted web-only SaaS** (Alby Market /
Bitcoin LN / x402, pay-per-reading) will occupy later (D10). Written 2026-09-04 against the
amended complement (D10–D14). Reconciled 2026-09-09 against the frozen complement, the
tree, and the vendored sweph-wasm surface; `CHECKLIST.md` was recreated from this edition
the same day. `DOCS/TEST_RUBRIC.md` (gate-2 sibling) follows separately; no `src/` is
written before all three exist and the complement is re-cleared (CLAUDE.md, I2, TC12, D3).

Reading order: `README.md` (what) → `DOCS/DECISIONS.md` (why; D1–D14 cited throughout) →
this file (how) → `LIBS/UI/FIGMA/DESIGN.md` + `TOKENS.md` + `STATE-LEDGER.json` (surfaces).
Everything here is production-complete: interfaces, entities, formats and algorithms are
specified to be implementable without inventing; where a choice is genuinely open it is
listed in §16, not papered over.

**Edition v3 — 2026-09-17.** §13 rewritten (public unauthenticated HF download), §19–§21
appended, §22 execution topology appended; §18 implementation amendment retained as
written. Per the Architecture Law (CLAUDE.md): this file is the **snapshot of the finished
product** — the program already exists, fully defined, in these sections. CHECKLIST.md is
the recipe that makes this snapshot real; nothing that is not in CHECKLIST.md may be coded;
nothing that is not in this file may exist in CHECKLIST.md. There is no separate workflow
or planning document — execution topology lives in §22.

## 1. System overview

natally is a person: a warm robotic fortune-teller who reads your sky aloud, in conversation
(D6). The app is her notebook: the transcript is the primary surface, charts arrive as
**plates** laid on the page, and each plate opens into the **Atlas** instrument view. The
product pillars:

1. **Ephemeris truth** — every degree comes from the engine; no fabricated angles (INC-19).
2. **Companion** — an on-device tool-using agent (llama.cpp; atomic chat-turboquant weights +
   KV compression, D13) speaking only from computed facts and remembered lore, gated by a
   three-tier prompt fence (§7). Very approachable voice and animated mascot, ultra
   relatable — the affective surface **is** the USP (D13).
3. **Lore** — a GraphRAG-type local memory recording every turn of every conversation,
   actively engaged by the companion; client-side on local storage in **both** product lines
   (D12).
4. **Voice** — Kokoro on every leg; native Rust synthesis+playback on installed platforms,
   onnxruntime-web in the browser; `speechSynthesis` never called (D7/D7a).
5. **Commerce** — unlicensed trial (operator-configured gate, one designated trial model) →
   paid unlock = unlimited; six processor rails from build config; individually-redeemable
   and hash-based codes (D11).

Two complementary product lines share this repo (D10; **D22/D23, 2026-09-13: both are
active workstreams built in parallel**): the **local app** sells an unlimited companion;
the **hosted web edition** (`apps/hosted`, stronger server-side inference/STT/TTS behind
the same shared interfaces) sells single readings over Bitcoin Lightning and standard web
rails. They share the design system, the exported UI source, the ephemeris seam, the lore
core, and the companion persona; they differ in inference lane (local models vs hosted
API — §7.1, §7.5) and billing model (`billing.consume`, §8.6).

## 2. Monorepo layout

```
apps/local/                 # Tauri 2 application — one codebase, four targets
  src/                      # React 19 frontend (see §3)
  src-tauri/                # Rust core (see §5–§7 host duties)
apps/hosted/                # D22/D23: hosted web/API edition — scaffold consumes the SAME
                            # exported UI source behind shared service interfaces.
VENDORED/sweph-wasm/        # Detached upstream wrapper + published runtime; source owned here
  swisseph/                 # Detached Swiss Ephemeris source at wrapper-pinned revision
packages/ephemeris/         # EphemerisEngine seam + local vendored sweph-wasm backend (§6)
packages/lore/              # Shared GraphRAG lore core, client-side storage (§8)
packages/billing/           # TrialPolicy, usage ledger, PurchaseAdapter, license verify (§9)
packages/design-tokens/     # Generated from LIBS/UI/FIGMA/TOKENS.md + STATE-LEDGER.json
services/license-bridge/    # Operator-hosted Rust service (webhooks, tokens, codes) (§9.4)
scripts/build-*.sh          # Per-target build entrypoints (§14)
dist/                       # Tracked; release binaries via git-LFS on forgejo (CC13)
```

Dependency rule: `apps/*` may import `packages/*`; `packages/*` never import `apps/*`;
`packages/lore` and `packages/billing` are platform-agnostic (browser + Tauri) so the hosted
product reuses them unchanged.

## 3. Normative stack

- **Shell:** Tauri 2 (identity `mba.robin.natally`); targets Linux (AppImage, deb), Windows 11
  (exe + NSIS cross-built on Linux via cargo-xwin; msi + msix on a Windows host — D8),
  Android (apk, aab), and a **web PWA** build of the same frontend (`dist/web` →
  `https://natally.robin.mba`), first-class with its own stamped artifact (R1 lineage).
- **Frontend:** Vite; React 19; TypeScript `strict`; Tailwind 4 with the `@theme` block in
  `src/styles/tokens.css` mirroring `TOKENS.md` **one-to-one** (variable → CSS custom
  property; law: no raw hex outside `tokens.css`); hash router with exactly the routes in
  `DESIGN.md` (`/`, `/atlas/:plate`, `/people`, `/people/:id`, `/settings`, `/paywall`,
  `/checkout`, `/about`); fonts self-hosted woff2 (Fraunces, Nunito Sans, IBM Plex Mono).
- **Native core (src-tauri):** Rust; hosts the ephemeris worker, llama.cpp bindings, Kokoro
  ONNX synthesis + playback, OS keychain access, and the SQLite stores. On the PWA leg every
  capability has a browser counterpart (Web Worker, wllama-style WASM inference,
  onnxruntime-web, WebCrypto + IndexedDB/OPFS) selected by a capability layer — never by
  `if (platform)` scattered through components.
- **No lockfile divergence:** one pnpm workspace root; `pnpm-lock.yaml` committed from day one.

## 4. Process & platform topology

- **Ephemeris** runs off the UI thread: Web Worker (web/PWA) / dedicated tokio task (native).
- **Companion inference** streams tokens through a typed event bus
  (`companion:event → stage(mascot) + transcript + voice`); the Stage's Thinking/Speaking
  states bind to real events on this bus (STATES.md law: no fake states).
- **Voice** pipeline: companion turn → sentence chunks → Kokoro synth (native Rust /
  onnxruntime-web) → playback (Rust audio / Web Audio) → RMS envelope → Stage speaking.
- **Lore writer** consumes the same event bus; reads never block a turn (§8.3).

## 5. Data & entities (INC-19 provenance table)

The mandated entity table. **Provenance** is one of the INC-19 classes: `computed` (engine
fact), `authored` (static education, labelled in UI), `generated` (companion transcript),
`absence` (honest absence state), `system` (never user-visible as content).

| Entity | Key fields | Provenance | Storage | Notes | Engaged by |
|---|---|---|---|---|---|
| Person | id, name, birth {date, time?, place, timeKnown} | system (input) | SQLite `people` | birth data is quasi-PII (§12) | W3-People · X.2 · U.4✓ |
| Session | id, personId, startedAt; persisted `sessions.historical_person_id` retains the personId after profile deletion | system | SQLite `sessions`; migration in `packages/lore/src/ddl.ts`, repository `apps/local/src/data/sessions.ts` | one conversation thread; nullable live FK plus historical ID, no extra application table | W3-People · X.2 · U.4✓ |
| Turn | id, sessionId, role (you/her/tool), text, ts | generated (her) / system (you) | SQLite `turns` | tool turns record DOM ops (§7.3) | C.1–C.4✓ · X.2 |
| Plate | id, sessionId, kind (natal/synastry/today), chartId | computed (rendered from ChartFacts) | derived, cached | in-transcript card | U.3 · P.4✓ |
| ChartFacts | id, personIds[], ut/place inputs, positions[], cusps[], aspects[] | computed | SQLite `charts` (content-addressed by input hash) | immutable; from EphemerisEngine only | U.3 · P.4✓ |
| GlossaryEntry | term, body, glyph | authored | bundled JSON (lib) | "What it is" labels | U.7 · U.3 |
| TrialPolicy | mode, params, trialModel | system (build-baked from `.env`) | embedded config | §9.1 | B.1✓ · U.5 · U.6 |
| Reading | id, ts, personId, chartId | system | SQLite `readings` (append-only) | §9.2 | B.2✓ · H.4 |
| LicenseToken | sub (appUserId), tier, iat, exp?, signature | system | OS keychain (native) / IndexedDB (web) | Ed25519 (§9.3) | B.3✓ · B.6 · U.5 |
| ConsumedCode | codeHash, redeemedAt | system | SQLite `consumed_codes` | single-use enforcement | B.4✓ · X.2 |
| Offering | id, priceString, tier, durationIso | system (runtime from RevenueCat/bridge) | memory | paywall display only | OR.1 · U.6 |
| LoreNode | id, kind, summary, embedding, refs[] | generated (derived) | SQLite+vec (§8) | D12 | X.2 · L.1–L.5✓ |
| LoreEdge | from, to, rel, weight, sourceTurnId | generated (derived) | SQLite | §8.2 | X.2 · L.1–L.5✓ |
| Lore itself (summaries) | — | generated | UI-labelled | never shown as computed fact | U.5 |
| StorageScope | scope string (build-baked, §19.1) | system | generated config | public identity; never a secret or entitlement | SS.1 · SS.4–SS.7 |
| ContentIdentity | sha256, bytes; object path | system | shared object store (§19.2) | immutable; scope selects the library | SS.2 · SS.3 |
| CatalogueAlias | assetId+revision → digest/format/quant/license | system | catalogue index (§19.2) | multiple aliases may share bytes | SS.2 · MS.1✓ |
| AccessLocator | native path / fd / URI / bookmark / browser handle | system | platform adapter (§19.4) | typed; never a bare path string | SS.2 · SS.4–SS.7 |
| UsageClaim (Lease) | consumer identity, read lease/pin | system | shared store (§19.5) | active-reader protection | SS.2 · SS.3 · X.2 |
| WindowsReleaseOrdinal | committed integer `n` | system | release metadata | monotonic MSI/MSIX version mapping (§20.4) | WP.3 · WP.4 |
| OfferCatalogEntry | offer copy, product IDs, entitlement key, currency code | authored (approved copy, §21.1) | RC/Store catalog | customer language law applies | OR.1 · U.6 |
| ServiceRateCard | service ID, input/output rates, minimum unit, max charge | system | server service catalog (§21.4) | versioned; margin rule applied once | OR.3 · OR.4 |
| ReservationJobRecord | account, request-id, state, quote, debit key | system | server durable store (§21.4) | unique (account, request-id) constraint | OR.4 · H.4 |
| GrantProvenance | purchase ref, grant key, paid period, restrictions | system | RC + server ledger (§21.6) | replay-safe; no double grants | OR.1 · OR.4 |
| Mascot | `Mascot({size?, className?, alt?})`; `apps/local/src/ui/mascot.tsx` | system (approved brand artwork) | bundled `src/assets/mascot/` | Shared animated brand image in TopBar, startup, unavailable-screen and error surfaces; reduced-motion selects frame zero. Separate from Stage's event-driven state. | U.9 · U.7 |
| ApplicationIcons | `scripts/generate-icons.sh`; `apps/local/src-tauri/icons/`; `apps/local/public/icons/` | system (approved brand artwork) | generated icon files, HTML links and PWA manifest | All sizes derive from `LIBS/UI/FIGMA/mascot/natally-icon-1024-rgba.png`; OS launchers and installers use static formats. | R.1–R.3✓ · W7-2 |
| LegalDocument | privacy policy + terms of use, closed section sets (§11.1) | authored (static legal text) | `apps/local/public/legal/privacy.html` + `terms.html` — single source, token-themed (§11.1 theming law); landing/order/web-app surfaces link, never copy | Must quote "birth data is quasi-PII (§12)" verbatim | LG.1 |

The provenance tag travels with the content into the prompt fence (§7.2) and the renderer
(Plex Mono for `computed`, Fraunces margin for `generated`, labelled sections for
`authored`, distinct absence treatment for `absence`). Export/import (J8) serializes all
user-owned entities (Person, Session, Turn, ChartFacts inputs, LoreNode, LoreEdge,
ConsumedCode) as one JSON document, versioned by `exportVersion`.

### 5.1 Symbol enumeration (functions, classes, interfaces, variables wired by CHECKLIST.md)

Law 8 companion to the entity table: every symbol a CHECKLIST task touches appears here
with its file and its **engaged-by** cells. Coder mode: when a task wires a symbol, it
annotates the cell with `<task-id>✓` — exactly this nomenclature, never a synonym — so
parallel agents converge. A symbol a task needs that is absent from this table is a
snapshot defect (§22: no blockers by recipe time).

| Symbol | Kind | File | Engaged by |
|---|---|---|---|
| `EphemerisEngine` (init/position/cusps/aspects/chiron) | interface | `packages/ephemeris` | P.1–P.4✓ · U.3 |
| `CompanionTool` (dom.read/dom.write/chart.open/chart.compute/lore.recall) | type union | §7.3 | C.1–C.4✓ |
| fence checker (Tier-1 match, 0.01° tolerance) | function | §7.2 | C.2✓ |
| `createConversationComposition` | function | `apps/local/src/composition.ts` | C.1✓ · I.3 · SS.8 |
| `LoreStore` (query/upsert/export/delete/stats) | interface | `packages/lore` | L.1–L.5✓ · X.2 · U.5 · W3-People |
| `importDocument` (merge `{merged, skipped, conflicts[]}`) | function | §8.4 | W3-People · X.2 |
| `Session` / `sessions.historical_person_id` | type + column | `packages/lore/src/types.ts` | W3-People · X.2 |
| `redeemCode` / `CodeOutcome` / `ConsumedCodeLedger` | function/types | `packages/billing/src/codes.ts` | B.4✓ · B.6 |
| `TrialPolicySchema` / `TrialPolicy` | schema/type | `packages/billing/src/types.ts` | B.1✓ · U.6 |
| `ReadingSchema` / `Reading` | schema/type | `packages/billing/src/types.ts` | B.2✓ · H.4 |
| `LicenseTokenSchema` / `LicenseTokenPayloadSchema` | schemas | `packages/billing/src/types.ts` | B.3✓ · B.6 |
| `DenyList` / `SignedDenyList` | types | `packages/billing/src/types.ts` | B.3✓ · B.6 |
| `verifyLicenseToken` / `TokenError` | functions | `packages/billing/src/token/` | B.3✓ · B.6 · U.5 |
| `DenyListManager` (start/stop/refresh/verify; 24 h cadence) | class | `packages/billing/src/token/verify-web.ts` | B.3✓ · B.6 |
| `WebTokenStorage` (store/load/clear/readDenyList/writeDenyList) | class | `packages/billing/src/token/storage-web.ts` | B.3✓ · X.2 |
| native token store (`store`/`verify`, keychain) | Rust | `packages/billing/src/token/native.rs` | I.2 · B.3✓ |
| `PurchaseAdapter` / `PurchaseAdapterId` / `CheckoutSession` / `Offering` | interface/types | `packages/billing/src/types.ts` | B.5a–B.5c✓ · OR.5 · U.6 |
| `AdapterRegistry` / `createAdapterRegistry` / `RegistryOptions` / `RegistryCodeDeps` / `FROZEN_ORDER` / `waysToPayLine` | interface/functions/const | `packages/billing/src/adapters/registry.ts` | B.5c✓ · OR.5 · U.6 |
| `ConsumeResultSchema` (`billing.consume` reasons) | schema | `packages/billing/src/types.ts` | H.2 · H.4 |
| `ManifestAssetSchema` / `ModelManifestSchema` (kinds llm/embedder/voice/voices) | schemas | `packages/billing/src/types.ts` | MS.1✓ · MS.2✓ · SS.2 |
| `MirrorNetwork` (resolve/fetch; origin allowlist) | class | `apps/local/src/mirror/manifest.ts` | MS.2✓ · SS.8 · V.1 |
| `parseManifest` / `loadBakedManifest` / `fetchManifest` | functions | `apps/local/src/mirror/manifest.ts` | MS.2✓ |
| `validateAsset` / `requiredSpace` | functions | `apps/local/src/mirror/manifest.ts` | MS.2✓ · SS.8 |
| `StreamingSha256` | class | `apps/local/src/mirror/download.ts` | SS.3 · SS.8 |
| `MirrorDownloader.download` (ranged resume, verify, commit) | method | `apps/local/src/mirror/download.ts` | SS.8 · V.1 · U.5 |
| `DownloadProgress` / `DownloadOptions` / `DownloadResult` / `InsufficientSpaceError` / `IntegrityError` | types | `apps/local/src/mirror/download.ts` | SS.8 · U.5 |
| `MirrorStorage` / `WebMirrorStorage` (isPresent/appendPartial/readPartial/commit/withLock) | interface+impl | `apps/local/src/mirror/cache.ts` | SS.4 · SS.8 |
| `CatalogueStore.remove` → release-of-claim | method | `apps/local/src/mirror/catalogue.ts` | SS.8 · X.2 |
| `loadRuntimeConfig` | function | `apps/local/src/config.ts` | SS.1 · I.3 |
| `SharedAssets` (lock/lookup/acquire) / `Lookup` union / `Lease` | interface/types | `packages/storage/src/types.ts` (SS.2) | SS.2 · SS.3 · SS.4–SS.7 |
| `resolveExistingFirst` | function | `packages/storage/src/resolver.ts` (SS.3) | SS.3 · SS.8 |
| storage platform adapters (web/linux.rs/windows.rs/android) | modules | `apps/local/src/storage/web.ts` · `src-tauri/src/storage/` | SS.4 · SS.5 · SS.6 · SS.7 · WP.5 |
| `StageSignal` union + envelope events (envelope-start/level/end) | type + events | `apps/local/src/ui/` (C.4✓) | V.1 · V.2✓ · U.9 · H.3 |
| `MascotRenderer` (sprite, pluggable) | component | `apps/local/src/ui/stage.tsx` | U.9 |
| `Mascot` | component | `apps/local/src/ui/mascot.tsx` | U.7 · U.9 |
| offers module (three offers, exact §21.1 copy) | module | `packages/billing/src/offers.ts` (OR.1) | OR.1 · U.6 |
| `roche` module (units 0..2×10⁹, fungibility matrix) | module | `packages/billing/src/roche.ts` (OR.3) | OR.3 · OR.4 · H.4 |
| quote/reserve/settle machine (states per §21.4) | module | server-side (OR.4) | OR.4 · H.4 |
| `scripts/gen-manifest.mjs` | script | repo root | MS.1✓ |
| `scripts/generate-storage-config.mjs` → `config/asset-storage.generated.json` | script+artifact | SS.1 | SS.1 |
| `scripts/gen-appx-manifest.mjs` + `config/appx-template.xml` | script+template | WP.2 | WP.2 · WP.4 |
| `scripts/windows-version.mjs` + `config/windows-release-ordinal` | script+data | WP.3 | WP.3 · WP.4 |
| `config/windows-store-identity.json` | artifact | WP.1 | WP.1 · WP.2 · WP.4 |
| `scripts/build-windows.sh` (host auto-detect) | script | §14 | WP.4 · R.2✓ |
| `scripts/build-all.sh` + `release.lock` + `scripts/update-version.sh` | scripts | §14 | R.5 · W7-2 |
| `scripts/check.sh` + bundle-budget assert | script | §12 | I.4 |
| Tauri command registry (`registry_generated.rs`) | module | `apps/local/src-tauri` | I.2 · V.1 · B.3✓ |
| capability layer (single selection point) | module | `apps/local/src/capabilities/` (I.3) | I.3 · I.2 |
| voice native (`src-tauri/src/voice/`) | module | §10 | V.1 · I.2 · W7-4 |
| hosted scaffold + OpenRouter adapter + hosted voice/STT + hosted billing | modules | `apps/hosted/` | H.1 · H.2 · H.3 · H.4 |
| `legal/privacy.html` + `legal/terms.html` (token-themed per §11.1) | documents (§11.1 closed section sets) | `apps/local/public/legal/` | LG.1 · U.7 · U.6 |

## 6. Ephemeris subsystem (D14)

Swiss Ephemeris via `sweph-wasm` is the pinned incumbent. The complete detached source
repositories and matching runtime are committed under root `VENDORED/sweph-wasm/`
(wrapper 2.6.9) and `VENDORED/sweph-wasm/swisseph/` (the wrapper-pinned C engine).
`packages/ephemeris` depends on `file:../../VENDORED/sweph-wasm`; there are no nested
Git repositories, active submodules, or upstream-tracking remotes. Local modifications
are owned by natally. Origins and revisions are attribution in
`VENDORED/sweph-wasm.UPSTREAM-VENDOR.lock.json`; the former source downloader now reads
local files only. `DOCS/sdk/sweph-wasm/` remains a documentation snapshot, not the
vendor source tree. All call sites go through the seam:

```ts
interface EphemerisEngine {
  readonly id: string;                       // 'sweph-wasm'
  init(cfg: EngineConfig): Promise<void>;    // loads ephemeris tables (lazy, §13)
  position(body: Body, ut: JulianDay): { lon: number; lat: number; speed: number };
  cusps(ut: JulianDay, place: GeoPlace, system: HouseSystem): { cusps: number[12]; asc: number; mc: number; armc: number };
  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[]; // + applying/separating from speeds
  chiron?(ut: JulianDay): Position;          // backend capability flag
}
```

- Backend package `packages/ephemeris` ships the seam + `sweph-wasm` implementation; a future
  successor (Astrodienst-licensed native build, `astronomy-engine` + in-house house math, or
  the operator's in-house engine) registers behind the same interface with a conformance
  suite (fixed-star and planet positions vs DE431 references at 0.01° tolerance; house cusps
  vs published examples for all 12 systems).
- **House systems (closed set, 12 — SC1):** Placidus `P`, Koch `K`, Porphyry `O`,
  Regiomontanus `R`, Campanus `C`, Equal (Asc) `A`, Vehlow Equal `V`, Whole Sign `W`,
  Topocentric (Polich/Page) `T`, Meridian (axial rotation) `X`, Alcabitius `B`,
  Krusinski-Pisa-Goelzer `U`. Each maps 1:1 to a `HouseSystems` code of `sweph-wasm@2.6.9`
  (vendored snapshot `DOCS/sdk/sweph-wasm/index.d.ts`, type at line 2423; local docs per
  TC7). The engine domain is wider (25 codes); adding a 13th chip is a decision-entry
  event, never a silent append.
- **Honest absence rules:** birth time unknown ⇒ solar chart (Sun on the 1st-house cusp by
  sign), no Ascendant, no houses anywhere that person appears (J1/J3/J4 branches); backend
  without Chiron ⇒ glyph shows absence, never an estimate.
- **AGPL posture:** while `sweph-wasm` is in the dependency tree the product is
  AGPL-3.0-or-later and source is offered accordingly; the D9 proprietary flip happens only
  when a successor engine lands (license-lint in CI: fail if any `sweph` import exists while
  `package.json.license ≠ AGPL-3.0-or-later`, or vice versa any proprietary claim).

## 7. Companion subsystem (D13)

### 7.1 Inference lane
On-device only for this product: llama.cpp (native) / WASM (PWA), configured for **atomic
chat-turboquant**: quantized weights (Q4_K_M default catalogue tier) **and** KV-cache
compression (q8_0 KV default, q4r8 recursor tier when the device allows), streamed token by
token. Models download from **public unauthenticated HuggingFace repositories** (§13); no
upload, no mirroring, no write token. The catalogue flags exactly one model
`trialEligible` (D11).

### 7.2 Three-tier prompt fence (normative)
The companion's context is assembled in exactly three tiers, each tagged with provenance:

1. **Tier 1 — computed facts.** Serialized `ChartFacts` for every plate in scope (positions,
   cusps, orbs, applying/separating) plus glossary definitions for terms used. Immutable;
   injected as system context. *Rule: every astrological number she utters must exist here.*
2. **Tier 2 — lore.** Hybrid retrieval over the lore graph (§8.3): vector kNN over LoreNodes
   + 2-hop graph expansion, person-scoped, each fragment carrying `sourceTurnId`. *Rule:
   memory informs continuity, never new astrological claims.*
3. **Tier 3 — the live turn.** The user's utterance and in-flight tool results.

A post-generation **fence checker** validates the output: any degree/orb/date in her reply
is parsed and matched against Tier 1 values (tolerance 0.01°; house/sign names must be
consistent); violations trigger one regeneration with the violation quoted, then honest
absence ("I only say what your chart says"). The persona system prompt fixes her voice:
warm, approachable, ultra-relatable, never clinical (D13).

### 7.3 Tool suite (standard full DOM read/write)
```ts
type CompanionTool =
  | { tool: 'dom.read';   selector: string; depth?: number }          // → masked snapshot
  | { tool: 'dom.write';  ops: DomWriteOp[] }                         // setattr|text|class|focus|scroll
  | { tool: 'chart.open'; plateId: string }
  | { tool: 'chart.compute'; query: ComputeQuery };                   // → EphemerisEngine (Tier 1)
  | { tool: 'lore.recall'; query: string; personId?: string };
```
- `dom.read` returns an accessibility-tree-style snapshot; input values, keychain-backed
  fields and license material are masked at the bridge, never serialized.
- `dom.write` applies to the app's own WebView DOM (native legs) or page DOM (PWA); every
  invocation is recorded as a `Turn(role=tool)` in the transcript and lore — **no hidden
  writes**; writes that mutate user data require the same confirm affordance as UI actions.
- Tools have **no network access**; the only egress from the companion is the inference
  pipeline itself, which is local.

### 7.4 Gating
Companion turns that ground on a plate (readings, §9.2) pass through the trial gate; free
chat that reads no chart is ungated (she remains conversational in trial — the gate is on
readings, not on her existence).

## 8. Lore subsystem (D12, shared by both products)

### 8.1 Storage
Client-side, local-only in both product lines: SQLite everywhere — `rusqlite` behind Tauri
on native, `wa-sqlite` on OPFS in the browser — with the **sqlite-vec** extension for
embeddings (`VITE_LORE_EMBED_DIM`, default 384, from a mirror-hosted embedding model). No
server, ever; in the hosted SaaS the only egress is retrieval context sent to its hosted
inference API (documented in that product's pass).

### 8.2 Graph model
- `LoreNode(id, kind: person|fact|event|thread|place, summary, embedding, refs[])`
- `LoreEdge(from, to, rel: mentions|relates|follows|contradicts, weight, sourceTurnId)`

### 8.3 Pipeline
Every turn (you and her, both roles) is embedded and appended (`write-every-turn`). Node
extraction v1 is deterministic: proper nouns, dates, places, and thread labels recognized by
rule + gazetteer from the glossary; the companion may also emit structured `lore.recall`
hits as extraction hints. Merging: candidate node with cosine similarity ≥ 0.92 to an
existing node of the same kind merges (edges accumulate `weight`). Retrieval (Tier 2) is
hybrid: top-k vector matches (k=8) ∪ 2-hop neighbourhood of matched nodes, budgeted to
1,500 tokens, person-scoped unless the query is explicitly general.

### 8.4 Boundaries
`LoreStore` is an interface (`query`, `upsert`, `export`, `delete`, `stats`) so the later
**pysanky / 6dog** graph-navigation UI reads the same graph without re-architecting. User
controls (Settings › Data): summary line (`[turns · nodes]`, rendered from `stats()` →
`{turns, nodes, edges}`), export with J8, delete-everything includes lore. Deletion is real deletion (rows + vectors), not soft-hide.
**Person removal** (People edit flow) is real deletion of the person, their `kind=person`
lore node and every edge incident to it, and their cached charts (§5 content-addressed
rows); their sessions and turns persist as transcript history — the transcript is the
primary surface and is never rewritten. The action runs behind the standard confirm
affordance.
**Import conflicts:** `importDocument` merges by personId and lore nodeId; when an incoming
person's id matches but birth data diverges, the **existing person wins** — incoming birth
fields are ignored and the divergence is surfaced once in the import report
`{merged, skipped, conflicts[]}`. Nothing is silently overwritten and nothing is deleted
by import.

## 9. Licensing & entitlement (D11)

### 9.1 Trial policy
Baked at build from `.env` (§15): `VITE_TRIAL_MODE = count | time | rate` with
`VITE_TRIAL_READINGS` (default 3), `VITE_TRIAL_DAYS`, `VITE_TRIAL_RATE_COOLDOWN_DAYS`
(default 3), and `VITE_TRIAL_MODEL` (exactly one catalogue id). Trial users may download and
run **only** the designated trial model; other catalogue rows render the lock and route to
`/paywall` (J6 amended).

### 9.2 The reading unit & usage ledger
A **reading** is consumed when the companion produces her first Tier-1-grounded turn of a
conversation that references at least one plate. Ledger: SQLite `readings(id, ts, personId,
chartId)` append-only (house never-delete rule; corrections are compensating rows). Gate
check runs pre-inference; outcomes map to the designed states: remaining counter (TrialIdle
chip), exhausted (TrialExhausted composer replacement), rate-limited next-date aside.
**Charge lifecycle:** when a turn is requested with a plate in scope, the ledger appends a
Reading row at request time (that is the charge — append-only, §5); if the fence checker
(§7.2) finds the produced turns reference **zero** Tier-1 values, a compensating credit row
is appended (house never-delete rule) — the reading is refunded, not deleted. Turns whose
request carries no plate context are never charged (§7.4 free chat). The pre-inference
gate is a prediction over committed rows; the ledger owns charge and refund.

### 9.3 License token
Ed25519-signed JSON `{ sub: appUserId, tier: 'unlimited', iat, exp?: null, iss:
'natally-license-bridge', jti }` (COSE/CWT-style compact form). The **public key is baked at
build**; verification is offline; revocation is a bridge-published, signed, dated deny-list
checked when online (never blocks a verified unexpired token offline). **Deny-list
cadence:** fetched at app start, before any checkout/restore, and at most every 24 h
thereafter; cached locally. **Storage:** OS keychain (native) / IndexedDB with
WebCrypto-wrapped value (web); where no OS keychain exists, the wrapped value lives in an
encrypted app-data file and About states so — never plaintext.

### 9.4 Processor rails & the license bridge
One interface, six adapters, presence driven by `.env` (blank ⇒ rail hidden; the paywall's
"Ways to pay" line is the honest availability readout):

```ts
interface PurchaseAdapter {
  id: 'stripe' | 'revenuecat' | 'polar' | 'lemonsqueezy' | 'paypal' | 'square';
  available(): boolean;
  checkout(offering: Offering): Promise<CheckoutSession>;  // hosted URL | store sheet | RC paywall
  restore(account: AppUserId): Promise<LicenseToken | null>;
}
```

- **Android:** Google Play Billing via RevenueCat (native SDK keys live in the mobile build
  config); paywall = RC offering presentation.
- **Web/PWA:** RevenueCat web SDK (`VITE_REVENUECAT_WEB_SDK_KEY`) or any hosted-checkout
  redirect (Stripe/Polar/LemonSqueezy/PayPal/Square) — the `/checkout` handoff frame.
- **Desktop:** hosted-redirect checkout + QR + manual license-key path
  (`/checkout` `enter-license-key`), key format `NATALLY-XXXX-XXXX-XXXX`.
- The **license bridge** (`services/license-bridge`, operator-hosted Rust/axum, clean-room
  sibling of the Kintsugi pattern) receives processor webhooks (HMAC-verified, idempotent
  SQLite ledger keyed `(processor, invoiceId)`), mints LicenseTokens with
  `LICENSE_ED25519_PRIVATE_KEY`, issues single-use redeem codes (128-bit random, stored
  SHA-256-hashed), publishes the signed deny-list, and exposes `POST /redeem` +
  `POST /verify`. **Refund/chargeback events that identify a fulfilled purchase revoke the
  minted jti onto the signed deny-list** — the deny-list is the only revocation path, and
  clients enforce at the next online check (§9.3 cadence). Secrets live in the bridge's
  `.env` per Admin-Manual convention; **no processor secret and no signing key ever ships
  in a client**.

### 9.5 Codes
- **Individually-redeemable:** bridge-issued, single-use, registry-deduped server-side and
  locally via `consumed_codes`.
- **Hash-based:** offline-verifiable — payload `{tier, exp}` + Ed25519 signature, base32
  encoded in the `NATALLY-…` shape; validity check needs no network; single-use enforced by
  the local consumed-code ledger (re-use shows the code-error variant with the real reason).

### 9.6 `billing.consume` seam (reserved)
```ts
billing.consume(reading: Reading): Promise<{ allowed: boolean; reason?: 'trial-exhausted' | 'rate-limited' | 'unlicensed' | 'insufficient-credit' }>
```
In the local product this consults only the local state (§9.1–§9.3). The hosted product
(D10, R2) implements the same seam as a per-reading debit over Lightning/x402 rails — the
interface is frozen now so that edition never re-architects (R2's clause).

## 10. Voice subsystem (D7/D7a) and the Stage

Operator correction (2026-09-13): the approved mascot is the application icon and
animated brand image throughout surfaces that support animation. `Mascot` reuses the
approved idle WebP with the original still for reduced motion; it does not emit or
imply companion state. `Stage` continues to reflect actual companion events. Native
launcher, installer, PWA-install and browser-tab icons use generated static mascot
images, all derived from the same approved 1024-pixel source.

Kokoro on every leg. Native: ONNX runtime in Rust, synthesis and playback fully native,
voices from the mirror (`manifest.json` shared with the LLM catalogue); Web:
onnxruntime-web (WASM, WebGPU where present) with PCM through Web Audio. `speechSynthesis`
is banned on all legs (CI grep guard). The Stage consumes real events only (STATES.md):
Thinking when a companion request is sent (no tokens yet — STATES.md's trigger), Speaking
while PCM plays with the RMS envelope driving orb+mouth, Delighted on chart computed /
unlock success, Error on engine failure. Asleep, waking and listening are driven by
capability signals (model presence, engine/model load progress, composer focus), not by
bus events; the Stage reducer consumes a `StageSignal` union — companion bus events ∪
capability signals — defined by task C.4. **Envelope semantics:** CompanionEvent
`envelope` is three-valued — `envelope-start`, `envelope-level(0..1)` per 20 ms window,
`envelope-end` (raised on stream close or after a 120 ms silence threshold). `Speaking`
spans `envelope-start` → `envelope-end`; `Idle` resumes at `envelope-end`.

## 11. Privacy & security posture

- Birth data + lore + turns are **local-only** in this product; no telemetry, no analytics,
  no crash reporter. Network egress is exactly: model-mirror downloads (§13) and the
  license/checkout calls (§9). 
- Network layer: https-only; host allowlist = mirror host + `VITE_LICENSE_BRIDGE_URL` +
  processor checkout hosts; **SSRF guards** (reject loopback/private/reserved hosts on any
  runtime-resolved URL); webhook-style responses verified by signature, never trusted by
  body alone.
- Secrets: `.env` gitignored, fed from `~/Admin-Manual/CREDENTIALS/natally.md`; keychain for
  tokens; CI greps for `hf_`/`sk-`/private-key patterns.
- Exported data (J8) is plaintext JSON by design (user-owned); the UI says so.

### 11.1 Legal documents (privacy policy + terms of use) — single source, SC3

`apps/local/public/legal/privacy.html` and `apps/local/public/legal/terms.html` are the one
authored source for every customer-facing surface that requires them: the web app
(About + first-run + checkout links), the landing page, the order/checkout pages, and the
website. Generated/embedded surfaces link here; no copies. **Theming law:** both pages are
standalone HTML styled only with the frozen token vocabulary (`LIBS/UI/FIGMA/TOKENS.md`):
the colour/shape/spacing custom properties (`--color-midnight` … `--color-z-<sign>`,
`--radius-*`, `--spacing-*`, `--stroke-hairline`), the type ramp (Fraunces titles,
Nunito Sans body, IBM Plex Mono for the effective-date stamp; 12 px floor), dark ground
`midnight` with `vellum` text, plates on `midnight/2` at `radius/plate` with hairline
strokes, `gilt` reserved for the single primary mark, `moonlight` links — no raw values
outside the mirrored `:root` block, which carries the TOKENS.md provenance comment and is
regenerated when tokens change (SC3 derived surface). **Placement contract (closed set of
consuming surfaces):** (a) the web app — About screen, first-run, and `/checkout` link
`/legal/privacy.html` + `/legal/terms.html`; (b) the website and the landing page
(`VITE_LANDING_URL` host) link the **canonical URLs**
`https://natally.robin.mba/legal/privacy.html` and `…/legal/terms.html` — link only,
never copies (SC3); (c) **RevenueCat paywalls** — the RC dashboard's required Privacy
Policy URL and Terms of Service URL fields (paywall presentation, Android and web legs)
are set to the same canonical URLs; (d) order/checkout pages link both beside every
purchase action. The canonical URL pair is configuration truth recorded once here — any
new surface (e.g. the hosted edition) consumes the same pair.

**Privacy policy — closed section set:** summary; operator identity; data inventory
(Person — name, birth date, birth time-or-unknown, birth place + tzid, with the
classification **"birth data is quasi-PII (§12)"** quoted verbatim; Session/Turn records
including tool-action turns; ChartFacts; lore nodes/edges/embeddings; readings ledger;
consumed codes; license token + deny-list cache in wrapped browser storage); storage
location (device browser storage — IndexedDB/OPFS + service-worker caches); the exact
network egress allowlist (public unauthenticated Hugging Face model downloads; license
bridge + chosen payment processor); no telemetry/analytics/crash-reporting/tracking
cookies; payment processors (the six rails, as available) and what we receive (signed
license confirmation + purchase reference, never card data); deny-list fetch cadence
(app start, before checkout/restore, ≤ 24 h); voice synthesis in-browser; $ROCHE handling
(platform-held balance, reserve-then-settle, depletion never revokes Unlimited); user
rights (J8 export of all user-owned entities; delete-everything = real deletion rows +
vectors; per-person removal semantics §8.4 — person + lore + cached charts gone,
transcripts persist until full delete; shared model bytes are not personal data);
third-party birth data (synastry partners — attested consent); minors; append-only
ledger retention with compensating rows; changes + contact.

**Terms of use — closed section set:** acceptance; service description (every
astrological value computed by the vendored Swiss Ephemeris engine; provenance labels per
INC-19 — computed facts, authored-static education, generated companion transcripts,
honest absence; educational/entertainment purpose; no professional advice); license grant
and the **"Unlimited chats with natally"** perpetual local-use entitlement + trial policy
(§9.1 count/time/rate, one trial model); $ROCHE terms (§21: integer units, consumable,
fungibility matrix, no cash-out, reserve-before-dispatch/settle-once/refund-on-failure,
depleted balance never revokes Unlimited, lifetime never relabelled as subscription);
single-use codes (`NATALLY-` format); acceptable use (no entitlement bypass, no abuse of
public download endpoints, third-party model licenses acknowledged — Qwen/Kokoro/MiniLM
files under their upstream licenses); third-party services (Hugging Face, payment
processors — their terms govern their leg); open-source posture (AGPL-3.0-or-later while
sweph-wasm is in-tree; written source offer on request); data ownership per the privacy
policy; disclaimers + no warranty; liability cap (amounts paid in the preceding 12
months); changes; dispute path (contact first; operator's principal place of business).

## 12. Performance mandates (acceptance criteria)

- Initial JS ≤ 300 KB gz; ephemeris WASM + tables, llama runtime, Kokoro weights: **lazy,
  on-demand, sha256-verified, cached** — none may be in the initial bundle.
- Ephemeris and inference never block the UI thread (§4); first plate ≤ 150 ms after tables
  warm on desktop-class hardware.
- Mascot idle loop plays only while visible; composed states are overlays (STATES.md);
  reduced-motion freezes frame 0 (a11y floor).
- Lore writes are async batched (≤ 1 flush per turn); retrieval budgeted (§8.3).

## 13. Public model download contract (operator 2026-09-17: no mirroring, no upload)

Model weights download **directly from public unauthenticated HuggingFace repositories**.
No `RobinsAIWorld/natally-models` repo exists or is needed; no HF write token exists or is
needed; nothing is ever uploaded to HuggingFace on natally's behalf.

**Source catalogue (frozen; adding a source is a decision-entry event):**

| Asset | Kind | HF repo | File | Quant |
|---|---|---|---|---|
| Qwen3.5-2B (LLM default) | llm | `unsloth/Qwen3.5-2B-GGUF` | `Qwen3.5-2B-Q4_K_M.gguf` | Q4_K_M |
| Kokoro-82M (voice) | voice | `onnx-community/Kokoro-82M-v1.0-ONNX` | `onnx/model_q8.onnx` | q8 |
| Kokoro tokenizer | voice | `onnx-community/Kokoro-82M-v1.0-ONNX` | `tokenizer.json` | — |
| Kokoro af_heart voice | voices | `onnx-community/Kokoro-82M-v1.0-ONNX` | `voices/af_heart.bin` | — |
| all-MiniLM-L6-v2 (embedder) | embedder | `gpustack/all-MiniLM-L6-v2-GGUF` | `all-minilm-l6-v2-q8_0.gguf` | q8_0 |

**Manifest:** baked into the app at build time (committed JSON, not fetched from a server).
The catalogue for this stage is exactly these five assets — **Qwen3.5-2B is the
default**. LFM2.5 is neither forbidden nor specified: it is not the default and is out of
scope at this stage (revisit is a decision-entry event, SC1).
Each asset carries: `{ id, kind: 'llm'|'embedder'|'voice'|'voices', file: <absolute URL>,
bytes, sha256, quant?, trialEligible? }`. The `file` field is an **absolute HTTPS URL** to
the public HF `resolve/main` path (e.g., `https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/
resolve/main/Qwen3.5-2B-Q4_K_M.gguf`). `MirrorNetwork.resolve()` accepts absolute `file`
strings when their origin shares the configured base origin (`huggingface.co`), so
multi-repo downloads need no code change — only manifest rows with absolute URLs.

`VITE_MODEL_MIRROR_BASE` remains `https://huggingface.co` (the shared origin for the
allowlist check). Downloads: ranged + resumable, sha256-verified before commit, stored per
the shared-storage contract (§19). A **free-space precondition** (asset size + 10%) is
checked before each download starts. Catalogue rows in Settings render from this manifest;
removal releases claims per §19 (never deletes shared bytes another app needs).

## 14. Build, release, versioning

- `scripts/build-linux.sh` (AppImage, deb) · `build-windows.sh` **auto-detects the host**
  (on Linux: exe+NSIS via cargo-xwin; when run on Windows: native .exe and .msi at that
  time, msix per §20 — D8) · `build-android.sh` (apk, aab) · `build-web.sh`
  (PWA → `dist/web`) · `build-all.sh` honors `release.lock` (single-flight; post-build bump
  via `update-version.sh --post-build`).
- Artifacts: `mba.robin.natally-v<MAJOR.MINOR.BUILD>-<qualifier>` in tracked `dist/`,
  binaries via git-LFS on forgejo (CC13; GitHub mirror stays code-only until then).
- Commits prefixed `v{VERSION}: `; CI dormant until public release (CLAUDE.md) — when it
  wakes: typecheck, lint, unit + conformance suites, license-lint (§6), the
  `speechSynthesis` grep, and bundle-budget asserts.

## 15. Configuration surface (`.env`, see `.env.example`)

Fork identity is configured in the root `.env` only: `VITE_APP_NAME` (display name),
`VITE_APP_ID` (reverse-DNS namespace), `VITE_APP_SLUG` (release filename prefix),
`VITE_APP_URL` (web app URL), and `VITE_LANDING_URL` (download/landing page).
`NATALLY_DEV_PORT` selects the local development port. `.env.example` is the default
copy template. The config loader, Vite entry, version stamper, native manifests, release
scripts and nginx provisioning consume these variables; generated manifests are derived
surfaces, never separate sources of configuration. Internal workspace package names may
remain stable across forks; product identity and displayed labels come from `.env`.

Build-baked client values: model source base (`huggingface.co`), storage scope (§19), app URL,
trial policy block, six processor values + bridge URL, RevenueCat offering id, lore flags,
and `VITE_LICENSE_PUBKEY` (offline license verify, §9.3). Script/server-only: the bridge's
`LICENSE_ED25519_PRIVATE_KEY`, processor webhook secrets, code registry (bridge host only,
Admin-Manual convention). Nothing in `apps/local` reads a secret at
runtime.

## 16. Open items register

1. Figma visual re-clearance of the 2026-09-04 complement additions → re-freeze — **ruled
   not a CODE blocker (D19, 2026-09-11)**; opportunistic. Still owed at re-freeze:
   re-verifying the Stage component's five variant node-ids (`DESIGN.md`'s Stage row and
   `STATE-LEDGER.json` disagree on 7:3, 7:5, 7:16; STATE-LEDGER is canonical for code).
2. `DOCS/TEST_RUBRIC.md` (final gate-2 sibling; `CHECKLIST.md` was recreated 2026-09-09
   from this reconciled edition).
3. ~~HF write token for the mirror~~ **resolved 2026-09-17: no mirror, no upload, no
   write token — public HF download per §13.**
4. forgejo return → push `origin` with LFS; decide the GitHub artifact channel (R1 needs a
   downloadable web build before forgejo returns).
5. Hosted-product design pass (Alby Market/x402 rails, OpenRouter admin-key provisioning
   with `.env` spend ratio, business panel) — separate conversation, seams already frozen
   (§1, §9.6).
6. Embedding model selection for lore (mirror catalogue entry + dimension pin).
7. Ephemeris successor watch (D14 keeps the seam; conformance suite specified §6).
8. Wider `DOCS/sdk/` snapshots (RevenueCat SDK, ort/onnxruntime-web, llama-cpp-2/wllama,
   processor webhook schemes) are vendored at the start of their owning tasks (TC7);
   sweph-wasm is vendored now (`DOCS/sdk/sweph-wasm/`, 2.6.9, sha256-stamped).

## 17. Traceability appendix

| Section | Decisions | Screens / journeys | Complement artifacts |
|---|---|---|---|
| §1 overview | D4, D5, D6, D10, D13 | all | DESIGN.md |
| §5 entities | INC-19 | all | SCREEN.md ×13 |
| §6 ephemeris | D9, D14 | atlas ×3, plates | DESIGN.md, STATE-LEDGER |
| §7 companion | D13 | conversation ×9 variants (incl. Desktop + 3 trial) | mascot/STATES.md |
| §8 lore | D12 | settings (Data/Lore) | screenshot-license.png |
| §9 licensing | D11, R2 | paywall ×7, checkout ×6, conversation trial ×3 | SCREEN.md (paywall, checkout), J10, J11 |
| §10 voice/stage | D7, D7a | conversation, settings (Voice) | STATES.md |
| §11 privacy/security | §11.1 legal documents | about, paywall, checkout, landing, order pages | privacy.md + terms.md |
| §13 model download | operator 2026-09-17 | settings (Model) | public HF catalogue |
| §14 build | D8, CC13 | — | scripts/update-version.sh |
| §19 shared storage | strategy §13-15 | settings (Data/Storage) | strategy doc |
| §20 Windows packaging | strategy §19 | — | scripts/build-windows.sh |
| §21 offers + ROCHE | strategy §20-21 | paywall, checkout, settings (License) | strategy doc |
| §22 execution topology | Architecture Law (CLAUDE.md) | — | CHECKLIST order-independence |
## 18. Implementation amendment (v2, 2026-09-17 — D20–D23 + observed build reality)

This section amends the sections it cites; it never overrides D-entries. Evidence rule:
every "[observed]" below traces to a command run or in-browser verification recorded in
commit messages `e5e6926…77d0dd8` (2026-09-16/17 implement session).

### 18.1 UI source of record (D20; amends §3)
- The frozen Figma complement is now **visual reference only** (paid account expired;
  no element-level content ever left Figma). The elements-class source of record is the
  **Google Stitch export**: `LIBS/UI/STITCH/` (2026-09-14, 25 folders, `code.html` per
  real screen). A **Stitch v2 pass** (frozen PNGs as references + checklist entity names
  verbatim + Pro-tier model) lands additively as `LIBS/UI/STITCH-v2/` and demotes v1 to
  wiring reference (TC5).
- **Wiring law:** screens wire from `code.html` element names/labels verbatim
  (TopBar, Composer, PlateCard, TurnHer/TurnYou, shell, stage, wheel vocabulary).
- **Input law (operator 2026-09-16):** every date entry is a structured, auto-expanded
  date picker; free-text dates are forbidden. The fence's ambiguous-date absence is an
  output-side backstop only.

### 18.2 Mascot / Stage (D5, D7, D13; amends §10)
- **Porthole law:** natally is present on EVERY screen — bottom-right circular
  ship-window portal on non-conversation surfaces, and the conversation docked OPEN by
  default (a continuous warm channel, never a cold collapsed bubble).
- **Sprite MascotRenderer** (pluggable): real-footage idle core (the operator's
  natally-idle loop) + authored sprite states + gold-hairline silhouette placeholders.
  NO AI-generated character art. Idle cycle: lounging atop the composer (arms-up
  sprawl), standing behind the gold circle (itself a natal-chart wheel), tending the
  crystal ball, phone doom-scroll/texting, attention gestures (portal shake, bang on
  glass, frantic wave), **time-of-day mirroring** (dawn yawn/teeth/groggy coffee),
  cursor-grab/ride (desktop) and finger-pounce (touch) when idle. **All characters
  animate where supported** — including Asleep: droopy eye movement, sleep twitches,
  occasionally almost dropping then hugging the crystal ball. States drive only from
  StageSignal (STATES.md law).
- **Voice-on-by-default:** every companion turn is read aloud (V.2); each of her
  bubbles carries a small speaker icon to replay. [observed: Kokoro q8 in-browser,
  envelope events → Stage Speaking]

### 18.3 Companion catalogue — Atomic Bots (operator 2026-09-16; amends §7.1)
- Local default: **Qwen3.5-2B Q4_K_M** (`trialEligible`). 2B is the smallest
  reasonable companion tier (DOM access + tool calling + lore decisions); Qwen3.5-0.8B
  is below the floor (debug row only). Offered catalogue additionally lists
  **LFM2.5-2.6B GGUF** (not the default; out of scope at this stage — operator
  2026-09-17) and
  **Bonsai-27B / Ternary-Bonsai-27B 1-bit GGUF** (smart tier; slow load; offered only
  where GPU-fit is verified — Android precondition). Compressed weight tiers
  `UD-Q3_K_XL` / `IQ4_XS` (llama.cpp-standard); KV `q4r8` still engine-gated (D16).
- **Hosted inference default (operator 2026-09-14): OpenRouter free**
  (`openrouter/free` + config-level fallback list) with rate-limit-aware **dynamic
  backoff**; free access is trial-limited; plain disclosure that free endpoints train
  on prompts; `insufficient-credit` stays the reserved seam (§8.6). [web lane
  observed end-to-end on-device via wllama: `e5e6926…77d0dd8`]

### 18.4 Model sourcing (amends §13; supersedes the former "mirror" model)
- **Public HF download** (operator 2026-09-17): absolute URLs to public repos; manifest
  baked at build time with sha256 pins; `MirrorNetwork` base stays on `huggingface.co`
  so multi-repo absolute `file` URLs pass the origin allowlist. No upload, no write
  token, no `RobinsAIWorld/natally-models` repo. Local dev mirror (localhost) still
  available via `.env.development.local` for offline development. [the in-browser
  download→wake flow was observed end-to-end during the session]

### 18.5 Build reality (amends §14)
- R.1/R.2/R.3 scripts authored and productive [observed]: linux AppImage+deb
  (v1.21.27237), windows exe+NSIS via cargo-xwin (v1.24.27313; absolute-path cargo
  shim required — a bare `cargo` in a PATH shim recurses), android apk+aab aarch64
  (v1.26.27331, versionCode 100026; RUST_MIN_STACK=16MB + capped jobs after rustc
  thin-LTO SIGSEGV under 4-ABI parallel). `build-windows.sh` auto-detects the host —
  native .exe and .msi build when it runs on Windows (D8).
- **R.5/CC14 owed:** per-platform stamps must be unified under `release.lock` at the
  release handback; Android defaults to single-ABI (aarch64) until a bigger-RAM host.

### 18.6 Persistence & intake (amends §5, §8)
- U.4 [observed]: intake (structured date picker, time-or-unknown, gazetteer place with
  tzid) → Person/Session/Turn/Chart rows via X.1 SQLite (OPFS; memory fallback when
  unavailable, honestly) → P.4 ChartFacts from the in-browser Swiss Ephemeris
  (self-hosted `/vendor/sweph` semiset) → plate + computed greeting; reload restores
  chart+plate+turns. Fence Tier-1 carries the real ChartFacts (§7.2).

### 18.7 Open items register (supersedes §16)
1. ~~HF write token reissue~~ **resolved: public HF download, no token needed (§13).**
2. Stitch v2 pass → W3 screens (atlas wheel + 3D torus, people, settings, about+glossary
   callouts with hover explanations, paywall, checkout, splash).
3. Hosted edition scaffold + OpenRouter adapter (§18.3) + $ROCHE seam (§21).
4. I.4 full gate + TEST_RUBRIC gauntlet + TC11 screencast + CC15 Milestone-1 build
   (single release.lock stamp across platforms).
5. On-device behavioral verification of the native artifacts (adb/emulator + Windows box).
6. Forgejo return → drain the LFS push queue.
7. Stage node-id verification re-pointed at the frozen complement + Stitch (Figma gone).

## 19. Shared storage / reusable asset contract (strategy doc §13-15)

The intended benefit: **one download of an identical multi-GB asset, reused by every
authorized ecosystem app on that device** (EnZIME ZIMs, natally models, shared voices —
the strongest USP). Sharing is by **content identity** (SHA-256 of exact bytes), never by
product name, developer account, or download URL.

### 19.1 Build-time scope configuration

- `VITE_STORAGE_SCOPE` (e.g., `shared-content-v1`) — a public value selected at build
  time; independent of `mba.robin`, package IDs, storefront identity, branding.
- Generated by `scripts/generate-storage-config.mjs` → `config/asset-storage.generated.json`
  (consumed by both Vite and Cargo via `include_str!`); generation runs under
  `release.lock`; scope is a frozen constant, never a Settings switch.
- Scope change = storage migration (retain old discovery aliases until assets are
  accounted for). Validation: `^[a-z0-9][a-z0-9_-]{2,63}$`.

### 19.2 Content-identity object store

| Record | Contents |
|---|---|
| Content identity | SHA-256 of exact bytes + expected byte count; immutable object path `objects/sha256/<ab>/<full-digest>`; scope selects the library, not the hash |
| Logical catalogue alias | Asset ID + immutable revision → digest, format, architecture, quantization, license, minimum runtime, dependency bundle |
| Runtime qualification | Backend/version, context limit, tokenizer/template, hardware capability, compatibility evidence (separate from file presence) |
| Access locator | Authorized native path / file descriptor + offset/length / document URI / security-scoped bookmark / browser handle (never force every platform into a path string) |
| Usage claim | Consumer identity, active read lease/pin, lifetime and recovery rules |

**Shared candidates:** public LLM weights, tokenizers, Kokoro/embedder weights, licensed
public ZIM files, immutable authored public lore packs.
**Private by default:** birth details, people, charts, conversations, generated companion
text, personal GraphRAG nodes/edges/embeddings, licenses, keys, usage ledgers.

### 19.3 Resolve-existing-first resolver

```ts
interface SharedAssets {
  lock<T>(key: string, run: () => Promise<T>): Promise<T>;
  lookup(asset: Asset, signal: AbortSignal): Promise<Lookup>;
  acquire(asset: Asset, signal: AbortSignal): Promise<Lease>;
}
type Lookup =
  | { kind: "ready"; lease: Lease }
  | { kind: "missing" }
  | { kind: "needs-grant" | "unavailable" | "corrupt"; reason: string };
```

`resolveExistingFirst(scope, asset, store, signal)`: validate identity → `lookup` (shared
providers first, then authorized legacy/private caches) → if `missing`, acquire a
`scope:digest` lock and re-lookup (single-writer) → `acquire` returns a read lease only
after persisted bytes are verified and atomically published. Never start a multi-GB
download after a denied/expired grant.

### 19.4 Platform adapters

| Platform | Shared library root | Access mechanism | Fallback |
|---|---|---|---|
| Windows (MSI/MSIX) | `FOLDERID_Profile` + `Shared AI Assets/<scope>/` | Native broker returns read-only handles; `LockFileEx` digest locks | Discovery/migration from LocalAppData |
| Linux (AppImage/deb) | `$XDG_DATA_HOME/<scope>` or `$HOME/.local/share/<scope>` | OS file locks; read-only handles; transactional publication | Flatpak/Snap → document portal |
| Android | SAF document-tree grant (user-selected) | `ContentResolver` + persisted URI permissions; `BlobStoreManager` for immutable blobs (shared `BlobHandle` identity) | Optional provider app; content URI ≠ filesystem path |
| Browser/PWA | Same-origin OPFS / Cache Storage | Stable path layout under the storage scope; service-worker control | File System Access handles where supported |
| Apple (ecosystem) | App Group container (`containerURL(forSecurityApplicationGroupIdentifier:)`) | Same-team entitlements only | Document picker + security-scoped bookmarks |

### 19.5 Concurrency and lifecycle

- Lock keyed `scope:sha256`; re-lookup inside the lock (two apps arriving simultaneously
  produce one published object).
- Hash the persisted full content (not just new chunks); verify size + digest + compatible
  metadata before exposing a committed object.
- A logical bundle is ready only when **all** required digests are available.
- Read-only clients hold **leases**; removing a model from one app releases its claim,
  never erases shared bytes another app needs. Library-owned GC with active-reader
  protection.
- Natally's delete-everything erases its private records and releases asset claims;
  it never wipes another app's ZIMs or models.

### 19.6 Integration mapping (existing code → shared contract)

| Existing surface | Extension required |
|---|---|
| `MirrorStorage`/`WebMirrorStorage` (cache.ts) | Introduce shared discovery/access via the resolver without invalidating existing caches |
| `MirrorDownloader.download` (download.ts) | Extend lookup to authorized shared locations; preserve resume/cancel/integrity |
| `CatalogueStore.remove` (catalogue.ts) | Replace shared deletion with release-of-claim |
| `loadRuntimeConfig` (config.ts) | Wire `VITE_STORAGE_SCOPE` through generated config + native construction |
| Lore database (lore_commands.rs, web-sqlite.ts) | Stays private; never relocated into the shared object store |
| `ManifestAsset` schema (types.ts) | Extend kinds for ZIM/public-lore bundles + dependency graphs + access locators |

## 20. Windows MSI and Microsoft Store MSIX packaging (strategy doc §19)

### 20.1 Distribution channels

| Channel | Packaging | Update/commerce ownership |
|---|---|---|
| Microsoft Store MSIX | Native Windows payload via Windows SDK → Partner Center | Store signs and delivers updates; payment adapter is separate |
| Direct MSI | Tauri Windows MSI bundle | Natally owns installer upgrades + hosted checkout |
| Store-listed installer | Signed complete installer at an immutable HTTPS URL | Publisher maintains installer and updates |

**Defect (observed):** `scripts/build-windows.sh` requests `msi,msix,nsis` on a Windows
host but collects only EXE/setup outputs. The MSI/MSIX path must be completed and
qualified before R.2's done-marker is honest.

### 20.2 Package identity

Partner Center reserves: `STORE_IDENTITY_NAME`, `STORE_PUBLISHER` (DN),
`PUBLISHER_DISPLAY_NAME`, `MSIX_VERSION` (four 16-bit fields, fourth reserved zero),
`TESTED_WINDOWS_VERSION`, `ARCHITECTURE`. MSI carries a stable `UpgradeCode` (generated
once, never per build). These are independent of `mba.robin.natally`, the storage scope,
and RevenueCat project IDs.

### 20.3 AppxManifest (generated, never hand-edited)

Full-trust `packagedClassicApp` at `mediumIL`; `runFullTrust` capability;
`MinVersion=10.0.22000.0`; `MaxVersionTested` records an actually-tested version.
Generator XML-escapes all substituted values; rejects unresolved `@…@` tokens.

### 20.4 Version mapping (MSI 3-field / MSIX 4-field)

A committed **Windows release ordinal** `n` maps monotonically:
```ts
msi  = [1 + floor(n / 2^24), floor(n / 65536) % 256, n % 65536].join(".");
msix = [1, floor(n / 65536), n % 65536, 0].join(".");
```
MSI ProductVersion limits: fields ≤ 255/255/65535. Never truncate or extra-modulo.
The ordinal persists beside release metadata; increments once under `release.lock`.

### 20.5 Windows shared asset library (bridges §19)

`FOLDERID_Profile` + `Shared AI Assets/<scope>/` — outside AppData virtualization,
shared across MSI and MSIX editions. Adapter operations: discover prior downloads
read-only → `LockFileEx` digest lock → validate (size/digest/reparse/containment) →
same-volume atomic publish (flush + qualified rename) → release claims on uninstall.
Private data (charts, conversations, licenses, keys, WebView2 user data) stays per-app.

### 20.6 Pipeline

Build payload → per-arch staging → `MakeAppx pack` / `MakeAppx bundle` → sign (SHA-256 +
timestamp, credential-managed). Record in the release manifest: MSI, each MSIX, optional
bundle, hashes, display version, package version, source SHA, architecture,
signing/verification status. Disable self-updater in Store MSIX (Store owns updates).

### 20.7 Acceptance

Fresh install + upgrade on real Windows 11 x64 (and ARM64 if advertised); standard-user
execution; WACK; signature verification; startup without dev tools; native chat/audio;
missing-WebView2 recovery; two package identities + MSI share the same library with
zero-network reuse; uninstall preserves other consumers' assets.

## 21. Customer offers, $ROCHE credits, and customer language (strategy doc §20-21)

### 21.1 Two independent purchase paths

| Customer offer | Approved copy | Internal benefit + hard limit |
|---|---|---|
| Higher upfront purchase | **"Unlimited chats with natally"** — "One purchase. Chat with natally as often as you like." | Perpetual local-use entitlement; no per-chat charge on that route; no unlimited hosted allowance |
| Small occasional spending | **"Pay as you chat"** — "Start with a little credit. Pay only for the chats you use." | Spend an eligible $ROCHE balance on bounded hosted requests; the local-use purchase is not required |
| Optional recurring bundle | **"Monthly chat credits"** — "Includes [configured amount] $ROCHE each month." | Finite periodic grant with explicit renewal/rollover terms; not unlimited hosted access |

**Hard rules:** a depleted balance never revokes an owned Unlimited purchase; Unlimited
never makes remote requests free; no silent switch to paid remote (disclose charge
first); never relabel lifetime buyers as subscribers.

### 21.2 Customer language law

Customer-facing surfaces (paywalls, onboarding, settings, receipts, errors, Store
listings) discuss **chatting with natally** only. Forbidden in customer copy: "local,"
"inference," "ephemeris," model names, token accounting, quantization, API routing,
computing location. Approved micro-copy: "Add $ROCHE to keep chatting." / "You're
offline. Connect to keep chatting." / "Restore purchases." Technical documentation and
internal logs use exact implementation names.

### 21.3 $ROCHE virtual currency

- Customer name `$ROCHE`; RevenueCat API code `ROCHE` (no `$` in RC codes).
- **Authority split:** RC = system of record for balances and purchase-driven grants;
  the application service = authenticated jobs, reservations, provenance, reconciliation.
  The service never invents a second wallet total; all participating projects call the
  same spend boundary.
- Integer units, range 0..2×10⁹, no negative balances. Unit precision defined once.
- **Fungibility matrix:** Windows MSIX / direct MSI+Linux / hosted web+PWA → common
  eligible pool. Google Play → currency restricted to originating app (Play Payments
  policy). Direct Android → distinct from Play origin. Future Apple → StoreKit/RC rules.
  Restricted-origin credits never silently mix into unrestricted funds.

### 21.4 Quote/reserve/settle state machine (server-side)

```text
created → debit_pending → reserved → running → settling → completed
                      |          |          |
                      |          +→ refund_pending → refunded
                      +→ declined
uncertain network result → reconcile the same (account, request-id) operation identity
```

Reserve the quoted maximum from RC **before** dispatch (atomic deduction prevents
concurrent overspend). Durable idempotency keys tied to the original job. At completion,
meter the actual usage and return the unused reservation exactly once. Provider failure
before paid work → full refund. No per-token debits — reserve once, settle once per
bounded request.

### 21.5 Catalog separation and account identity

Three catalog concepts: non-consumable lifetime (Unlimited), consumable $ROCHE packs,
optional finite subscription. Distinct Store product IDs / RC product IDs / entitlement
keys / currency code. A subscription must state whether it grants credits, time-limited
local access, or both. A stable authenticated ecosystem account maps to one RC App User
ID (backend-resolved, never trusted from client).

### 21.6 Grant/refund lifecycle

| Event | Required result |
|---|---|
| Lifetime purchase | Verified perpetual entitlement; signed offline token |
| Subscription renews | Grant only that period's finite benefit once (keyed by paid period) |
| Cancel renewal | Stop future grants; retain already-paid benefit through paid-through date |
| Refund/chargeback | Revoke only that purchase's benefit; preserve separately owned access |
| Restore | Reconcile to the authenticated account; never re-issue initial credits |

### 21.7 Microsoft Store commerce (Windows adapter)

Policy 7.19 (§10.8.1/10.8.6) permits third-party digital commerce for non-game apps.
`Windows.Services.Store.StoreContext` adapter: associate with real Store product →
`RequestPurchaseAsync` for checkout → backend validates via Microsoft service APIs →
sync-once into RevenueCat → bridge mints the appropriate token or currency grant.
`'microsoft'` is **not** in the current `PurchaseAdapterId` enum — adding it is a
schema/decision amendment (SC1), never a silent append.

## 22. Execution topology (order independence)

There is no separate workflow document (Architecture Law) and **no execution order**.
The program already exists in this snapshot: every interface a task touches is defined
here, so — like lines in a BASIC program — writing task 20 does not need task 10 to have
been written first; line 10 is already anticipated. Any number of agents may code any
subset of tasks, in any order, in parallel. "Mount", "integrate" and "wire" reference
interfaces defined in this file, never other tasks' completion state. If an
implementation lands where the snapshot did not anticipate it, the dependent task simply
adjusts afterward when it fails — a normal correction, never a blocker.

Environmental facts (not ordering): WP.4 and the Windows legs of W7-2/W7-4 run on a
Windows host; W7-4 additionally needs adb and an AppImage run; R.5 unifies the
per-platform stamp under `release.lock` (CC14). A Verify command that observes another
task's surface passes whenever both exist; absence defers the verification, never the
coding.

There are **no blockers** by recipe time, by construction: anything that would have
blocked a task was surfaced and resolved before this file was written. Arriving at the
checklist with an unresolved blocker means the snapshot pass was incomplete — the fix is
to complete the snapshot first, then the recipe; never an in-code improvisation (I-4/I-6,
CLAUDE.md Architecture Law).
