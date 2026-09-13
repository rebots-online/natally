import {
  type Body,
  type BodyPosition,
  BodyPositionSchema,
  type ChartInputs,
  ChartInputsSchema,
  type HouseCusps,
  HouseCuspsSchema,
  type HouseSystem,
  type Place,
  PlaceSchema,
  type UT,
} from "./types.ts";

export type PersonChartInput =
  | {
      timeKnown: true;
      ut: readonly UT[];
      place: Place;
      system: HouseSystem;
    }
  | {
      timeKnown: false;
      /** Calendar date only, YYYY-MM-DD; never an inferred midnight or noon. */
      date: string;
      place: Place;
      /** Stale timed values are ignored when timeKnown is false. */
      ut?: readonly UT[] | null;
      system?: HouseSystem;
    };

export type TimedChartInputs = ChartInputs & { solarHouses: false };

/** Deliberately outside ChartInputs: null UT and WholeSign are not engine inputs. */
export interface SolarChartInputs {
  ut: null;
  date: string;
  place: Place;
  system: "WholeSign";
  solarHouses: true;
}

function dateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Solar inputs require a YYYY-MM-DD date only");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new RangeError("Solar inputs require a valid calendar date");
  }
  return value;
}

export function chartInputs(
  person: Extract<PersonChartInput, { timeKnown: false }>,
): SolarChartInputs;
export function chartInputs(
  person: Extract<PersonChartInput, { timeKnown: true }>,
): TimedChartInputs;
export function chartInputs(person: PersonChartInput): SolarChartInputs | TimedChartInputs;
export function chartInputs(person: PersonChartInput): SolarChartInputs | TimedChartInputs {
  if (person.timeKnown === false) {
    return {
      ut: null,
      date: dateOnly(person.date),
      place: PlaceSchema.parse(person.place),
      system: "WholeSign",
      solarHouses: true,
    };
  }
  if (person.timeKnown !== true) throw new TypeError("timeKnown must be explicit");
  return {
    ...ChartInputsSchema.parse({ ut: person.ut, place: person.place, system: person.system }),
    solarHouses: false,
  };
}

/** Omission/undefined is absence; even empty, null or zero-valued house data is rejected. */
export function assertNoHouses(facts: unknown): void {
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) {
    throw new TypeError("Expected chart facts");
  }
  for (const field of ["cusps", "asc", "mc", "armc"] as const) {
    if (field in facts && (facts as Record<string, unknown>)[field] !== undefined) {
      throw new Error(`Unknown birth time forbids ${field}`);
    }
  }
}

export interface HouseOverlay {
  body: Body;
  /** One-based house number, 1 through 12. */
  house: number;
}

/**
 * Solar houses are sign membership relative to the supplied Sun's sign, never
 * ascendant-based cusps. This function neither chooses a UT nor computes positions.
 * Missing Sun means no available solar houses.
 */
export function solarHousesBySign(
  positions: readonly BodyPosition[],
): (HouseOverlay & { signIndex: number })[] {
  const validated = positions.map((position) => BodyPositionSchema.parse(position));
  const sun = validated.find((position) => position.body === "sun");
  if (!sun) return [];
  const firstSign = Math.floor(sun.lon / 30);
  return validated.map((position) => {
    const signIndex = Math.floor(position.lon / 30);
    return { body: position.body, signIndex, house: ((signIndex - firstSign + 12) % 12) + 1 };
  });
}

export interface OverlayChart {
  timeKnown: boolean;
  facts: { positions: readonly BodyPosition[]; cusps?: HouseCusps };
}

function targetCusps(chart: OverlayChart): HouseCusps["cusps"] | null {
  if (chart.timeKnown === false) {
    assertNoHouses(chart.facts);
    return null;
  }
  if (chart.timeKnown !== true) throw new TypeError("timeKnown must be explicit");
  // Known time alone cannot supply missing calculated houses.
  const { cusps } = HouseCuspsSchema.parse(chart.facts.cusps);
  let wraps = 0;
  for (let i = 0; i < 12; i++) {
    const start = cusps[i]!;
    const end = cusps[(i + 1) % 12]!;
    if (start === end) throw new RangeError("House cusps must bound nonempty houses");
    if (end < start) wraps++;
  }
  if (wraps !== 1) throw new RangeError("House cusps must follow zodiac order once");
  return cusps;
}

function overlay(
  positions: readonly BodyPosition[],
  cusps: HouseCusps["cusps"] | null,
): HouseOverlay[] {
  if (cusps === null) return [];
  return positions.map((position) => {
    const { body, lon } = BodyPositionSchema.parse(position);
    // Start-inclusive/end-exclusive intervals handle exact cusps and 360 -> 0.
    const index = cusps.findIndex((start, i) => {
      const end = cusps[(i + 1) % 12]!;
      return start < end ? lon >= start && lon < end : lon >= start || lon < end;
    });
    if (index < 0) throw new RangeError("Position is outside the supplied houses");
    return { body, house: index + 1 };
  });
}

/**
 * aInB = A's planets in B's houses; bInA is the reverse. Only the receiving
 * person's time controls each direction. Solar sign houses never substitute for
 * missing natal houses. Unknown/unknown yields two empty directions.
 */
export function directionalHouseOverlays(
  a: OverlayChart,
  b: OverlayChart,
): { aInB: HouseOverlay[]; bInA: HouseOverlay[] } {
  const aCusps = targetCusps(a);
  const bCusps = targetCusps(b);
  return { aInB: overlay(a.facts.positions, bCusps), bInA: overlay(b.facts.positions, aCusps) };
}
