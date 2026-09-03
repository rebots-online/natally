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
| A1 | The **web PWA leg has no voice**: browsers can only play through the WebView, which D7 forbids. The web leg ships charts + text companion; the voice control shows honest absence. |
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
| R1 | **Alby Market web-only edition first.** Once the look and the engine are clean, ship a web-only build listed on the Alby Market (no native voice on web per A1; charts + text companion). | Precedes the multiplatform v1 Milestone 1 in priority. Architecture must keep the web leg a first-class build target with its own stamped artifact. |
| R2 | **x402 / Alby-marketplace-aligned edition next.** Integrate x402 (HTTP 402 Lightning payments) in the marketplace-aligned version. | Billing stays a v2 checklist; the interface seam (`billing.consume`) is designed in at architecture so R2 does not re-architect. |
