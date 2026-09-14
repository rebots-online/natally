import { z } from "zod";

/** Closed vocabulary from LIBS/UI/FIGMA/glyphs/glyph-ids.txt. */
export const BodySchema = z.enum([
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
]);
export type Body = z.infer<typeof BodySchema>;

/** Pinned subset of DOCS/sdk/sweph-wasm/index.d.ts:2423 (HouseSystems). */
export const HouseSystemSchema = z.enum([
  "P", // Placidus
  "K", // Koch
  "O", // Porphyry
  "R", // Regiomontanus
  "C", // Campanus
  "A", // Equal (Asc)
  "V", // Vehlow Equal
  "W", // Whole Sign
  "T", // Topocentric (Polich/Page)
  "X", // Meridian (axial rotation)
  "B", // Alcabitius
  "U", // Krusinski-Pisa-Goelzer
]);
export type HouseSystem = z.infer<typeof HouseSystemSchema>;

export const AspectTypeSchema = z.enum([
  "conjunction",
  "opposition",
  "trine",
  "square",
  "sextile",
  "quincunx",
  "semisextile",
]);
export type AspectType = z.infer<typeof AspectTypeSchema>;

const angleSchema = z.number().finite().min(0).lt(360);
const latitudeSchema = z.number().finite().min(-90).max(90);
const orbSchema = z.number().finite().min(0).max(180);

/** UT is a Julian day, as in DOCS/sdk/sweph-wasm/index.d.ts:726. */
export const UTSchema = z.number().finite();
export type UT = z.infer<typeof UTSchema>;

/** Geographic degrees; positive longitude is east, positive latitude north. */
export const PlaceSchema = z.strictObject({
  lat: latitudeSchema,
  lon: z.number().finite().min(-180).max(180),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Angles in degrees; signed longitudinal speed in degrees per day. */
export const EclipticPositionSchema = z.strictObject({
  lon: angleSchema,
  lat: latitudeSchema,
  speed: z.number().finite(),
});
export type EclipticPosition = z.infer<typeof EclipticPositionSchema>;

export const BodyPositionSchema = EclipticPositionSchema.extend({
  body: BodySchema,
});
export type BodyPosition = z.infer<typeof BodyPositionSchema>;

/** A partial input overrides only the supplied defaults; zero is preserved. */
export const OrbTableSchema = z.strictObject({
  conjunction: orbSchema.default(8),
  opposition: orbSchema.default(8),
  trine: orbSchema.default(7),
  square: orbSchema.default(7),
  sextile: orbSchema.default(4),
  quincunx: orbSchema.default(3),
  semisextile: orbSchema.default(2),
});
export type OrbTable = z.infer<typeof OrbTableSchema>;
export type OrbTableOverrides = z.input<typeof OrbTableSchema>;
export const DEFAULT_ORBS: Readonly<OrbTable> = Object.freeze(OrbTableSchema.parse({}));

export const AspectSchema = z.strictObject({
  a: BodySchema,
  b: BodySchema,
  type: AspectTypeSchema,
  orb: orbSchema,
  applying: z.boolean(),
});
export type Aspect = z.infer<typeof AspectSchema>;

/** Exactly twelve cusps in house order, followed by the three chart angles. */
export const HouseCuspsSchema = z.strictObject({
  cusps: z.tuple([
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
    angleSchema,
  ]),
  asc: angleSchema,
  mc: angleSchema,
  armc: angleSchema,
});
export type HouseCusps = z.infer<typeof HouseCuspsSchema>;

export const ChartInputsSchema = z.strictObject({
  ut: z.array(UTSchema).min(1),
  place: PlaceSchema,
  system: HouseSystemSchema,
});
export type ChartInputs = z.infer<typeof ChartInputsSchema>;

export const ChartFactsSchema = z.strictObject({
  // The producer computes this content hash; the seam does not choose a hash algorithm.
  id: z.string().min(1),
  inputs: ChartInputsSchema,
  positions: z.array(BodyPositionSchema),
  // Omission represents unavailable houses; partial house data is invalid.
  cusps: HouseCuspsSchema.optional(),
  aspects: z.array(AspectSchema),
});
export type ChartFacts = z.infer<typeof ChartFactsSchema>;
