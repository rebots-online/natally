# natally — agent instructions

Comply with `~/Admin-Manual/` (house SOPs) first; this file is the project-specific layer.

## What this is
natally is a clean-room natal astrology + synastry companion app derived from **Kintsugi and
only Kintsugi** (`~/CascadeProjects/Kintsugi-Unbroken/tauri2/`). Kintsugi is studied for
lessons and anti-patterns; **no code is ported** (D2). No other project is a source or a
reference (D1). The companion (chatbot) and the animated mascot **named natally** are the
core USP (D4, D5, D6). Voice is required, Kokoro, native on all installed platforms, **never
WebView audio** (D7); on the web leg Kokoro runs in-browser via onnxruntime-web and `speechSynthesis` is never called (D7a). Full decision log: `DOCS/DECISIONS.md`.

## Phase gates (I2, TC12)
1. `LIBS/UI/FIGMA/` holds the frozen screen set + `DESIGN.md` + `TOKENS.md`. The operator
   **clears it in Figma** before any architecture work. Screens outside the cleared set never
   appear later without re-approval.
2. `DOCS/ARCHITECTURE.md` (entity table with a content-provenance column) + `CHECKLIST.md`
   + `DOCS/TEST_RUBRIC.md` are written after clearance and before any `src/`.
3. Coders execute `CHECKLIST.md` tasks only, marking `[ ]` `[/]` `[X]` ✅; a task is ✅ only
   when its Verify command ran and matched its Accept line. Each coder/subagent receives
   exactly **one task block** and works only from that block plus this repo's docs — reading
   other task blocks is out of scope (coordination is closed at architecting time; Owns sets
   are pairwise disjoint). A perceived cross-task need is a checklist defect to report
   (`[/] blocked`), never an improvisation.

## House rules that bite here
- Conventions adopted: CC2, CC7, CC9, CC11, CC12, CC13, CC15, TC10, TC12 (Figma carve-out),
  TC14, SC1, SC2, SC4; incidents encoded: INC-16, INC-18, INC-19.
- Branch `master`; commit prefix `v{MAJOR.MINOR.BUILD}: ` (stamp with `scripts/update-version.sh`);
  push at every task completion.
- **Never delete** files or artifacts: `cp` to `~/outbox/` (I-0). No `/tmp` work: project
  `.tmp/` or the session scratchpad. Intermediates are `STAGING_`-prefixed.
- `dist/` is **tracked**; binaries go through git-LFS on forgejo (`.gitattributes`, `.lfsconfig`).
  Artifact names are slug-first: `mba.robin.natally-v<version>-<qualifier>`.
- Manual builds through `scripts/build-*.sh`; CI stays dormant until a public release.
- Secrets: `.env` (gitignored) fed from `~/Admin-Manual/CREDENTIALS/natally.md`; never in the repo.
- **INC-19:** every user-visible string is a computed fact, labelled authored-static
  education, a generated companion transcript, or honest absence. No canned interpretation,
  no compatibility scores.
- Fonts self-hosted under `public/fonts/`; no CDN imports (Kintsugi's offline gap).
- Type floor 12 px; one navigation system; one conversation; the Stage's mascot states are
  driven only by real events.

## License
AGPL-3.0-or-later for now, proprietary as the target once the in-house ephemeris replaces Swiss Ephemeris (D9). The incumbent `sweph-wasm` is pinned behind a swappable `EphemerisEngine` seam (D14); while `sweph-wasm` is in the tree the repo stays AGPL and public.

## Current state

- **2026-09-03 — Phase 0.5 done, frozen** (Figma file `natally v1`, key `TmZDFVgkUeeL1VEYWtuaJL`:
  tokens, type ramp, glyph set, nine components, eleven `screen-*` frame sets (+ desktop
  conversation), Journeys page; renders, `SCREEN.md`, `TOKENS.md`, `STATE-LEDGER.json` under
  `LIBS/UI/FIGMA/`).
- **2026-09-04 — Amended under TC12 §10 (D10–D14):** monorepo (local app + future hosted
  LN/x402 SaaS), monetization in scope for the local app (trial gate → paid unlimited;
  Stripe/RevenueCat/Polar/LemonSqueezy/PayPal/Square; coupons; RC paywall), shared client-side
  GraphRAG lore, companion DOM r/w tools + turboquant + ultra-relatable persona law,
  `sweph-wasm` pinned behind the ephemeris seam. New surfaces (paywall, checkout, coupon,
  trial/license, Settings License + Lore) are **specs-first**; Figma frames pending backfill,
  then operator re-clearance and re-freeze.
- Nothing under `src/` yet. `DOCS/ARCHITECTURE.md` (this amendment round's deliverable),
  `CHECKLIST.md`, `DOCS/TEST_RUBRIC.md` precede any code.
- Open items: Figma frame backfill for the D10–D14 surfaces; HF write token for
  `RobinsAIWorld/natally-models`; forgejo return (push `origin` + LFS); hosted-product design
  pass (Alby Market / x402 — separate conversation).
