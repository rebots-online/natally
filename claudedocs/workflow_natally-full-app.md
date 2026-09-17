# workflow — natally full app (local + hosted editions)

**Generated:** 2026-09-16 · **Command:** /sc:workflow · **Strategy:** systematic · **Depth:** deep
**Source of truth chain:** `DOCS/DECISIONS.md` (D1–D23) → `DOCS/ARCHITECTURE.md` (reconciled 09-09) → **this workflow** → `CHECKLIST.md` (to be regenerated de novo, D18)
**UI source:** `LIBS/UI/STITCH/` (Google Stitch export, 25 folders, `code.html` for all 24 real screens; Figma no longer available — Stitch is the design source per operator, D20 sequence satisfied through its export leg)
**Code push target:** `github` → `https://github.com/rebots-online/natally` (forgejo down; retry at handbacks)
**Admin-Manual pushes:** logs, credentials, progress reports ONLY (operator directive 2026-09-16)
**Baseline state:** v1.13.21288 @ `9aba56e`+ · checklist 25 ✅ / 3 `[X]` / 31 `[ ]` · HF write token verified live · Stitch MCP connected

---

## Phase W0 — Spec re-derivation (blocks dispatch; architect role)

The current gate-2 documents predate D20–D23. Nothing below dispatches until this phase lands.

| # | Task | Depends | Output / Validation |
|---|---|---|---|
| W0.1 | **ARCHITECTURE.md v2** — re-derive section-by-section from the reconciled edition + D20–D23 + session design laws: both editions (`apps/local`, `apps/hosted`) with shared exported UI source; hosted inference = OpenRouter free + dynamic backoff + config-level fallback list + plain training-disclosure; sprite-based MascotRenderer (porthole bottom-right everywhere, docked-open conversation by default, idle cycle: lounge-on-textarea / stand-behind-chart-circle / crystal-ball / phone / time-of-day / cursor-ride+finger-pounce; real-footage core + sprite states + silhouette placeholders); voice-on-by-default + speaker replay icon; hover callouts (numbered houses, G.1 corpus); slow 3D torus wheel; §5 entity table + §15 config gain hosted-edition rows | W-none (inputs exist) | Every Stitch screen folder has a named architecture owner; every D20–D23 clause cited in ≥1 section |
| W0.2 | **Kintsugi onboarding behavior study** (D21/D2 — reference only, no port): read `~/CascadeProjects/Kintsugi-Unbroken/tauri2/` onboarding components for the typewriter-large-bold sequencing semantics (timing, reveal order, skip affordance, fact-after-answer rhythm) | W-none | Behavior notes appended to W0.1 §onboarding — CSS/React implementation independent |
| W0.3 | **CHECKLIST.md de novo** (D18) from W0.1 — section-anchored tasks, disjoint Owns, predecessors preserved beside (`CHECKLIST.md.bak.<stamp>` per I3); carries over the 31 `[ ]` + 3 `[X]` baselines re-anchored, adds hosted-edition + Stitch-wiring + sprite-Stage tasks | W0.1, W0.2 | Every task cites its ARCHITECTURE §; census recorded; commit + push github |

**Checkpoint G0:** new CHECKLIST committed; `scripts/update-version.sh --check` green; both predecessors intact.

## Phase W1 — Lore backend (web lane, no operator dependency)

Parallel-safe; all pure TypeScript over existing DDL/contracts.

| # | Task (checklist anchor) | Depends | Validation |
|---|---|---|---|
| W1.1 | L.2 embedder (MiniLM GGUF via wllama; dim from config; hash-embedder test-only) | W0.3 | `embed.test.ts`: dim honored, L2 norm 1.0±1e-6, src purity |
| W1.2 | L.4 hybrid retrieval (vec kNN ∪ 2-hop, budget 1500 tok, person-scoped) | W1.1 | `retrieve.test.ts` |
| W1.3 | L.5 write-every-turn pipeline (≤1 flush/turn, txn insert-only, stats, real delete) | W1.1, L.3✅ | `pipeline.test.ts`: 50 turns, flush=50, delete→0 |

**Checkpoint G1:** lore suite green; fence Tier-2 feedable end-to-end in tests.

## Phase W2 — Companion life + app data (web lane)

| # | Task | Depends | Validation |
|---|---|---|---|
| W2.1 | C.1 inference host — web lane first (wllama, staged `qwen3-0.6b-q4_k_m.gguf`, Q4_K_M + KV q8_0; lane.ts selection; hosted lane stub behind the same `complete()` seam per D22) | W0.3 | `inference.test.ts`: turboquant params both lanes |
| W2.2 | V.2 web voice (Kokoro onnxruntime-web → AudioWorklet → shared RMS envelope → bus) + `speechSynthesis` ban grep | W0.3 | `voice` tests + grep 0 hits |
| W2.3 | X.1 repos + export/import (conflicts: existing wins; removePerson cascade) | W0.3 | `data` tests incl. roundtrip |
| W2.4 | X.2 delete-everything | W2.3 | `destroy.test.ts`: 0 rows, files gone, token cleared |
| W2.5 | **Mirror publication** (operator token now live): assemble staged Qwen3/Kokoro/MiniLM + sha256 `manifest.json` → push `RobinsAIWorld/natally-models` via `HF_TOKEN` | W-none | manifest fetchable; sha256 of published == staged |

**Checkpoint G2:** companion speaks from chart facts in the PWA dev server; voice reads aloud; everything persists; models downloadable.

## Phase W3 — Screens from the Stitch source (the big block)

