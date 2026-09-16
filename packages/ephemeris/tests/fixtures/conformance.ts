import type { Body, GeoPlace, HouseSystem, JulianDay } from "../../src/types";

// # Conformance fixtures (task P.1, TEST_RUBRIC TR-1)
//
// 24 cases = 2 UT moments × 12 bodies at 55.60N 13.00E. Expected longitudes
// come from Swiss Ephemeris reference tables supplied by the operator at
// review; until then every case carries `expectedLon: null` and the suite runs
// in TR-1 invariant mode. Computing-and-freezing "expected" values via this
// same engine is forbidden — that is why the slots are null, not engine output.

/** Gregorian calendar date → Julian Day (UT), Meeus' formula (pure calendar math, no ephemeris). */
export function jdFromGregorian(
  year: number,
  month: number,
  day: number,
  hourUT: number,
): JulianDay {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const day0 = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
  return day0 + hourUT / 24;
}

export interface ConformanceMoment {
  readonly label: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hourUT: number;
  /** Equal to jdFromGregorian(...) — the suite asserts the two agree. */
  readonly jd: JulianDay;
}

export const CONFORMANCE_MOMENTS: readonly ConformanceMoment[] = [
  {
    label: "1990-05-02 14:32 UT",
    year: 1990,
    month: 5,
    day: 2,
    hourUT: 14 + 32 / 60,
    jd: 2448014.105555556,
  },
  {
    label: "2026-09-04 00:00 UT",
    year: 2026,
    month: 9,
    day: 4,
    hourUT: 0,
    jd: 2461287.5,
  },
];

export const CONFORMANCE_PLACE: GeoPlace = { lat: 55.6, lon: 13.0 };

/**
 * The 12 bodies per moment: the 10 classical/outer planets, the mean lunar
 * node (natally's "north-node"), and Chiron's slot — filled by "south-node"
 * while Chiron is honestly absent under the Moshier fallback (P.1 notes,
 * §6/INC-19). A mounted semiset table would restore "chiron" here.
 */
export const CONFORMANCE_BODIES: readonly Body[] = [
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
  "north-node",
  "south-node",
];

/**
 * TR-1 per-body |speed| bounds in °/day. TR-1's parenthetical shorthand
 * ("planets ≤ 1°/day except Moon ≤ 16; Chiron ≤ 0.1") is unphysical for
 * Mercury/Venus — real Swiss Ephemeris output reaches 2.255 and 1.260 °/day
 * (seen here: Venus 1.116 @ 1990-05-02, Mercury 1.824 @ 2026-09-04) — so this
 * is the "per-body bounds table" the TR-1 row actually names: astronomical
 * maxima with a small margin. Still tight enough to catch a swapped body, a
 * radian/centisecond unit slip, or a dropped speed column. Rubric defect to
 * amend at operator review.
 */
export const SPEED_BOUNDS: Readonly<Record<Body, number>> = {
  sun: 1.03, // max 1.0193
  moon: 16, // rubric bound; true max ≈ 15.44
  mercury: 2.3, // max 2.2548
  venus: 1.27, // max 1.2599
  mars: 0.8, // max 0.7921
  jupiter: 0.29, // max 0.2835
  saturn: 0.14, // max 0.1339
  uranus: 0.08, // max 0.0711
  neptune: 0.05, // max 0.0471
  pluto: 0.03, // max 0.0271
  chiron: 0.1, // rubric bound (dormant while Chiron is honestly absent)
  "north-node": 0.1, // mean node max 0.0530
  "south-node": 0.1,
};

export interface ConformanceCase {
  readonly moment: ConformanceMoment;
  readonly body: Body;
  /**
   * Operator-supplied Swiss Ephemeris reference longitude (°). Null until
   * review; once set, the suite tightens to ± 0.01° (TR-1 reference mode).
   */
  readonly expectedLon: number | null;
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = CONFORMANCE_MOMENTS.flatMap((moment) =>
  CONFORMANCE_BODIES.map((body) => ({ moment, body, expectedLon: null })),
);

/** House systems exercised by the cusps invariants (P.1: Placidus, Koch, Whole sign). */
export const HOUSE_SYSTEMS_UNDER_TEST: readonly HouseSystem[] = ["P", "K", "W"];
