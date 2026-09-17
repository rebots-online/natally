# workflow v2 — natally full app (amended: two-checkout reconciliation + Stitch v2)

**Generated:** 2026-09-16 · **Supersedes:** `workflow_natally-full-app.md` (v1, 2026-09-16 — retained per TC5)
**New inputs folded in:** `DOCS/natally-reconciliation-report-16sep2026-20h30.md` (retain A / port B; audit verdict table; Stitch v2 ruling) · B = `~/Desktop/devProjects/natally` uncommitted layer (22 M + 55 ?? ≈ 9 MB, sole copy) · Figma paid expiry (permanent; Stitch is the only elements-class source) · HF token live · forgejo down (mirror carries; forgejo queue: `9aba56e`…current)
**Standing laws:** manual supremacy line · D1–D23 · INC-19 · commit+push per checklist line · ✅ only from observed runs (SC2/GR-4) · additive everywhere (I3)

---

## Phase M0 — Durability first (minutes; blocks nothing; protects everything)

| # | Task (report §8.1–8.3) | Validation |
|---|---|---|
| M0.1 | Outbox snapshot of B: `cp -a ~/Desktop/devProjects/natally ~/outbox/natally/msi4090-desktop-checkout-2026-09-16-snapshot/` (`.git` included — B's reflog is the only local copy of the 09-09→13 arc) | snapshot dir exists; `diff -r` spot-check |
| M0.2 | Strip the embedded token from B's `origin` URL (and the snapshot's) → clean `https://forgejo.robin.mba/rcheung/natally.git` | `git remote -v` shows no credentials |
| M0.3 | Preservation branch: commit all 77 B paths on branch `msi4090-uncommitted-2026-09-13` in B; fetch it into A | A holds the branch; `diff master…branch --stat` ≈ +294/−30 + untracked; zero file overlap with A's ahead-commits (verified ∅) |

**Checkpoint GM0:** the 9 MB layer exists in three durable forms (B tree, A branch, outbox snapshot).

## Phase M1 — Heal the narrow gate-red ON THE BRANCH (report §8.4)

| # | Fix | Source finding |
|---|---|---|
| M1.1 | `tsconfig.base.json`: add `allowImportingTsExtensions` (kills 9× TS5097) + `@natally/local-shell` path mapping (TS2307, app.tsx:5) | F-1 |
| M1.2 | L.1 store test: fix the `_migrations` expectation to match migration 3 (test is wrong, not the migration) | F-12 |
| M1.3 | U.2 test: stop reading the frozen Figma ledger over `file://` (`ERR_INVALID_URL_SCHEME`) — import the JSON module | F-13 |
| M1.4 | Re-run gates on the branch; quote outputs. Biome 33E/56W and remaining warnings triaged (fix-on-encounter; D16 no-hardening applies to doc passes, not red gates) | `tsc` exits 0; L.1 16/16; U.2 22/22 |

**Checkpoint GM1:** branch green at gate level (typecheck + affected suites).

## Phase S2 — Stitch v2 export (report §10 contract; the UI source of record)

| # | Task | Notes |
|---|---|---|
| S2.1 | Verify model reachability: omit `modelId` for default / drive the web UI for Pro-tier ("nano banana + up-to-date Pro Gemini, not Flash" — operator) | MCP surface here exposed Flash-tier only |
| S2.2 | Hybrid flow (as the 09-14 export): web-side upload of the **frozen PNGs** as visual references + MCP `generate_screen_from_text`/`edit_screens`; prompts carry **CHECKLIST entity names verbatim** — U.1 primitives (Button, Chip, TopBar, Composer, PlateCard, TurnHer, TurnYou, shell, stage, wheel) + U.2–U.8 screen vocabulary + the 36-var token names (`--color-midnight` etc.), not Stitch's M3 vocabulary | acceptance: ≥ 0/25 → entity coverage on every screen |
| S2.3 | Iterate per screen (`generate_variants`/`edit_screens`) until visually equal-or-better than the frozen renders; keep every session design law (porthole, sprites-slot, speaker icons, hover callouts, torus, typewriter, no AI character art) | screenshots side-by-side vs `LIBS/UI/FIGMA/screens/*` |
| S2.4 | Land **additively** as `LIBS/UI/STITCH-v2/` (semantic successor, TC5; 09-14 export never overwritten); MCP-pull `code.html` for every screen | all screens carry code; entity-name audit passes |

**Checkpoint GS2:** STITCH-v2 is the wiring source; STITCH(09-14) demoted to reference.

## Phase W0′ — Spec re-derivation (now seeded by the audit + the port)

