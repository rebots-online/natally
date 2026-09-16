import type { HouseSystems } from "sweph-wasm";
import type { HouseSystem } from "../types";

// # sweph-wasm table map (task P.1, ARCHITECTURE §6 + §13)
//
// What the pinned incumbent backend needs on its mount path, and how natally's
// HouseSystem codes translate to its `hsys` chars. Pure documentation of the
// incumbent's contract — no computation lives here.

/** One Swiss Ephemeris data table the production lazy mount (§13) loads from `EngineConfig.tablesUrl`. */
export interface EphemerisTable {
  /** File name exactly as Swiss Ephemeris expects it on the mount path. */
  readonly file: string;
  /** Gregorian year span the file covers. */
  readonly span: string;
  /** What natally computes from this file. */
  readonly covers: string;
}

/**
 * The semiset table map (P.1): the exact `se1` files production mounts.
 *
 * - `sepl_18.se1` + `semo_18.se1` are the classic Swiss Ephemeris "semiset"
 *   (planets + Moon) for 1800–2399.
 * - `seas_18.se1` adds the main asteroid set incl. 2060 Chiron — mounted only
 *   so the engine's `chiron` capability can exist (§6: absent ⇒ glyph shows
 *   honest absence, never an estimate).
 *
 * sha256 verification is owned by the §13 mirror manifest (`manifest.json`),
 * not hardcoded here. sweph-wasm bundles only `seas_*.se1` asteroid slices in
 * its own `dist/ephe/` and its `swe_set_ephe_path()` defaults to a public CDN;
 * natally never uses that default (offline/privacy mandate) — production
 * mounts exactly the files below from `cfg.tablesUrl`.
 */
export const SEMISET_TABLES: readonly EphemerisTable[] = [
  { file: "sepl_18.se1", span: "1800–2399", covers: "Sun–Pluto and the mean lunar node (planets)" },
  { file: "semo_18.se1", span: "1800–2399", covers: "Moon" },
  {
    file: "seas_18.se1",
    span: "1800–2399",
    covers: "Main asteroids incl. 2060 Chiron (engine `chiron` capability)",
  },
] as const;

/**
 * `EngineConfig.options.mode` value selecting the Moshier fallback: Swiss
 * Ephemeris' built-in analytic ephemeris (flag `SEFLG_MOSEPH`), which reads
 * no table files at all. It covers Sun–Pluto and the lunar nodes but has no
 * asteroids, so `chiron` stays honestly absent in this mode. Conformance
 * fixtures run in this mode (no network fetch of table files at test time).
 */
export const MOSHIER_MODE = "moshier";

/**
 * natally HouseSystem → sweph-wasm `hsys` char. The natally union already
 * stores the engine's 1-char codes (types.ts, decided in T0.5), so this map is
 * the identity — kept explicit as the single translation point a successor
 * engine (D14) replaces with its own table.
 */
export const SWEPH_HSYS: Readonly<Record<HouseSystem, HouseSystems>> = {
  P: "P", // Placidus
  K: "K", // Koch
  O: "O", // Porphyry
  R: "R", // Regiomontanus
  C: "C", // Campanus
  A: "A", // Equal (cusp 1 = Ascendant)
  W: "W", // Whole sign
  T: "T", // Topocentric (Polich/Page)
  X: "X", // Meridian
  B: "B", // Alcabitius
  V: "V", // Vehlow equal
  G: "G", // Gauquelin sectors (36)
};
