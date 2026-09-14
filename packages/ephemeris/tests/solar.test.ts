import { describe, expect, it } from "vitest";
import {
  assertNoHouses,
  chartInputs,
  directionalHouseOverlays,
  type OverlayChart,
  type PersonChartInput,
  solarHousesBySign,
} from "../src/solar.ts";
import {
  type Body,
  type BodyPosition,
  ChartInputsSchema,
  type HouseCusps,
  HouseSystemSchema,
} from "../src/types.ts";

const place = { lat: 43.65, lon: -79.38 };
const timed = { timeKnown: true, ut: [2451545], place, system: "W" } as const;
const untimed = { timeKnown: false, date: "2000-01-01", place } as const;
const position = (body: Body, lon: number): BodyPosition => ({ body, lon, lat: 0, speed: 1 });
const aPositions = [position("sun", 5), position("moon", 35)];
const bPositions = [position("venus", 95), position("mars", 359)];
const aCusps: HouseCusps = {
  cusps: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  asc: 0,
  mc: 270,
  armc: 270,
};
const bCusps: HouseCusps = {
  cusps: [20, 50, 80, 110, 140, 170, 200, 230, 260, 290, 320, 350],
  asc: 20,
  mc: 290,
  armc: 290,
};

function pair(aKnown: boolean, bKnown: boolean): [OverlayChart, OverlayChart] {
  return [
    { timeKnown: aKnown, facts: { positions: aPositions, ...(aKnown ? { cusps: aCusps } : {}) } },
    { timeKnown: bKnown, facts: { positions: bPositions, ...(bKnown ? { cusps: bCusps } : {}) } },
  ];
}

