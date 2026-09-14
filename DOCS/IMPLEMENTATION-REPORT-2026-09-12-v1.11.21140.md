# Implementation report — 2026-09-12 — v1.11.21140

The approved checklist is in execution. This checkpoint supplies the detached
ephemeris source, the workspace's app and native entry points, shared contracts,
configuration, design tokens, and a working local Swiss Ephemeris adapter.

## Root VENDORED and upstream detachment

`VENDORED/sweph-wasm/` contains the complete wrapper repository at 2.6.9
(`0583463e4c4f4791e19f2a9f1962d2d965e021ab`), its published runtime, and the complete
Swiss Ephemeris repository in `swisseph/`
(`fa78b5065810fa9077e96475e33decb8f3ecd61c`). The import manifest records 651 original
files, their SHA-256 values, source archive hashes, and runtime SHA-512 integrity.

These are ordinary natally-owned files. There is no nested `.git`, Git submodule,
gitlink, or upstream branch tracking. The former `.gitmodules` is retained as inert
`UPSTREAM-SUBMODULES.txt`. Origin URLs, revisions, dates, licenses, and the import
method remain in `VENDORED/sweph-wasm.UPSTREAM-VENDOR.lock.json`, following
Admin-Manual INC-15. Both license files remain intact.

The upstream build downloader previously fetched C files from upstream `master`.
It now checks the adjacent local source only, so it cannot overwrite customizations.
The original downloader and the local assimilation patch are preserved under
`VENDORED/patches/`. `scripts/vendor-ephemeris.py` leaves an existing snapshot untouched
and applies the detachment patch when creating a missing initial snapshot.
Original archives remain in `~/outbox/natally/upstream-archives/` on this host.

The ephemeris package resolves `file:../../VENDORED/sweph-wasm`. Runtime binary and
table assets use Forgejo Git LFS. Upstream computational source has not been changed;
the matching published WASM is used. A future computational source customization
must rebuild that local WASM before app packaging.

## Implemented checklist work

- **T0.2:** React/Vite app entry, real loading/error states, strict TypeScript,
  root-environment loading, configured development port, and retained build outputs.
- **T0.3:** Tauri/Rust shell and extensible native command registration, with shared
  mobile entry, native dependencies, capability declarations, and initial icons.
- **T0.4/T0.8:** all 36 frozen design variables, generated TypeScript values, and the
  prescribed token-mirror verification. CSS hex case is normalized without changing
  colour values.
- **T0.5/T0.6/T0.7:** ephemeris, lore/conversation, export, and billing schemas/interfaces.
  Exports preserve chart recomputation inputs; turns preserve optional person and DOM
  actions. Ephemeris aspects accept complete `ChartFacts`; billing availability is
  synchronous and restore returns a token or null, as specified.
- **T0.10:** validated frozen runtime configuration. Fork name, namespace, artifact
  slug, app URL, landing URL, and development port originate in root `.env`;
  `.env.example` provides defaults. Blank payment rails remain unavailable, trial
  configuration is validated, and private environment values are not exported.
- **P.1:** local WASM initialization with byte/hash verification, local 1800–2400
  tables, planetary positions, Chiron, 12 house systems, and aspect calculation.
  Initialization supplies local assets explicitly and rejects calculation fallback.
- **R.6:** the canonical version script stamps the monorepo's JavaScript, Cargo,
  Tauri, and generated Android version surfaces; Tauri identity comes from `.env`.
  Its `--check` mode is read-only. Current stamp is `1.11.21140`, versionCode `100011`.

The UI shell/primitives task is also implemented: eight route names, seven
primitives, the supplied 35-symbol glyph sprite, version display, and honest absence
states for screens awaiting their feature tasks. Configuration and later features
still need their prescribed integration tasks before release.

## Observed verification

- Root Vitest execution of ephemeris, billing, lore types, and design-token tasks:
  **6 files, 309 tests passed**, including the **24 real local ephemeris cases**.
- UI route/primitives integration: **3 files, 16 tests passed**, including history,
  stale lazy-route results, and accessibility behavior.
- Design-token generator: **6 tests passed** and
  `tokens.css in sync with TOKENS.md (36 vars)`.
- App standalone entry and all three contract-package TypeScript checks: no diagnostics.
- Scoped Biome checks passed after formatting the delivered files.
- Native `cargo check`: `Finished dev profile` with zero errors at the current stamp.
- Version check: `version check: consistent (1.11.21140; versionCode 100011)`.
- Existing vendor import rerun preserved the source; the saved detachment patch
  reverse dry-run matched the actual customized files.

The ephemeris cases check the checklist's prescribed invariants. They do not claim
independent numerical conformance against an external reference dataset.

## Continuing work

The remaining checklist covers storage, charts and screens, companion inference,
voice, billing execution, assets, integration, and release packaging/deployment.
This checkpoint is not a public release or a SHIP-READY rubric verdict. The goal
continues through the full platform artifact set and `natally.robin.mba` deployment.

Pre-marker architecture/checklist copies for this checkpoint are preserved in
`~/outbox/natally/2026-09-12-v1.11.21140/`; prior dated reports remain in `DOCS/`.
