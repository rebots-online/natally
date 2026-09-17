# natally — implementation checklist (Gate 2 document 2 of 3) — v2

Regenerated **de novo 2026-09-17** from `DOCS/ARCHITECTURE.md` (reconciled 2026-09-09 +
spec-panel fills 2026-09-11 + **§18 v2 amendment 2026-09-17**). Predecessors preserved
beside (additive, I3): `CHECKLIST.md.bak.20260917_064811.pre-v2` (and its own 09-09
predecessors). Marker discipline (SC2): `[ ]` untouched · `[/]` undertaken · `[X]`
implemented (Verify ran, Accept held) · `✅` validated from an **observed run** — every
✅ below cites its evidence (commit + run). D17: the enumeration consumed here is the
architecture as amended; coders see exactly one block.

**Reconciliation seed:** the 2026-09-13 audit (`DOCS/ANALYSIS-REPORT-2026-09-13…`, §3.2
verdict table) + the 2026-09-16/17 implement session (`e5e6926…77d0dd8`). LAG blocks are
re-derived from in-tree code, not from old markers.

## Execution protocol

Unchanged from the 09-09 edition: atomic, idempotent, order-independent tasks (⛓
integrators excepted); disjoint Owns; Verify + Accept observe durable end-state; ✅ only
from observed runs; commit+push per checklist line (github mirror while forgejo is down);
no mocks in shipped code.

---

## Phase T — Scaffolding & contracts

- ✅ **T0.1 Workspace scaffold** — observed 2026-09-13 (v1.10.21039 run log in block).
- ✅ **T0.V Detached vendored ephemeris** — VENDORED/ lock + manifest; runtime exercised by P.1.
  *(Audit F-note: block now carries real Verify/Accept lines below.)*
  **Verify:** `python3 scripts/vendor-ephemeris.py` · **Accept:** `651 files, npm runtime sha matched` [observed in preservation commit d011b6c lineage].
- ✅ **T0.2 apps/local frontend scaffold** — tsc standalone clean; entry + lazy shell.
- ✅ **T0.3 src-tauri scaffold** — cargo check 0 errors (re-observed 2026-09-17 pre-R.1).
- ✅ **T0.4 Token mirror test** — 36 vars mirrored (fixed from the 35/36 confusion; tokens.css ↔ TOKENS.md ↔ ledger).
- ✅ **T0.5 Ephemeris contracts** — seam + pinned 12-system closed set (sweph-wasm@2.6.9 d.ts).
- ✅ **T0.6 Lore & conversation contracts** — roundtrip suites green.
- ✅ **T0.7 Billing contracts** — roundtrip suites green.
- ✅ **T0.8 Design tokens package** — gen.mjs --check green (36 vars).
- ✅ **T0.9 SQLite DDL & migration runner** — migrations {1,2,3}+vec; sessions.historical_person_id (migration 3).
- ✅ **T0.10 Config loader** — valid/blank-rails/bad-env matrices; **amended 2026-09-17: mirror base allows http on loopback (matches MirrorNetwork; observed via in-browser manifest fetch).**

## Phase P — Ephemeris

- ✅ **P.1 sweph-wasm backend** — conformance 24 cases (invariants).
- ✅ **P.2 Honest-absence & solar rules** — 96 tests.
- [X] **P.3 Worker/off-thread host** — web worker transport green in-suite; **native transport awaits I.2 mounting** (Rust side written, unmounted).
- ✅ **P.4 ChartFacts builder + cache** — 11 tests; **observed end-to-end in-browser 2026-09-17 (§18.6): real natal chart computed from intake.**

## Phase L — Lore

- [X] **L.1 LoreStore storage adapters** — store suite 16/16 after F-12 heal (observed); native command surface awaits I.2.
- ✅ **L.2 Embedder** — embed suite green (wllama MiniLM observed-fixture + hash test embedder; src purity).
- ✅ **L.3 Extraction & merge** — 30 tests.
- [ ] **L.4 Hybrid retrieval** — vector kNN ∪ 2-hop, budget, person-scoping. **Owns:** `packages/lore/src/retrieve.ts` + tests.
- [ ] **L.5 Write-every-turn pipeline** — consume(turn) → embed→extract→merge→batched write; stats; deleteAll. **Owns:** `packages/lore/src/pipeline.ts` + tests. **Note:** the conversation composition currently writes turns directly; L.5 wraps that path.

