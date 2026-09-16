// natally — presentation math over ChartFacts (U.3 Atlas). These helpers only
// regroup or format facts the engine already computed (§6: computed facts come
// from the EphemerisEngine) — no new astronomical quantities are derived here.
// All formulas are exact and documented; nothing is estimated.

import type { ZodiacSign } from "@natally/design-tokens";
import type {
  ChartFacts,
  CuspLongitudes,
  EclipticPosition,
  GeoPlace,
} from "@natally/ephemeris/types";
import { normalizeDeg, SIGNS } from "../../ui/wheel";

/** The sign a longitude falls in (aries = 0°–30° … pisces = 330°–360°). */
export function signOf(lon: number): ZodiacSign {
  const index = Math.floor(normalizeDeg(lon) / 30);
  const sign = SIGNS[index];
  if (sign === undefined) {
    throw new Error(`chart-math: no sign for longitude ${String(lon)}`);
  }
  return sign;
}

/** Degrees within the sign, [0, 30). */
export function degreeInSign(lon: number): number {
  return normalizeDeg(lon) % 30;
}

/**
 * The house a longitude falls in: house i (1-based) spans
 * [cusp_i, cusp_{i+1}) around the wheel, so the answer is the cusp whose
 * forward distance to the longitude is smallest. Exact for every house
 * system (unequal houses included).
 */
export function houseOf(lon: number, cusps: CuspLongitudes): number {
  let bestIndex = 0;
  let bestDistance = 360;
  cusps.forEach((cusp, index) => {
    const distance = normalizeDeg(lon - cusp);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
}

/** Whether a body is retrograde: negative daily speed (§6). */
export function isRetrograde(position: EclipticPosition): boolean {
  return position.speed < 0;
}

/** "14.32°" — the computed degree-in-sign with two decimals. */
export function formatDegree(lon: number): string {
  return `${degreeInSign(lon).toFixed(2)}°`;
}

/** "+0.97°/d" / "−0.08°/d" — signed daily speed. */
export function formatSpeed(speed: number): string {
  return `${speed >= 0 ? "+" : ""}${speed.toFixed(3)}°/d`;
}

/** "55.60°N 13.00°E" — the chart place as computed-fact coordinates. */
export function formatPlace(place: GeoPlace): string {
  const ns = place.lat >= 0 ? "N" : "S";
  const ew = place.lon >= 0 ? "E" : "W";
  return `${Math.abs(place.lat).toFixed(2)}°${ns} ${Math.abs(place.lon).toFixed(2)}°${ew}`;
}

/**
 * ISO UTC timestamp of the chart moment. Exact epoch arithmetic: Unix epoch
 * starts at JD 2440587.5 (1970-01-01T00:00:00Z).
 */
export function chartMomentIso(facts: ChartFacts): string {
  const jd = facts.inputs.ut[0];
  if (jd === undefined) {
    throw new Error("chart-math: ChartFacts.inputs.ut is empty");
  }
  return new Date((jd - 2440587.5) * 86400000).toISOString();
}
