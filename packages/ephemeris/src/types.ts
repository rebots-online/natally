import { z } from "zod";

// # Ephemeris contracts (ARCHITECTURE §6, task T0.5)
//
// Pure data contracts for the EphemerisEngine seam. Every exported type is
// paired with a zod schema: these facts are the Tier-1 computed ground truth
// the fence checker validates companion output against (§7.2), and ChartFacts
// is content-addressed (§5). This module imports nothing outside the package
// except zod.

/** Ecliptic longitude or right ascension in degrees, in [0, 360]. */
export const LongitudeSchema = z.number().min(0).max(360);

/** Ecliptic or geographic latitude in degrees, in [-90, 90], north positive. */
export const LatitudeSchema = z.number().min(-90).max(90);

/**
 * Julian Day in Universal Time (float days). Refined to finite numbers: an
 * infinite or NaN moment is not a moment.
 */
export const JulianDaySchema = z.number().refine(Number.isFinite);
export type JulianDay = z.infer<typeof JulianDaySchema>;

/** Geographic place: degrees (east-positive longitude), optional elevation in metres. */
export const GeoPlaceSchema = z.object({
  lat: LatitudeSchema,
  lon: z.number().min(-180).max(180),
  elevation: z.number().optional(),
});
export type GeoPlace = z.infer<typeof GeoPlaceSchema>;

/**
 * The Body union — 13 members, resolving the §6 "11 bodies + nodes" wording:
 * - the 10 classical/outer bodies: sun … pluto;
 * - "chiron", the 11th body, capability-flagged separately on the seam
 *   (EphemerisEngine.chiron?, §6) because backends may lack it;
 * - the two lunar nodes, "north-node" and "south-node", carried in the same
 *   union but not counted among the 11.
 */
export const BODIES = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "chiron",
  "north-node",
  "south-node",
] as const;
export const BodySchema = z.enum(BODIES);
export type Body = z.infer<typeof BodySchema>;

/** The seven supported aspect types; OrbTable keys are exactly this set. */
export const ASPECT_TYPES = [
  "conjunction",
  "opposition",
  "trine",
  "square",
  "sextile",
  "quincunx",
  "semisextile",
] as const;
export const AspectTypeSchema = z.enum(ASPECT_TYPES);
export type AspectType = z.infer<typeof AspectTypeSchema>;

/**
 * Orb allowances in degrees per aspect type. Field defaults are the §6 orb
 * table (conjunction 8, opposition 8, trine 7, square 7, sextile 4, quincunx 3,
 * semisextile 2); parsing a partial object fills the defaults, parsing a full
 * object overrides them. `defaultOrbTable` is the parsed default.
 */
export const OrbTableSchema = z.object({
  conjunction: z.number().min(0).max(180).default(8),
  opposition: z.number().min(0).max(180).default(8),
  trine: z.number().min(0).max(180).default(7),
  square: z.number().min(0).max(180).default(7),
  sextile: z.number().min(0).max(180).default(4),
  quincunx: z.number().min(0).max(180).default(3),
  semisextile: z.number().min(0).max(180).default(2),
});
export type OrbTable = z.infer<typeof OrbTableSchema>;

/** The §6 default orb table (8/8/7/7/4/3/2). */
export const defaultOrbTable: OrbTable = OrbTableSchema.parse({});

/**
 * Tropical ecliptic position: lon/lat in degrees, speed in degrees/day
 * (negative = retrograde).
 */
export const EclipticPositionSchema = z.object({
  lon: LongitudeSchema,
  lat: LatitudeSchema,
  speed: z.number().refine(Number.isFinite),
});
export type EclipticPosition = z.infer<typeof EclipticPositionSchema>;

/** One body's ecliptic position at the chart moment. */
export const BodyPositionSchema = EclipticPositionSchema.extend({
  body: BodySchema,
});
export type BodyPosition = z.infer<typeof BodyPositionSchema>;

/** An aspect between two bodies, with its orb in degrees and its applying/separating direction (derived from speeds, §6). */
export const AspectSchema = z.object({
  a: BodySchema,
  b: BodySchema,
  type: AspectTypeSchema,
  orb: z.number().min(0).max(180),
  applying: z.boolean(),
});
export type Aspect = z.infer<typeof AspectSchema>;