## Phase B — Billing & licensing

- ✅ **B.1 Trial gate** — 119 tests.
- ✅ **B.2 Reading ledger + billing.consume** — 28 tests (charge/refund lifecycle).
- ✅ **B.3 License token verify + storage** — token suite green (web + Rust verify written; keychain mounting rides I.2).
- [ ] **B.4 Codes** — NATALLY-XXXX Crockford; 4 outcomes. **Owns:** `packages/billing/src/codes.ts` + tests.
- [ ] **B.5a Hosted-redirect adapter + bridge client** — SSRF guards, poll loop. **Owns:** `packages/billing/src/adapters/*`, `bridge-client.ts`.
- [ ] **B.5b RevenueCat adapter.** **Owns:** `packages/billing/src/adapters/revenuecat.ts`.
- [ ] **B.5c Adapter registry.** **Owns:** `packages/billing/src/adapters/registry.ts`.
- [ ] **B.6 License bridge service** — axum, 6 webhooks, mint/verify, deny-list. **Owns:** `services/license-bridge/**`.

## Phase C — Companion

- ✅ **C.1 Inference host (turboquant)** — web lane observed end-to-end (download→wllama→fenced persona reply, `77d0dd8` lineage); native llama.cpp side written, mounts with I.2. Catalogue per §18.3 (Atomic Bots).
- ✅ **C.2 Prompt fence + checker** — 109 tests; **Tier-1 now carries a real ChartFacts (observed §18.6).**
- ✅ **C.3 Tool suite (DOM r/w)** — 79 tests; no-network construction.
- ✅ **C.4 Companion event bus** — StageSignal reducer; envelope semantics observed (Stage Speaking).

## Phase V — Voice

- ✅ **V.2 Kokoro web + ban guard** — **observed: q8 model in-browser, envelope→Speaking, ban grep ships** (`scripts/grep-no-speechsynthesis.sh`).
- [ ] **V.1 Kokoro native (Rust)** — ort session + cpal + envelope. **Owns:** `apps/local/src-tauri/src/voice/**`.

## Phase U — UI

- ✅ **U.1 Shell, router contract, primitives** — 8 tests incl. sprite payload equality.
- ✅ **U.2 Conversation screen** — 22/22; 9 variants; **wired into the built app and behavior-verified (Trial chip, Asleep wake plate, transcript, Thinking/Responding).**
- [ ] **U.3 Plates + Atlas screens** — 3D torus wheel (three_js helper export exists), numbered-house hover callouts (G.1 corpus), 12-system chips, bi-wheel. **Owns:** `apps/local/src/screens/{plate-natal,atlas}/`, `apps/local/src/ui/wheel.tsx`. Source: `LIBS/UI/STITCH(-v2)` element names verbatim (§18.1).
- ✅ **U.4 People + first-light** — **observed 2026-09-17 (`77d0dd8`): intake → Person/SQLite → real chart → plate + greeting; reload restores.** Intake tests 4/4. *(People list/edit surface still owed — folded into W3-People below.)*
- [ ] **U.5 Settings screen** — 6 sections; live catalogue downloads. **Owns:** `apps/local/src/screens/settings/`.
- [ ] **U.6 Paywall + checkout screens** — 13 frames. **Owns:** `apps/local/src/screens/{paywall,checkout}/`.
- [ ] **U.7 About + glossary-callout** — AGPL line, provenance, hover-term callouts. **Owns:** `apps/local/src/screens/{about,glossary}/`.
- [ ] **U.8 Splash** — typewriter wordmark (D21), real engine-load progress. **Owns:** `apps/local/src/screens/splash/`.
- [ ] **U.9 Stage (sprite MascotRenderer)** — port `stage.tsx`/`mascot.tsx` to the §18.2 law: porthole on every screen, docked-open conversation, sprite idle cycle (lounge/chart-circle/crystal/phone/time-of-day/cursor/finger), animated Asleep, reduced-motion. **Owns:** `apps/local/src/ui/stage.tsx`, sprite assets, `stage.test.tsx` extension.

## Phase M — Mirror

- ✅ **M.1 Manifest, downloads, catalogue** — 37 tests; **observed twice in-browser (1.28 GB streamed sha-verified commit; voice trio).** Local mirror carries dev; HF publish → open item §18.7-1.

