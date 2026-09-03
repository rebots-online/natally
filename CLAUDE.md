# natally — agent instructions

Comply with `~/Admin-Manual/` (house SOPs) first; this file is the project-specific layer.

## What this is
natally is a clean-room natal astrology + synastry companion app derived from **Kintsugi and
only Kintsugi** (`~/CascadeProjects/Kintsugi-Unbroken/tauri2/`). Kintsugi is studied for
lessons and anti-patterns; **no code is ported** (D2). No other project is a source or a
reference (D1). The companion (chatbot) and the animated mascot **named natally** are the
core USP (D4, D5, D6). Voice is required, Kokoro, native on all installed platforms, **never
WebView audio** (D7). Full decision log: `DOCS/DECISIONS.md`.

## Phase gates (I2, TC12)
1. `LIBS/UI/FIGMA/` holds the frozen screen set + `DESIGN.md` + `TOKENS.md`. The operator
   **clears it in Figma** before any architecture work. Screens outside the cleared set never
   appear later without re-approval.
2. `DOCS/ARCHITECTURE.md` (entity table with a content-provenance column) + `CHECKLIST.md`
   + `DOCS/TEST_RUBRIC.md` are written after clearance and before any `src/`.
3. Coders execute `CHECKLIST.md` tasks only, marking `[ ]` `[/]` `[X]` ✅; a task is ✅ only
   when its Verify command ran and matched its Accept line.

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
AGPL-3.0-or-later for now, proprietary as the target once the in-house ephemeris replaces Swiss Ephemeris (D9). The ephemeris successor is a pending operator input recorded in `DOCS/DECISIONS.md`.

## Current state
Pre-implementation: governance files, `scripts/update-version.sh`, and the Figma design pass.
No `src/`, no `src-tauri/`, no codegraph index yet (nothing to index).
