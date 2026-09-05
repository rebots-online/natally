# natally — Decision log (append-only)

Each entry: date, who decided, the decision, and what it rules out. Later entries never
silently override earlier ones; they cite them.

## 2026-09-02 — Operator decisions at project inception (session with Claude Fable 5.1)

| # | Decision | Rules out |
|---|---|---|
| D1 | natally is a clean-room derivation of **Kintsugi and only Kintsugi**. | Any other project as source, reference, or comparison. |
| D2 | **Reference only, rewrite everything.** Kintsugi is studied for lessons and anti-patterns; natally re-implements directly on upstream libraries. Lessons become architecture decisions and test fixtures. | Porting any Kintsugi module, type, or script. |
| D3 | The UI complement is built as a **Figma Design file via MCP** and **cleared by the operator in Figma** before `DOCS/ARCHITECTURE.md` (TC12 §9; Figma carve-out §11). | Architecting before clearance; screens added after clearance without re-approval. |
| D4 | **v1 scope:** natal, synastry, today's transits; on-device chatbot companion; animated mascot; native voice. Tarot, journal, billing are v2 checklists. | Stubs or placeholders for v2 features. |
| D5 | **Mascot:** the same character as the Kintsugi oracle (one companion across the operator's universe), **named natally** in this app. Artwork is operator IP and may be reused. | A second character; a "cadre of fortune-tellers". |
| D6 | **Interaction model:** primarily chatbot delivery of information. Charts are shown inside the conversation and open into an Atlas view. | Tab-per-feature navigation; tables-first screens. |
| D7 | **Voice is part of the character.** Kokoro on all installed platforms, synthesised **and played natively in Rust**. Never WebView audio ("it will ruin the effect"). | WebView `<audio>`/WebAudio on any installed platform; text-only voice fallback on native. |
| D8 | **Windows packaging by build host:** Linux host → `.exe` + NSIS via cargo-xwin; Windows 11 host → `.msi` + Store-compatible `.msix`. The build script detects the host OS. | A single Windows leg that ignores the host. |

### Assumptions recorded at plan approval (2026-09-03), standing unless the operator objects

| # | Assumption |
|---|---|
| A1 | ~~The web PWA leg has no voice~~ **Retired 2026-09-03 by D7a** (see below). Original text: The web PWA leg has no voice: browsers can only play through the WebView, which D7 forbids. The web leg ships charts + text companion; the voice control shows honest absence. |
| A2 | Namespace `mba.robin.natally`; origin `https://forgejo.robin.mba/rcheung/natally.git`; branch `master`. ~~License AGPL-3.0-or-later~~ superseded by D9. |
| A3 | Frozen model mirror `RobinsAIWorld/natally-models` on Hugging Face (GGUF, Kokoro ONNX, voices, `manifest.json` with sha256). A working HF write token is an operator precondition (both PATs in Admin-Manual returned 401 on 2026-08-18). |
| A4 | Dark only: the character is drawn for night; gold seams need a dark ground. |

### Design tokens fixed at the Figma pass (2026-09-03)

Recorded in `LIBS/UI/FIGMA/DESIGN.md` and `TOKENS.md`; the code `@theme` block mirrors them
one-to-one once `src/` exists.

## 2026-09-03 — Remote arrangement while forgejo is down (operator)

- `forgejo.robin.mba` is unreachable "until further notice". Commits push **frequently to
  GitHub `rebots-online/natally`** (remote `github`) for now. `origin` stays pointed at forgejo
  for when it returns (Admin-Manual: forgejo-authoritative, CC13).
- CC13 holds: GitHub is a code-only mirror; **no LFS objects are pushed to GitHub**
  (`GIT_LFS_SKIP_PUSH=1`). Release binaries in `dist/` stay LFS-tracked and wait for forgejo.
  The mascot source loop (485 KB) was taken out of LFS so the footage lives in plain git.

## 2026-09-03 — License and visibility (operator)

| # | Decision | Rules out |
|---|---|---|
| D9 | **License: AGPL-3.0-or-later for now, proprietary as the target.** While Swiss Ephemeris (`sweph-wasm`, AGPL) is the engine, the repo stays AGPL and **public** (`rebots-online/natally`; public also serves reading tools such as NotebookLM). Once the operator's in-house ephemeris supersedes Swiss Ephemeris, the license moves to proprietary (amended 2026-09-03 after the operator's clarification). | Shipping proprietary with an AGPL ephemeris. |

