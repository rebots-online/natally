// natally — U.3 render-test fixtures. ChartFacts/Person values the tests own:
// cusps strictly ascending modulo 360 (TR-1 invariant mode), primary cusps
// starting at 0° (1st cusp 0° Aries, 10th cusp 270° Capricorn), the overlay
// chart's 1st cusp at 280°, one retrograde body, aspect rows covering both
// applying and separating. Nothing here is derived — these stand in for the
// §6 engine's computed facts.

import type { Aspect, ChartFacts } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";

/** A person with a known birth time (withHouses / timed variants). */
export const PERSON_TIMED: Person = {
  id: "p-robin",
  name: "Robin",
  birth: { date: "1990-05-02", time: "14:32", place: "Malmö", timeKnown: true },
};

/** A person without a birth time (timeUnknown / solar-chart variants). */
export const PERSON_UNTIMED: Person = {
  id: "p-noon",
  name: "Noon",
  birth: { date: "1985-11-20", place: "Leeds", timeKnown: false },
};

/** A second timed person — synastry partner B / overlay chart owner. */
export const PERSON_OVERLAY: Person = {
  id: "p-noor",
  name: "Noor",
  birth: { date: "1985-11-20", time: "09:15", place: "Leeds", timeKnown: true },
};

/** Houses 1–12 cusp longitudes, ascending modulo 360; cusp 1 = 0°, cusp 10 = 270°. */
export const CUSPS = [0, 24, 47, 90, 117, 143, 180, 204, 227, 270, 297, 323] as const;

/** Overlay chart cusps (synastry partner B / today's sky); cusp 1 = 280°. */
export const OVERLAY_CUSPS = [280, 305, 330, 355, 20, 45, 100, 125, 150, 175, 200, 225] as const;

/** Timed natal chart (Placidus, JD 2460000.5 ⇒ 2023-02-25T00:00:00.000Z). */
export const TIMED_FACTS: ChartFacts = {
  id: "chart-fixture-timed",
  inputs: { ut: [2460000.5], place: { lat: 55.6, lon: 13.0 }, system: "P" },
  positions: [
    { body: "sun", lon: 10.5, lat: 0, speed: 0.97 },
    { body: "moon", lon: 100.25, lat: 0, speed: 13.2 },
    { body: "mars", lon: 302, lat: 1.5, speed: -0.45 },
    { body: "saturn", lon: 190.75, lat: 0, speed: -0.08 },
  ],
  cusps: { cusps: [...CUSPS], asc: 0, mc: 270, armc: 268.42 },
  aspects: [
    { a: "sun", b: "moon", type: "square", orb: 0.25, applying: true },
    { a: "sun", b: "saturn", type: "opposition", orb: 0.25, applying: false },
  ],
};

/** The same chart without houses — the honest solar-chart facts (J1/J3). */
export const SOLAR_FACTS: ChartFacts = {
  ...TIMED_FACTS,
  id: "chart-fixture-solar",
  cusps: undefined,
};

/** Overlay chart (whole sign, JD 2460001.5 ⇒ 2023-02-26T00:00:00.000Z). */
export const OVERLAY_FACTS: ChartFacts = {
  id: "chart-fixture-overlay",
  inputs: { ut: [2460001.5], place: { lat: 51.5, lon: -0.12 }, system: "W" },
  positions: [
    { body: "venus", lon: 200, lat: 0, speed: 1.2 },
    { body: "jupiter", lon: 45.5, lat: 0, speed: 0.2 },
  ],
  cusps: { cusps: [...OVERLAY_CUSPS], asc: 280, mc: 175, armc: 174.12 },
  aspects: [],
};

/** Cross-chart aspects (synastry table / today hits), one applying row. */
export const CROSS_ASPECTS: readonly Aspect[] = [
  { a: "sun", b: "venus", type: "trine", orb: 1.5, applying: true },
];

/** A fixture cusp by index; throws honestly if the fixture shrinks. */
export function cuspAt(cusps: readonly number[], index: number): number {
  const value = cusps[index];
  if (value === undefined) {
    throw new Error(`fixture: no cusp at index ${String(index)}`);
  }
  return value;
}
