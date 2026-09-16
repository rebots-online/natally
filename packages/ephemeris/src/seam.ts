import { z } from "zod";
import type {
  Aspect,
  Body,
  ChartFacts,
  EclipticPosition,
  GeoPlace,
  HouseCusps,
  HouseSystem,
  JulianDay,
  OrbTable,
} from "./types";

export * from "./types";

/** Configuration for EphemerisEngine.init — §6: "loads ephemeris tables (lazy, §13)". */
export const EngineConfigSchema = z.object({
  /** Base URL the engine fetches its lazy, sha256-verified, cached ephemeris tables from (§13 mirror contract). */
  tablesUrl: z.string().min(1),
  /** Backend-specific options, opaque to the seam (successor engines register behind the same interface, §6). */
  options: z.record(z.string(), z.unknown()).optional(),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

/**
 * The ephemeris seam (ARCHITECTURE §6, D14 — interface shape normative). Every
 * degree the product shows comes from an implementation of this interface; the
 * pinned incumbent is `sweph-wasm` (id "sweph-wasm"), and any successor engine
 * (in-house ephemeris, astronomy-engine + in-house house math, …) registers
 * behind the same interface with the §6 conformance suite.
 *
 * The anonymous §6 return shapes are the named contract types: position's
 * `{ lon; lat; speed }` is EclipticPosition, cusps' `{ cusps; asc; mc; armc }`
 * is HouseCusps, and §6's `Position` is EclipticPosition.
 */
export interface EphemerisEngine {
  /** Backend identifier, e.g. "sweph-wasm". */
  readonly id: string;
  /** Loads ephemeris tables (lazy, §13: on-demand, sha256-verified, cached). */
  init(cfg: EngineConfig): Promise<void>;
  /** Ecliptic position of a body at a moment (degrees; speed in deg/day). */
  position(body: Body, ut: JulianDay): EclipticPosition;
  /** House cusps and principal angles for a moment, place and house system. */
  cusps(ut: JulianDay, place: GeoPlace, system: HouseSystem): HouseCusps;
  /** Cross-chart aspects (a × b, e.g. natal vs synastry/today) under the given orb allowances; applying/separating derives from speeds. */
  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[];
  /** Backend capability flag: present iff the engine computes Chiron; absent ⇒ the UI shows honest absence, never an estimate (§6). */
  chiron?(ut: JulianDay): EclipticPosition;
}