**Open consequence for architecture (must be resolved before `DOCS/ARCHITECTURE.md`):**
Swiss Ephemeris (`sweph-wasm`, the engine Kintsugi used) is AGPL-3.0 unless Astrodienst's paid
Swiss Ephemeris Professional License is purchased. Under D9 the architecture picks exactly one of:
(a) **purchase the Astrodienst professional license** and keep Swiss Ephemeris (arcsecond
accuracy, Chiron, all house systems for free), or (b) **`astronomy-engine` (MIT)** for planetary
positions plus in-house house-system math (Placidus, Koch, Equal, Whole Sign, etc. are pure
spherical trigonometry) and no Chiron unless a separate minor-body solution is added.
Recommendation: (a) if the one-time fee fits; otherwise (b) with Chiron listed as honest absence.

### Ephemeris successor — pending operator input (2026-09-03)

The operator recalls an in-house project intended to supersede vendoring Swiss Ephemeris
("maybe a side project with GLM on the other computer, in Windows, the past week"). Searched
this workstation (msi4090): **not present**. Candidates found here are unrelated:
`~/Downloads/jules_Kintsugi-Unbroken_Add-Astrology-API-SwissEphemerust-…` is a July Jules diff
adding a Rust *binding* to Swiss Ephemeris (still AGPL), `~/github/astrosyn-tauri/` is 2025
spec prose only, `~/forgejo/natally/` is an empty stray (index metadata only, no source;
operator confirms it was never created as a project; left in place per I-0).
**Action:** operator surfaces the side project from the Windows machine; architecture then
decides between it, the Astrodienst professional license, and a permissive engine.

## 2026-09-03 — Roadmap after the design pass (operator)

| # | Direction | Notes |
|---|---|---|
| R1 | **Alby Market web-only edition first.** Once the look and the engine are clean, ship a web-only build listed on the Alby Market (Kokoro voice on web too, per D7a: in-browser ONNX inference; charts + companion + voice). | Precedes the multiplatform v1 Milestone 1 in priority. Architecture must keep the web leg a first-class build target with its own stamped artifact. |
| R2 | **x402 / Alby-marketplace-aligned edition next.** Integrate x402 (HTTP 402 Lightning payments) in the marketplace-aligned version. | Billing stays a v2 checklist; the interface seam (`billing.consume`) is designed in at architecture so R2 does not re-architect. |

## 2026-09-03 — voice on every leg

| # | Decision | Kintsugi lesson |
|---|---|---|
| D7a | **Kokoro on every version, including the web leg.** Operator: "kokoro all versions — never use built-in browser robo-voice". The thing D7 forbids is the browser's own speech engine (`speechSynthesis`, the "robo-voice"), never Kokoro's PCM. Native legs (Linux, Windows, Android): Kokoro synthesised **and played in Rust** (D7 unchanged). Web leg: Kokoro-82M runs **in the browser** via onnxruntime-web (WASM, WebGPU where present) with the same voices and the same `manifest.json`; its PCM is played through the Web Audio API because a browser has no other output. `speechSynthesis` is never called on any leg. Retires A1. | Kintsugi had no voice at all; the companion was text in a drawer. |

## 2026-09-04 — Monorepo, monetization, lore, companion scope (operator, /sc:analyze session)

Operator re-approval under TC12 §10 for post-freeze screen additions (paywall, checkout,
coupon/redeem, trial and license states; settings License + Lore sections). Two-product
structure clarified first: the hosted web-only Bitcoin-LN/x402 SaaS and the local
desktop/mobile/web-PWA app are **complementary, both in this repo** (monorepo). The hosted
product is designed later in its own pass; only its seams are laid now.