describe("solar: absence rules hold for J1/J3/J4 branches", () => {
  describe("chartInputs", () => {
    it("keeps known UTs and the engine W code without changing the person", () => {
      const person = Object.freeze({
        ...timed,
        ut: Object.freeze([0, 2451545]),
        place: Object.freeze({ ...place }),
      });
      const inputs = chartInputs(person);
      expect(inputs).toEqual({ ut: [0, 2451545], place, system: "W", solarHouses: false });
      expect(inputs.ut).not.toBe(person.ut);
      expect(inputs.place).not.toBe(person.place);
      expect(HouseSystemSchema.parse(inputs.system)).toBe("W");
    });

    it.each(HouseSystemSchema.options)("preserves known-time system %s", (system) => {
      expect(chartInputs({ ...timed, system }).system).toBe(system);
    });

    it("preserves the date only, not a UT, with the literal solar label WholeSign", () => {
      const inputs = chartInputs(untimed);
      expect(inputs).toEqual({
        ut: null,
        date: "2000-01-01",
        place,
        system: "WholeSign",
        solarHouses: true,
      });
      expect(inputs.place).not.toBe(untimed.place);
      expect(() => assertNoHouses(inputs)).not.toThrow();
      // Passing this branch directly to the timed engine is intentionally invalid.
      expect(ChartInputsSchema.safeParse(inputs).success).toBe(false);
      expect(HouseSystemSchema.safeParse(inputs.system).success).toBe(false);
    });

    it.each([null, [], [0], [2451545], [Number.NaN]].map((ut) => ({ ut })))(
      "ignores stale unknown-time UT $ut",
      ({ ut }) => {
        expect(chartInputs({ ...untimed, ut, system: "P" })).toEqual(chartInputs(untimed));
      },
    );

    it("never reads a supplied instant or system for an unknown time", () => {
      const person = Object.freeze({
        ...untimed,
        get ut(): number[] {
          throw new Error("must not read a stale instant");
        },
        get system(): "P" {
          throw new Error("must not read a stale house system");
        },
      });
      expect(chartInputs(person)).toEqual(chartInputs(untimed));
    });

    it.each(["2000-02-29", "2024-02-29", "1900-02-28", "2026-12-31"])(
      "retains calendar date %s",
      (date) => {
        expect(chartInputs({ ...untimed, date }).date).toBe(date);
      },
    );

    it.each([
      "",
      "2000-01-01T12:00:00Z",
      "2000-01-01T00:00:00-05:00",
      "2000-1-1",
      "1900-02-29",
      "2025-02-29",
      "2026-04-31",
      "2026-00-10",
      "2026-13-10",
      "2026-01-00",
    ])("rejects non-calendar/date-time input %s without normalizing it", (date) => {
      expect(() => chartInputs({ ...untimed, date })).toThrow();
    });

    it.each([[], [Number.NaN], [Infinity]].map((ut) => ({ ut })))(
      "rejects missing/invalid UTs for known time $ut",
      ({ ut }) => {
        expect(() => chartInputs({ ...timed, ut })).toThrow();
      },
    );

    it("rejects an unspecified timeKnown flag", () => {
      const person = { ut: [2451545], place, system: "W" } as unknown as PersonChartInput;
      expect(() => chartInputs(person)).toThrow("timeKnown");
    });
  });

  describe("assertNoHouses", () => {
    it("accepts omitted houses and solar membership by sign", () => {
      const facts = Object.freeze({
        positions: aPositions,
        housesBySign: solarHousesBySign(aPositions),
      });
      expect(() => assertNoHouses(facts)).not.toThrow();
      expect(() =>
        assertNoHouses({ cusps: undefined, asc: undefined, mc: undefined, armc: undefined }),
      ).not.toThrow();
    });

    it.each([aCusps, aCusps.cusps, [0], [], 0, null].map((cusps) => ({ cusps })))(
      "rejects every supplied cusp container $cusps",
      ({ cusps }) => {
        expect(() => assertNoHouses({ positions: aPositions, cusps })).toThrow("cusps");
      },
    );

    it.each(["asc", "mc", "armc"])("rejects %s even at zero degrees", (field) => {
      expect(() => assertNoHouses({ [field]: 0 })).toThrow(field);
      expect(() => assertNoHouses({ [field]: 123 })).toThrow(field);
      expect(() => assertNoHouses({ [field]: null })).toThrow(field);
    });

    it.each([null, undefined, [], 0, "missing"].map((facts) => ({ facts })))(
      "rejects invalid facts $facts",
      ({ facts }) => {
        expect(() => assertNoHouses(facts)).toThrow("Expected chart facts");
      },
    );
  });

  describe("solar houses by sign", () => {
    it.each(Array.from({ length: 12 }, (_, index) => index))(
      "covers all signs with Sun in sign %i",
      (sunSign) => {
        const positions = [position("sun", sunSign * 30 + 29.9)];
        for (let sign = 0; sign < 12; sign++) positions.push(position("moon", sign * 30));
        const houses = solarHousesBySign(positions);
        expect(houses[0]).toEqual({ body: "sun", signIndex: sunSign, house: 1 });
        const expectedSigns = Array.from({ length: 12 }, (_, offset) => (sunSign + offset) % 12);
        for (const [offset, signIndex] of expectedSigns.entries()) {
          expect(houses[signIndex + 1]).toEqual({ body: "moon", signIndex, house: offset + 1 });
        }
        for (const house of houses) expect(() => assertNoHouses(house)).not.toThrow();
      },
    );

    it("uses sign boundaries, not thirty-degree intervals from the Sun's degree", () => {
      expect(
        solarHousesBySign([
          position("sun", 359.9),
          position("moon", 330),
          position("venus", 0),
          position("mars", 29.999),
          position("jupiter", 30),
        ]),
      ).toEqual([
        { body: "sun", signIndex: 11, house: 1 },
        { body: "moon", signIndex: 11, house: 1 },
        { body: "venus", signIndex: 0, house: 2 },
        { body: "mars", signIndex: 0, house: 2 },
        { body: "jupiter", signIndex: 1, house: 3 },
      ]);
    });

    it("leaves solar houses absent when no Sun position is available", () => {
      expect(solarHousesBySign([])).toEqual([]);
      expect(solarHousesBySign([position("moon", 10)])).toEqual([]);
    });

    it.each([-1, 360, Number.NaN, Infinity])("rejects an invalid supplied longitude %s", (lon) => {
      expect(() => solarHousesBySign([position("sun", lon)])).toThrow();
    });
  });

  describe("directional overlays", () => {
    it.each([
      {
        journey: "J1 known/known",
        aKnown: true,
        bKnown: true,
        aInB: [
          { body: "sun", house: 12 },
          { body: "moon", house: 1 },
        ],
        bInA: [
          { body: "venus", house: 4 },
          { body: "mars", house: 12 },
        ],
      },
      {
        journey: "J3 unknown/known",
        aKnown: false,
        bKnown: true,
        aInB: [
          { body: "sun", house: 12 },
          { body: "moon", house: 1 },
        ],
        bInA: [],
      },
      {
        journey: "J4 known/unknown",
        aKnown: true,
        bKnown: false,
        aInB: [],
        bInA: [
          { body: "venus", house: 4 },
          { body: "mars", house: 12 },
        ],
      },
      {
        journey: "J3/J4 unknown/unknown",
        aKnown: false,
        bKnown: false,
        aInB: [],
        bInA: [],
      },
    ])(
      "$journey removes only the unknown person's receiving houses",
      ({ aKnown, bKnown, aInB, bInA }) => {
        const [a, b] = pair(aKnown, bKnown);
        expect(directionalHouseOverlays(a, b)).toEqual({ aInB, bInA });
        expect(directionalHouseOverlays(b, a)).toEqual({ aInB: bInA, bInA: aInB });
      },
    );

    it.each(bCusps.cusps)("assigns the exact cusp %s to its starting house", (lon) => {
      const [a, b] = pair(false, true);
      a.facts.positions = [position("sun", lon)];
      const index = bCusps.cusps.indexOf(lon);
      expect(directionalHouseOverlays(a, b).aInB).toEqual([{ body: "sun", house: index + 1 }]);
      a.facts.positions = [position("sun", (lon + 360 - 0.001) % 360)];
      expect(directionalHouseOverlays(a, b).aInB).toEqual([
        { body: "sun", house: index === 0 ? 12 : index },
      ]);
    });

    it("uses supplied unequal cusps, including the interval across zero", () => {
      const [a, b] = pair(false, true);
      a.facts.positions = [
        position("sun", 0),
        position("moon", 19.99),
        position("venus", 20),
        position("mars", 359.99),
      ];
      b.facts.cusps = {
        ...bCusps,
        cusps: [350, 20, 55, 90, 130, 160, 190, 220, 250, 280, 310, 335],
      };
      expect(directionalHouseOverlays(a, b)).toEqual({
        aInB: [
          { body: "sun", house: 1 },
          { body: "moon", house: 1 },
          { body: "venus", house: 2 },
          { body: "mars", house: 1 },
        ],
        bInA: [],
      });
    });

    it.each([0, 1])("rejects stale houses for unknown person %i", (index) => {
      const charts = pair(false, false);
      charts[index]!.facts.cusps = aCusps;
      expect(() => directionalHouseOverlays(...charts)).toThrow("cusps");
    });

    it.each(["asc", "mc", "armc"])("rejects a stray unknown-time %s", (field) => {
      const [a, b] = pair(false, true);
      Object.assign(a.facts, { [field]: 0 });
      expect(() => directionalHouseOverlays(a, b)).toThrow(field);
    });

    it("requires actual houses for a known-time target", () => {
      const [a, b] = pair(false, true);
      b.facts = { positions: bPositions };
      expect(() => directionalHouseOverlays(a, b)).toThrow();
    });

    it("rejects empty or unordered house intervals", () => {
      const [a, b] = pair(false, true);
      b.facts.cusps = {
        ...bCusps,
        cusps: [20, 20, 80, 110, 140, 170, 200, 230, 260, 290, 320, 350],
      };
      expect(() => directionalHouseOverlays(a, b)).toThrow("nonempty houses");
      b.facts.cusps = {
        ...bCusps,
        cusps: [20, 80, 50, 110, 140, 170, 200, 230, 260, 290, 320, 350],
      };
      expect(() => directionalHouseOverlays(a, b)).toThrow("zodiac order");
    });

    it("does not mutate inputs and returns independent results on repeated calls", () => {
      const charts = pair(true, true);
      for (const chart of charts) {
        chart.facts = {
          positions: Object.freeze(chart.facts.positions.map((item) => Object.freeze({ ...item }))),
          cusps: { ...chart.facts.cusps!, cusps: [...chart.facts.cusps!.cusps] },
        };
        Object.freeze(chart.facts.cusps!.cusps);
        Object.freeze(chart.facts.cusps);
        Object.freeze(chart.facts);
        Object.freeze(chart);
      }
      const first = directionalHouseOverlays(...charts);
      const second = directionalHouseOverlays(...charts);
      expect(first).toEqual(second);
      first.aInB[0]!.house = 7;
      expect(second.aInB[0]).toEqual({ body: "sun", house: 12 });
      const solarPositions = Object.freeze(aPositions.map((item) => Object.freeze({ ...item })));
      expect(solarHousesBySign(solarPositions)).toEqual(solarHousesBySign(aPositions));
    });
  });
});
