# natally — vendored SDK snapshot: `sweph-wasm` (TC7)

Production code comments deep-link **this local snapshot**, never rotting web URLs (TC7).

- **Package:** `sweph-wasm` — npm <https://www.npmjs.com/package/sweph-wasm> —
  repo <https://github.com/ptprashanttripathi/sweph-wasm>
- **Version vendored: 2.6.9** — exact published artifact fetched via unpkg. This is the
  intended dependency pin for `packages/ephemeris` (task P.1).
- **Retrieved:** 2026-09-09.
- **Vendored here:** `README.md` (usage + the supported-house-systems table), `index.d.ts`
  (full type surface, including `HouseSystems` at line 2423), `LICENSE`, `package.json`.
  **Not vendored:** the WASM binary, JS bundles, source maps, and the bundled
  `dist/ephe/seas_*.se1` semiset tables — those arrive via the npm dependency at scaffold
  time; P.1 documents the exact table files it mounts in `packages/ephemeris/src/sweph/tables.ts`.
- **House systems:** the `HouseSystems` union admits 25 uppercase codes (plus a lowercase
  `i` quirk — the product uses uppercase codes only). README mapping: `A` Equal (Asc),
  `B` Alcabitus, `C` Campanus, `D` Equal (MC), `E` Equal, `F` Carter poli-equatorial,
  `G` Gauquelin sectors (36), `H` Azimuthal/Horizontal, `I` Sunshine, `K` Koch,
  `L` Pullen SD, `M` Morinus, `N` Equal/1=Aries, `O` Porphyrius, `P` Placidus,
  `Q` Pullen SR, `R` Regiomontanus, `S` Sripati, `T` Polich/Page, `U` Krusinski-Pisa-Goelzer,
  `V` Equal/Vehlow, `W` Equal/Whole Sign, `X` Axial rotation/Meridian, `Y` APC houses.
  **natally exposes exactly 12** of these — the closed set pinned in `DOCS/ARCHITECTURE.md`
  §6 (adding a 13th chip is a decision-entry event, SC1).
- **License:** the `LICENSE` file is **AGPL-3.0** (661 lines). The README badge claims MIT;
  the license file governs. This is consistent with D9/D14: natally stays
  AGPL-3.0-or-later while `sweph-wasm` is in the dependency tree.
- **Checksums (sha256):**
  - `index.d.ts` — `fe9be7a76f26224794049e29e67eed374c0d75a0841ba63f2bd4937412a8aab7`
  - `README.md` — `fe0797d030df654cd2494fb6ed5a3d069849c90fea60085e7416a93914606ee9`
  - `LICENSE` — `8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef`
  - `package.json` — `386edb9ef83e5d9c0eab624206a80b46c5f393755bec3cfbfcae4cb3395a4844`

## Source assimilation — 2026-09-12

The former docs-only arrangement above is superseded for runtime dependency resolution.
Complete detached repositories now live at root `VENDORED/sweph-wasm/` and its
`swisseph/` child, with the matching published 2.6.9 runtime and all tables. The package
uses `file:../../VENDORED/sweph-wasm`. This directory remains the original documentation
snapshot. See `VENDORED/sweph-wasm.UPSTREAM-VENDOR.lock.json` for source revisions and
`VENDORED/README.md` for local customization and detachment details.