## Phase X — Persistence

- ✅ **X.1 Repositories + export/import** — 20/20 audit + **observed live (OPFS SQLite rows across reloads)**.
- [ ] **X.2 Delete-everything** — destroy.ts. **Owns:** `apps/local/src/data/destroy.ts` + test.

## Phase G / S

- ✅ **G.1 Glossary + gazetteer** — 51 tests; gazetteer live in the intake (tzid used).
- ✅ **S.1 Fonts self-host** — 6 woff2 + provenance.

## Phase I — Integrators ⛓

- [X] **I.1 Route registry wiring** — gen-routes.mjs + routes.generated.ts live [observed]; regenerate when screens land (W3 adds ROUTE_MAP entries).
- [ ] **I.2 Tauri command registry wiring** — registry_generated.rs + plugins mount (un-mounts P.3/L.1/B.3/C.1-native/M.1-native).
- [ ] **I.3 Capability layer resolution** — capabilities.ts single selection point.
- [ ] **I.4 Full workspace gate** — check.sh green observed at 2 workers (1217/1217; full-parallel flake is env IPC pressure — normalize with `--maxWorkers` in check.sh); + budget assert ≤300 KB gz.

## Phase R — Build & release

- ✅ **R.1 build-linux.sh** — AppImage+deb produced [observed v1.21.27237].
- ✅ **R.2 build-windows.sh** — exe+NSIS via xwin shim [observed v1.24.27313]; Windows-host msi/msix path authored.
- ✅ **R.3 build-android.sh** — apk+aab aarch64 [observed v1.26.27331, versionCode formula held].
- ✅ **R.4 build-web.sh (PWA)** — artifacts through v1.27.27365; behavior-verified build.
- [ ] **R.5 build-all + release flow** — **single `release.lock` stamp across platforms (CC14 owed; current per-platform stamps are reconciled here).**
- ✅ **R.6 Version stamping wiring** — --check consistent across surfaces (observed each build).
- [ ] **R.7 Dormant CI + guards** — workflows + license-lint.mjs; `.forgejo` sibling when forgejo returns.

## Phase W3 — Screens from Stitch (new; §18.1)

- [ ] **W3-S2 Stitch v2 export** — frozen PNG refs + entity names verbatim + Pro tier; lands `LIBS/UI/STITCH-v2/` additively. **Owns:** the folder + export logs.
- [ ] **W3-People** — list/edit/remove + export-first nudge (J3). **Owns:** `apps/local/src/screens/people/`.
- [ ] **W3-Settings/U.5, U.6, U.7, U.8, U.3** — as above, each wired from STITCH-v2 code.html element names.

## Phase H — Hosted edition (new; D22/D23, §18.3)

- [ ] **H.1 Hosted scaffold** — `apps/hosted/` consuming the same UI source behind shared service interfaces. **Owns:** `apps/hosted/**`.
- [ ] **H.2 OpenRouter adapter** — free default + dynamic backoff + fallback list + training disclosure + `insufficient-credit` seam. **Owns:** `apps/hosted/src/inference/openrouter.ts` (+ web-lane reuse).
- [ ] **H.3 Hosted voice/STT interfaces.**
- [ ] **H.4 x402/LN pay-per-reading** via `billing.consume` (B-chain prerequisite).

## Phase W7 — Close-out

- [ ] **W7-1 TEST_RUBRIC gauntlet** on working artifacts + TC11 screencast (timecode table).
- [ ] **W7-2 CC15 Milestone-1 provisional build** — single-stamp multiplatform set in tracked dist/ + NOT-A-RELEASE.md.
- [ ] **W7-3 Registry & INC-9 write-backs** — APP_INVENTORY/PORTFOLIO rows (as-built stamps + dispositions); incidents: project-folder-at-registration, cross-machine copies, uncommitted-durability.
- [ ] **W7-4 On-device verification** — adb install/launch (apk), Windows-box run (exe/setup), AppImage run.

---

## Completion criteria

All `[ ]`/`[X]` resolved to ✅ with cited observed runs; I.4 normalized green; the
release.lock-unified stamped set in `dist/`; TEST_RUBRIC gauntlet + CC15 screencast
archived under `dist/rubric-runs/`. This checklist is the dispatch ledger — one block per
coder; ARCHITECTURE §18 is the authority for every Spec above.
