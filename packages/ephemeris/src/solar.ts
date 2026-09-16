// # Solar-chart rules (ARCHITECTURE §6 honest-absence rules; task P.2)
//
// Pure derivation of chart inputs from a person's birth data, plus the
// absence-rule assertions and the synastry house-overlay direction predicate
// for the three journey branches (JOURNEYS.md):
//
// - J1 (first light): birth time unknown ⇒ solar chart — no Ascendant, no MC,
//   no house cusps; houses-by-sign only (Sun on the 1st-house cusp by sign).
// - J3 (add a person): same intake semantics — that person's houses are absent
//   everywhere they appear.
// - J4 (synastry): a person without a birth time removes only *their* house
//   overlays; overlays into the other person's houses still compute.
//
// Contract notes (documented per the task block):
//
// - `system` values are the engine one-character codes of the frozen
//   HOUSE_SYSTEMS union (§6): the task's provisional 'WholeSign' resolves to
//   "W" and 'Placidus' to "P" — the same engine-code resolution rule types.ts
//   documents for the house-system set.
// - v1 assumption: stored `birth.date`/`birth.time` are **UTC-civil**. No
//   timezone conversion is applied here (known v1 limitation, mirrored at the
//   §5 entity); the engine seam resolves the resulting ISO instant to a Julian
//   Day downstream. A timed plan's `ut` is therefore `YYYY-MM-DDTHH:mm:00Z`,
//   and a solar plan's `ut` is the date-only `YYYY-MM-DD` with an explicit
//   `time: null` marker — never an invented moment.
// - `PersonInput` is defined here because `@natally/lore` exports `Person`
//   (`@natally/lore/types`) but is not a dependency of `@natally/ephemeris`
//   (the workspace link does not exist, and adding it is outside this task's
//   Owns). The shape is structurally compatible with lore's `PersonSchema`:
//   every lore `Person` whose `timeKnown` flag is consistent with its `time`
//   field is a valid `PersonInput`. An inconsistent one (timeKnown=true with
//   no time string) is rejected at the schema — natally refuses to invent a
//   birth moment. A stray `time` alongside timeKnown=false is tolerated and
//   ignored: the flag drives the honest-absence branch, not the string.
import { z } from "zod";
import { HouseSystemSchema, type ChartFacts, type HouseSystem } from "./types";

// ---------------------------------------------------------------------------
// Person input (structurally compatible with @natally/lore/types Person)
// ---------------------------------------------------------------------------

/** Civil birth date, ISO-8601 `YYYY-MM-DD` (calendar-validity is the engine seam's concern). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Civil birth time, ISO-8601 `HH:MM` (lore's Person granularity). */
const ISO_TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Birth data (§5 Person.birth): `timeKnown` is the flag that drives the
 * honest-absence branches. Refined: `timeKnown=true` requires a `time` string.
 */
export const PersonBirthSchema = z
  .object({
    date: z.string().regex(ISO_DATE_RE),
    time: z.string().regex(ISO_TIME_RE).optional(),
    place: z.string().min(1),
    timeKnown: z.boolean(),
  })
  .refine((birth) => !(birth.timeKnown && birth.time === undefined), {
    message: "timeKnown=true requires birth.time (HH:MM); natally does not invent birth times",
  });
export type PersonBirth = z.infer<typeof PersonBirthSchema>;

/** The person shape chart planning consumes (see module docs re: @natally/lore). */
export const PersonInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  birth: PersonBirthSchema,
});
export type PersonInput = z.infer<typeof PersonInputSchema>;

// ---------------------------------------------------------------------------
// The §6 solar absence rule set
// ---------------------------------------------------------------------------

/** The fixed absence rules a solar chart obeys (§6: no ASC, no MC, no cusps, houses-by-sign only). */
export const SOLAR_ABSENCE_RULES = [
  "no-asc",
  "no-mc",
  "no-house-cusps",
  "houses-by-sign-only",
] as const;
const SolarAbsenceRuleSchema = z.enum(SOLAR_ABSENCE_RULES);
export type SolarAbsenceRule = z.infer<typeof SolarAbsenceRuleSchema>;

// ---------------------------------------------------------------------------
// ChartInputPlan — the person-level decision the engine inputs derive from
// ---------------------------------------------------------------------------

/** Plan for a timed chart: normalized UTC-civil instant, caller's (default Placidus) system. */
export const TimedChartInputPlanSchema = z.object({
  solarHouses: z.literal(false),
  ut: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/),
  system: HouseSystemSchema,
});
export type TimedChartInputPlan = z.infer<typeof TimedChartInputPlanSchema>;

/**
 * Plan for a solar chart (§6): date-only `ut`, explicit `time: null`, Whole
 * Sign ("W") regardless of any requested system (houses-by-sign is inherent,
 * not user-facing config), and the fixed absence rule set.
 */