| # | Decision | Rules out |
|---|---|---|
| D10 | **Monorepo, two complementary product lines.** This repo carries the **local app** product (Linux, Windows, Android, web PWA — all four legs run local inference) now, and anticipates the **hosted web-only SaaS** (Alby Market / Bitcoin LN / x402, pay-per-reading, hosted API, no free trial, not unlimited-intended) as a second product in the same monorepo. `DOCS/ARCHITECTURE.md` lays the monorepo layout and shared-package seams now; the hosted product's own design (rails, OpenRouter provisioning, business panel) is a separate later pass. | Splitting the two products into separate repos; designing the hosted product's details now. |
| D11 | **Local-app monetization moves into production scope** (supersedes D4's "billing is a v2 checklist" for this product). Unlicensed trial with an operator-configured gate — readings-count (e.g. 3 free), time-based, or rate-limit (e.g. max 1 reading per 3 days) — on **one designated trial model only**; paid unlock = unlimited (default lifetime offering; RevenueCat offerings allow recurring). Payment processors configured in `.env`: Stripe, RevenueCat, Polar.sh, LemonSqueezy, PayPal, Square. Coupon codes: individually-redeemable and hash-based. RevenueCat paywall is a designed screen. | Free-unlimited local app; per-reading metering on the local product (that is the hosted product's model); stubbed or mocked purchase flows. |
| D12 | **Lore subsystem (GraphRAG-type), shared by both products, client-side.** Every turn of every conversation is recorded into a local knowledge graph + vector store ("lore") and the companion actively engages with it (retrieval into the prompt fence). Lore and the companion type run **client-side on local storage in both product lines** — native storage in the local app, browser local storage in the hosted SaaS; in the hosted product the only egress is retrieval context sent to the hosted API. UI this release: conversational + Settings data controls (view summary, export, delete). Kept modular — later releases may add the operator's standard knowledge navigation ("pysanky / 6dog" graph navigation). | Server-side lore storage; lore visible only through a future graph UI; lore as an afterthought bolted on post-v1. |
| D13 | **Companion capabilities and persona.** The companion is a tool-using agent with **standard full DOM read/write access** (the app's own interface on native legs, the page DOM on the web legs; every invocation recorded in the transcript and lore, no hidden writes). On-device inference runs **atomic chat-turboquant**: quantized weights **and** KV-cache compression (llama.cpp native; WASM on the PWA leg). Persona law: **very approachable voice and animated mascot to feel ultra relatable** — warm, never clinical; the affective surface (voice + mascot, D5/D7/D7a) is the USP, and every billing/trial surface speaks in her voice. | A detached utility-tone assistant; hidden agent actions; companion as a text-only chat box. |
| D14 | **Ephemeris incumbent pinned, modular seam (resolves D9's open consequence).** Swiss Ephemeris via `sweph-wasm` stays the engine (arcsecond accuracy, Chiron, all house systems), wrapped in a swappable `EphemerisEngine` seam so a successor (Astrodienst-licensed build, `astronomy-engine` + in-house houses, or the operator's in-house engine) can replace it without re-architecting. Repo stays AGPL-3.0-or-later and public while `sweph-wasm` is in the tree; the D9 proprietary flip happens only when a successor lands. | Blocking architecture on the successor search; baking `sweph-wasm` calls directly into UI code. |

Complement consequence (Stage 1 of the approved plan): `screen-paywall`, `screen-checkout`,
coupon/redeem states, conversation trial states, and the Settings License + Lore sections are
added to the complement as **specs first** (`SCREEN.md` + `STATE-LEDGER.json` `pendingFixes`
worklist); the Figma frames are backfilled into `natally v1` and the complement re-frozen
only after the frames exist and the operator clears them (TC12 §9 again). R1/R2 rows above
are re-read as the **hosted product's** roadmap (D10), not as legs of the local app.