| # | Task | Changes vs v1 workflow |
|---|---|---|
| W0′.1 | **ARCHITECTURE v2** as before (D20–D23 both editions; sprite MascotRenderer + porthole + idle-cycle laws; hosted OpenRouter-free lane; voice-on-default; hover callouts; typewriter onboarding) **+** §16 refresh: Figma-expired items re-pointed to local complement + STITCH-v2; mirror token resolved; forgejo posture; UI-source-of-record = STITCH-v2 | + audit findings |
| W0′.2 | Kintsugi onboarding behavior study (reference-only, D2) — locate checkout (registry says asrock once had it; else via msi4090 at next contact) | path TBD |
| W0′.3 | **CHECKLIST de novo (D18) seeded from the audit §3.2 verdict table:** true census 60 blocks; markers re-derived (LAG blocks L.2, B.3, V.2, U.9, X.1, I.2, C.1 → port-verify-flip tasks; T0.V gets real Verify/Accept or loses ✅; L.1 [X]→ re-verify post-F-12); predecessors preserved; **B's layer ports THROUGH this checklist task-by-task** (report §8.5), never as a blob | port + spec in one ledger |
| W0′.4 | Review + adopt/adapt B's `AGENTS.md` (agent-runtime parity) into A; resolve A's stray untracked `AGENTS.md` | §6.5 |

**Checkpoint G0′:** new CHECKLIST committed; `update-version.sh --check` green; audit verdict table fully consumed (every LAG block now has a ledger disposition).

## Phase P/W1 — Lore completion (port + write)

L.2 **port-verify-flip** (B: embed + sqlite-vec + tests) · L.4 **write** (hybrid retrieval — no B evidence) · L.5 **write** (write-every-turn pipeline). Gate: lore suite green end-to-end.

## Phase P/W2 — Companion life + data + mirror

C.1 **port-verify-flip** (B: `inference-web.ts` + `lane.ts` + src-tauri `inference/`; native mount rides I.2) · V.2 **port-verify-flip** (B: `src/voice/**`; ban grep ships in the layer) · X.1 **port-verify-flip** (audit: 20/20) · X.2 **write** · B.3 **port-verify-flip** (billing token + tests) · **Mirror publish** via verified HF token — **Qwen3.5-2B Q4_K_M default + Qwen3.5-0.8B lite tier (unsloth GGUF, re-based 2026-09-16 from Qwen3-0.6B; compressed catalogue tiers UD-Q3_K_XL/IQ4_XS pending engine probe)** + Kokoro + MiniLM, sha256 manifest. Gate: companion speaks + reads aloud in dev PWA; data round-trips.

## Phase W3 — Screens from STITCH-v2 (B's screens demoted to wiring references)

Same 9 wiring tasks as v1 (U.1 align, U.8 splash, U.4 onboarding, U.2 conversation ×9 variants, U.9 sprite Stage — B's `stage.tsx`/`mascot.tsx` are the port base, U.3 atlas/torus, U.5 settings, U.7 about+glossary, U.6 paywall/checkout), each wired from `LIBS/UI/STITCH-v2/<screen>/code.html` element names verbatim. Gate G3: all screens render; visual pass vs frozen renders.

## Phase W4 — Integrators + first working PWA build

I.1 routes · I.2 **port-verify-flip** (B: `registry_generated.rs` + `plugins/` + `capabilities/`; un-mounts P.3/L.1/M.1 native sides) · I.3 capabilities · I.4 full gate → **R.4 stamped `dist/web` working build** (critical path end).

## Phase W5 — Billing execution + native legs

B.4 → B.5a/b/c → B.6 bridge (write) · V.1 Kokoro native · R.1/R.2/R.3/R.5 · R.7 dormant CI + CC3 forgejo sibling (forgejo's return required for the sibling push).

## Phase W6 — Hosted edition (D22/D23)

Scaffold consuming STITCH-v2 UI · OpenRouter adapter (free default + dynamic backoff + fallback list + training disclosure + `insufficient-credit` seam) · hosted voice/STT interfaces · x402 via `billing.consume`.

## Phase W7 — Close-out + administration

TEST_RUBRIC gauntlet + TC11 screencast + CC15 Milestone-1 build · **report §8.6–8.8:** `RELOCATED.md` in B (quarantine marker; deletion only by operator after msi4090 verified) · APP_INVENTORY disposition row + PORTFOLIO:71 swapped-attribution fix · INC-9 write-backs (project-folder-at-registration; register cross-machine copies; uncommitted-durability breach) · forgejo push queue drain on return.

---

## Critical path

**M0 → M1 → S2 → W0′ → P/W2 (C.1+X.1 ports) → W3 (U.2+U.9) → W4 → working PWA build.**
The audit converts ~7 of v1's write-tasks into port-verify-flips; the first working build is materially closer than v1 estimated.

## Risk register (top 3)

1. **B's layer is sole-copy until M0.3** — do M0 before anything else today.
2. **Stitch v2 model tier** — if Pro is unreachable, surface it before generating 25 screens at the wrong tier.
3. **Marker trust** — no ✅ flips without observed runs; the audit's table is the baseline, not the conclusion.