export const SolarChartInputPlanSchema = z.object({
  solarHouses: z.literal(true),
  ut: z.string().regex(ISO_DATE_RE),
  time: z.null(),
  system: z.literal("W"),
  rules: z.tuple([
    SolarAbsenceRuleSchema,
    SolarAbsenceRuleSchema,
    SolarAbsenceRuleSchema,
    SolarAbsenceRuleSchema,
  ]),
});
export type SolarChartInputPlan = z.infer<typeof SolarChartInputPlanSchema>;

/** Discriminated on `solarHouses`. Distinct from the engine-level `ChartInputs` (JulianDay-based, §6): the plan decides *which* inputs the engine receives. */
export const ChartInputPlanSchema = z.discriminatedUnion("solarHouses", [
  SolarChartInputPlanSchema,
  TimedChartInputPlanSchema,
]);
export type ChartInputPlan = z.infer<typeof ChartInputPlanSchema>;

/**
 * Derive the chart-input plan from a person's birth data (J1/J3 intake).
 * `timeKnown=false` ⇒ solar shape (`{ut: date-only, time: null, system: "W",
 * solarHouses: true, rules}`); `timeKnown=true` ⇒ timed shape (normalized UTC
 * instant, `system` passed through, default "P" Placidus).
 */
export function chartInputs(person: PersonInput, system?: HouseSystem): ChartInputPlan {
  const parsed = PersonInputSchema.parse(person);
  // Validate a requested system even when the solar branch will override it,
  // so contract violations surface at the seam instead of leaking downstream.
  const requested: HouseSystem = system === undefined ? "P" : HouseSystemSchema.parse(system);
  const { date, time, timeKnown } = parsed.birth;
  if (timeKnown) {
    // Unreachable at runtime: PersonBirthSchema.refine guarantees a time here;
    // the guard only narrows the optional for the template below.
    if (time === undefined) {
      throw new Error("unreachable: PersonBirthSchema guarantees birth.time when timeKnown");
    }
    return { solarHouses: false, ut: `${date}T${time}:00Z`, system: requested };
  }
  return {
    solarHouses: true,
    ut: date,
    time: null,
    system: "W",
    rules: [...SOLAR_ABSENCE_RULES],
  };
}

// ---------------------------------------------------------------------------
// Absence assertion
// ---------------------------------------------------------------------------

/** Typed violation of the §6 solar absence rules; `violations` lists each one found. */
export class SolarViolationError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`solar chart violates the §6 absence rules: ${violations.join("; ")}`);
    this.name = "SolarViolationError";
    this.violations = [...violations];
    Object.setPrototypeOf(this, SolarViolationError.prototype);
  }
}

/**
 * Assert that a ChartFacts set obeys the solar absence rules (§6): throws
 * SolarViolationError when house cusps are present (which carries ASC/MC/ARMC
 * in the §6 contracts) or when any body position claims a `house` field. Pure;
 * passes silently on genuinely houseless (solar) facts.
 */
export function assertNoHouses(facts: ChartFacts): void {
  const violations: string[] = [];
  if (facts.cusps !== undefined) {
    violations.push("house cusps present (§6: no cusps, no ASC, no MC on a solar chart)");
  }
  for (const [index, position] of facts.positions.entries()) {
    if (Object.hasOwn(position, "house")) {
      violations.push(
        `position ${index} (${position.body}) claims a house field (§6: houses-by-sign only)`,
      );
    }
  }
  if (violations.length > 0) {
    throw new SolarViolationError(violations);
  }
}

// ---------------------------------------------------------------------------
// Synastry house-overlay directions (J4)
// ---------------------------------------------------------------------------

/**
 * Which synastry house-overlay directions compute (JOURNEYS.md J4: one person
 * without time ⇒ overlays into that person's houses absent; the other
 * direction computed). `aToB` reads "a's planets fall in b's houses" and is
 * computable only when **b** has houses (b.birth.timeKnown); symmetrically for
 * `bToA`. A solar person's WholeSign houses-by-sign never substitutes — §6
 * removes that person's houses everywhere they appear.
 */
export interface HouseOverlayDirections {
  /** a's planets into b's houses — requires b's birth time. */
  aToB: boolean;
  /** b's planets into a's houses — requires a's birth time. */
  bToA: boolean;
}

/**
 * Pure predicate over two persons: returns which overlay directions compute.
 * Does not compute the overlays themselves (that is the synastry layer's job).
 */
export function houseOverlaysForSynastry(a: PersonInput, b: PersonInput): HouseOverlayDirections {
  const parsedA = PersonInputSchema.parse(a);
  const parsedB = PersonInputSchema.parse(b);
  return { aToB: parsedB.birth.timeKnown, bToA: parsedA.birth.timeKnown };
}