/** House cusp longitudes in degrees as a fixed 12-tuple, houses 1–12. */
export const CuspLongitudesSchema = z.tuple([
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
  LongitudeSchema,
]);
export type CuspLongitudes = z.infer<typeof CuspLongitudesSchema>;

/** House cusps plus the principal angles: Ascendant and MC longitudes, and the ARMC (right ascension of the MC), in degrees. */
export const HouseCuspsSchema = z.object({
  cusps: CuspLongitudesSchema,
  asc: LongitudeSchema,
  mc: LongitudeSchema,
  armc: LongitudeSchema,
});
export type HouseCusps = z.infer<typeof HouseCuspsSchema>;

/**
 * The 12 house systems natally exposes, identified by their Swiss Ephemeris
 * one-character codes — the `hsys` parameter domain of the pinned incumbent
 * `sweph-wasm` (§6, D14; sweph-wasm@2.6.9 `HouseSystems` union: "A" | "B" |
 * "C" | "D" | "E" | "F" | "G" | "H" | "I" | "i" | "K" | "L" | "M" | "N" | "O" |
 * "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y"). Where the task's
 * provisional codes differed from the engine's, the engine's 1-char code is
 * used (task rule: "if sweph id differs use its 1-char codes"): Meridian = "X"
 * ("M" is Morinus in the domain), Alcabitius = "B" and Vehlow equal = "V" per
 * sweph-wasm's own hsys table. The twelfth entry, "G" (Gauquelin sectors, 36),
 * resolves the provisional "Kroonenhouse-generic" / "GO"? placeholder, which
 * matches no system in the engine domain.
 */
export const HOUSE_SYSTEMS = [
  "P", // Placidus
  "K", // Koch
  "O", // Porphyry ("Porphyrius" in sweph-wasm)
  "R", // Regiomontanus
  "C", // Campanus
  "A", // Equal (cusp 1 = Ascendant; the domain's alias "E" is not in the fixed set)
  "W", // Whole sign ("Equal/Whole Sign" in sweph-wasm)
  "T", // Topocentric (Polich/Page)
  "X", // Meridian ("Axial rotation system/Meridian houses" in sweph-wasm)
  "B", // Alcabitius (sweph-wasm hsys table: "B: Alcabitus")
  "V", // Vehlow equal ("Equal/Vehlow" in sweph-wasm)
  "G", // Gauquelin sectors (36)
] as const;
export const HouseSystemSchema = z.enum(HOUSE_SYSTEMS);
export type HouseSystem = z.infer<typeof HouseSystemSchema>;

/** Authored display names for the fixed 12 (INC-19 provenance `authored`; the union itself holds engine codes). */
export const HOUSE_SYSTEM_NAMES: Readonly<Record<HouseSystem, string>> = {
  P: "Placidus",
  K: "Koch",
  O: "Porphyry",
  R: "Regiomontanus",
  C: "Campanus",
  A: "Equal",
  W: "Whole sign",
  T: "Topocentric",
  X: "Meridian",
  B: "Alcabitius",
  V: "Vehlow equal",
  G: "Gauquelin sectors",
};

/** The computed inputs a chart was cast from (§5: content-addressed by input hash). */
export const ChartInputsSchema = z.object({
  ut: z.array(JulianDaySchema).min(1),
  place: GeoPlaceSchema,
  system: HouseSystemSchema,
});
export type ChartInputs = z.infer<typeof ChartInputsSchema>;

/**
 * The complete computed fact set for one chart (§5/§6, INC-19 provenance
 * `computed`). `id` is the content hash addressing the facts; `cusps` is
 * present only when the birth time is known and the engine returned houses
 * (§6 honest-absence rules — a solar chart has no houses anywhere the person
 * appears).
 */
export const ChartFactsSchema = z.object({
  id: z.string().min(1),
  inputs: ChartInputsSchema,
  positions: z.array(BodyPositionSchema),
  cusps: HouseCuspsSchema.optional(),
  aspects: z.array(AspectSchema),
});
export type ChartFacts = z.infer<typeof ChartFactsSchema>;
