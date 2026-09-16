// Solar absence rules, task P.2 — exhaustive tests for the three journey
// branches (JOURNEYS.md): J1 first light, J3 add a person, J4 synastry.
// Accept: solar: absence rules hold for J1/J3/J4 branches
import { expect, it } from "vitest";
import {
  SOLAR_ABSENCE_RULES,
  SolarViolationError,
  assertNoHouses,
  chartInputs,
  houseOverlaysForSynastry,
  ChartInputPlanSchema,
  type PersonInput,
} from "../src/solar";
import type { ChartFacts, HouseSystem } from "../src/types";

// -- People (§5 Person.birth shape) -----------------------------------------

const known: PersonInput = {
  id: "p-you",
  name: "You",
  birth: { date: "1990-06-15", time: "14:30", place: "Berlin", timeKnown: true },
};

const unknown: PersonInput = {
  id: "p-sam",
  name: "Sam",
  birth: { date: "1985-11-03", place: "Lisbon", timeKnown: false },
};

// Stray time alongside timeKnown=false: the flag drives the branch, not the string.
const strayTime: PersonInput = {
  id: "p-sam",
  name: "Sam",
  birth: { date: "1985-11-03", time: "08:15", place: "Lisbon", timeKnown: false },
};

// -- ChartFacts fixtures (§6 contracts) --------------------------------------

const solarFacts: ChartFacts = {
  id: "sha256:9d41b7fa22e5c8d1",
  inputs: { ut: [2460676.5], place: { lat: 40.7128, lon: -74.006 }, system: "W" },
  positions: [
    { body: "sun", lon: 280.01, lat: -0.02, speed: 1.019 },
    { body: "moon", lon: 122.44, lat: 4.1, speed: 13.176 },
  ],
  aspects: [],
};

const cuspsFacts: ChartFacts = {
  ...solarFacts,
  inputs: { ...solarFacts.inputs, system: "P" },
  cusps: {
    cusps: [11.22, 42.87, 73.19, 103.9, 134.32, 164.81, 191.22, 222.87, 253.19, 283.9, 314.32, 344.81],
    asc: 11.22,
    mc: 73.19,
    armc: 71.04,
  },
};

// A rogue position claiming a house field is not expressible in the §6
// BodyPosition type — it only exists as a runtime shape, so build it outside
// the type and slip it in through a variable (freshness drops, assignability holds).
const rogue = { body: "sun", lon: 280.01, lat: -0.02, speed: 1.019, house: 7 } as const;
const withHouseField: ChartFacts = { ...solarFacts, positions: [rogue] };
const withCuspsAndHouseField: ChartFacts = { ...cuspsFacts, positions: [rogue] };

// Capture a thrown error for inspection of its typed payload.
function caughtBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

it("solar: absence rules hold for J1/J3/J4 branches", () => {
  // --- J1 — first light: unknown time ⇒ solar shape, honest absence ---------
  expect(chartInputs(unknown)).toEqual({
    solarHouses: true,
    ut: "1985-11-03",
    time: null,
    system: "W",
    rules: [...SOLAR_ABSENCE_RULES],
  });
  // A stray time string never leaks into the solar plan: the flag decides.
  expect(chartInputs(strayTime)).toEqual(chartInputs(unknown));
  // A requested system is validated but overridden: houses-by-sign is inherent.
  expect(chartInputs(unknown, "K")).toMatchObject({ system: "W", solarHouses: true });
  // The plan satisfies its own discriminated contract.
  expect(ChartInputPlanSchema.parse(chartInputs(unknown))).toEqual(chartInputs(unknown));

  // J1 timed side: date+time normalized under the v1 UTC-civil assumption.
  expect(chartInputs(known)).toEqual({ solarHouses: false, ut: "1990-06-15T14:30:00Z", system: "P" });
  expect(chartInputs(known, "K")).toEqual({ solarHouses: false, ut: "1990-06-15T14:30:00Z", system: "K" });
  // Out-of-domain codes are refused at the seam even though the static type
  // already blocks them (the cast simulates an unvalidated runtime value).
  expect(() => chartInputs(known, "placidus" as HouseSystem)).toThrow();
  // timeKnown=true without a time string is refused, never silently downgraded.
  expect(() =>
    chartInputs({ ...known, birth: { ...known.birth, time: undefined } }),
  ).toThrow(/does not invent birth times/);

  // assertNoHouses passes on genuinely houseless (solar) facts...
  expect(() => assertNoHouses(solarFacts)).not.toThrow();
  // ...and throws typed on cusps...
  const cuspsError = caughtBy(() => assertNoHouses(cuspsFacts));
  expect(cuspsError).toBeInstanceOf(SolarViolationError);
  const typedCuspsError = cuspsError as SolarViolationError;
  expect(typedCuspsError.name).toBe("SolarViolationError");
  expect(typedCuspsError.violations).toHaveLength(1);
  expect(typedCuspsError.violations.join("; ")).toContain("cusps");
  // ...on a position claiming a house field...
  const houseError = caughtBy(() => assertNoHouses(withHouseField));
  expect(houseError).toBeInstanceOf(SolarViolationError);
  expect((houseError as SolarViolationError).violations.join("; ")).toContain("house field");
  // ...and collects both violations when both are present.
  const bothError = caughtBy(() => assertNoHouses(withCuspsAndHouseField));
  expect((bothError as SolarViolationError).violations).toHaveLength(2);

  // --- J3 — add a person: the same intake, houses absent everywhere ---------
  const secondPerson: PersonInput = {
    id: "p-lexi",
    name: "Lexi",
    birth: { date: "1992-02-29", place: "Porto", timeKnown: false },
  };
  expect(chartInputs(secondPerson)).toEqual({
    solarHouses: true,
    ut: "1992-02-29",
    time: null,
    system: "W",
    rules: [...SOLAR_ABSENCE_RULES],
  });
  // Lexi's solar facts carry no houses anywhere she appears.
  expect(() => assertNoHouses(solarFacts)).not.toThrow();
  // Both people without time: no overlay direction computes at all.
  expect(houseOverlaysForSynastry(unknown, secondPerson)).toEqual({ aToB: false, bToA: false });

  // --- J4 — synastry: one known + one unknown ⇒ asymmetric overlays ---------
  // a known (You), b unknown (Sam): overlays into SAM's houses are absent,
  // overlays into YOUR houses still compute.
  expect(houseOverlaysForSynastry(known, unknown)).toEqual({ aToB: false, bToA: true });
  // Swapped: the absence follows the person, not the argument order.
  expect(houseOverlaysForSynastry(unknown, known)).toEqual({ aToB: true, bToA: false });
  // Both known: both directions compute.
  expect(houseOverlaysForSynastry(known, { ...known, id: "p-lexi", name: "Lexi" })).toEqual({
    aToB: true,
    bToA: true,
  });
});