Every task wires `LIBS/UI/STITCH/<screen>/code.html` element names/classes/labels **verbatim** (D20); behaviors per W0.1 laws. Each screen = one coder dispatch.

| # | Task | Stitch source | Depends | Notes |
|---|---|---|---|---|
| W3.1 | U.1 updates — primitives/router alignment to Stitch DOM (topbar, chips, composer pill, turn bubbles, plate card) | multiple | W0.3 | keeps ✅ U.1 compatible |
| W3.2 | U.8 splash (typewriter wordmark, real engine-load progress) | `screen_1_splash` | W2.5 | D21 typewriter law |
| W3.3 | U.4 people + first-light (Kintsugi-style onboarding sequence per W0.2; instant fact after each answer) | `screen_2_first_light_onboarding`, `screen_8_people` | W2.3 | |
| W3.4 | U.2 conversation — 9 variants, transcript grammar, voice-on + speaker replay icon, hover callouts live here too; Stage mounts | `screen_3*`, `screen_4*`, `screen_3b*` | W2.1–W2.3 | the primary surface |
| W3.5 | U.9 Stage — **sprite MascotRenderer**: porthole + docked-open conversation, idle-cycle sprite states, reduced-motion, STATES.md real-vs-composed mapping | mascot behavior spec in W0.1 | W2.1 (bus signals) | sprite sheets authored as gold-hairline silhouette placeholders; footage slot kept |
| W3.6 | U.3 plates + Atlas — slow 3D torus wheel (three_js helper screen), numbered-house hover callouts, aspect tables, house-system chips (12 pinned) | `screen_5*`, `screen_6*`, `screen_7*`, `three_js_e7ff4e4b` | W2.3 | |
| W3.7 | U.5 settings (6 sections; model catalogue live downloads; lore line) | `screen_10_settings` | W1.3, W2.5 | |
| W3.8 | U.7 about + glossary callout (AGPL line; "Ask natally" posts to conversation) | `screen_11_about`, `screen_9_glossary_callout` | W3.4 | |
| W3.9 | U.6 paywall + checkout (13 frames; honest rails line; QR from real URL) | `screen_12_paywall`, `screen_13_checkout` | W3.4 (binds B.1/B.2 done; B.5 later) | |

**Checkpoint G3:** all 13 screens render against bus/data fixtures; every `code.html` element traceable in the wired components; visual pass per screen (Playwright screenshots vs `screen.png`).

## Phase W4 — Integrators + working PWA build

| # | Task | Depends | Validation |
|---|---|---|---|
| W4.1 | I.1 route registry gen | W3.* | typecheck clean |
| W4.2 | I.3 capability layer | W3.* | `__TAURI__` grep clean elsewhere |
| W4.3 | I.4 full workspace gate (+ V.2 grep + 300 KB budget) | W4.1, W4.2 | `check.sh` green |
| W4.4 | **R.4 rerun → working PWA build in `dist/web`** (stamped) | W4.3 | boots: charts ✓, trial gate ✓, companion ✓ (models), voice ✓ |

**Checkpoint G4 — first WORKING BUILD (web).** CC15 evidence may start here (screencast leg 1).

## Phase W5 — Billing execution + native legs (parallel waves)

| Wave | Tasks | Notes |
|---|---|---|
| W5a | B.3 → B.4 → B.5a → B.5b → B.5c → B.6 (license bridge) | hosted/OpenRouter defaults ride the same config surface; trial alignment per §9 |
| W5b | Native mounts: P.3/L.1/M.1 native sides + I.2 registry + C.1 native (llama.cpp) + V.1 (Kokoro Rust/cpal) + B.3 keychain | un-mounts the three `[X]` |
| W5c | R.1 linux build → R.2 windows → R.3 android → R.5 build-all → R.7 dormant CI | D8 host detection |

**Checkpoint G5:** complete stamped multiplatform set (CC14 shape).

## Phase W6 — Hosted edition (`apps/hosted`, D22/D23)

| # | Task | Depends |
|---|---|---|
| W6.1 | Hosted scaffold consuming the SAME Stitch-wired UI source; services behind shared interfaces | W3.1 |
| W6.2 | OpenRouter adapter: `openrouter/free` default + **dynamic backoff** (429-aware, jittered exponential, per-request model fallback list) + plain training-on-prompts disclosure + `insufficient-credit` seam | W0.1 |
| W6.3 | Hosted voice/STT behind shared interfaces (provider selection open) | W6.1 |
| W6.4 | x402/LN pay-per-reading via `billing.consume` seam (R2) | W5a, W6.2 |

## Phase W7 — Verification close-out

- TEST_RUBRIC gauntlet on working artifacts (J1–J11 walks, fence adversarial suite, budget asserts) → TC11 screencast with timecode table → CC15 Milestone-1 provisional production build, `NOT-A-RELEASE.md`, append-only tweak log.
- Push discipline: every checklist line commits + pushes to github immediately; forgejo retry each handback; Admin-Manual receives only session logs / credentials / progress reports.

---

## Critical path (longest chain)

**W0 → W2.1 → W3.4 → W4.* → G4 (working web build)** — everything else parallelizes off it.
Estimated dispatch surface: ~34 checklist tasks + W0 authoring + W6 hosted set.

## Standing laws every wave inherits

D2 clean-room · D7/D7a voice · D13 persona/relatability · D19 re-clearance non-blocking · D20 Stitch-wiring verbatim · D21 typewriter/3D/constellations · D22 shared-UI two editions · D23 parallel + honest README matrix · INC-19 content law · no `speechSynthesis` · high non-patterned dev ports · `.env` secrets never shipped · sprite/placeholder mascot (no AI character art).
