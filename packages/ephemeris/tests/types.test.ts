import { expect, it } from "vitest";
import {
  AspectSchema,
  BODIES,
  BodySchema,
  ChartFactsSchema,
  HOUSE_SYSTEMS,
  HouseSystemSchema,
  JulianDaySchema,
  OrbTableSchema,
  type Aspect,
  type ChartFacts,
  type OrbTable,
} from "../src/types";

/** parse → JSON.stringify → parse; contracts must survive a serialization roundtrip unchanged. */
function roundtrip<T>(schema: { parse: (data: unknown) => T }, value: unknown): T {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)) as unknown);
}

const aspectFixture: Aspect = {
  a: "sun",
  b: "moon",
  type: "conjunction",
  orb: 2.5,
  applying: true,
};

// Representative ChartFacts with cusps: all 13 bodies, mixed speeds and aspects.
const fullChart: ChartFacts = {
  id: "sha256:71c0e2d4a9b3f60c",
  inputs: {
    ut: [2460676.5, 2460677.986],
    place: { lat: 52.52, lon: 13.405, elevation: 34 },
    system: "P",
  },
  positions: BODIES.map((body, index) => ({
    body,
    lon: (index * 27.3) % 360,
    lat: (index % 2 === 0 ? 1 : -1) * 0.5,
    speed: index === 3 ? -0.02 : 1.1,
  })),
  cusps: {
    cusps: [
      11.22, 42.87, 73.19, 103.9, 134.32, 164.81, 191.22, 222.87, 253.19, 283.9, 314.32,
      344.81,
    ],
    asc: 11.22,
    mc: 73.19,
    armc: 71.04,
  },
  aspects: [
    aspectFixture,
    { a: "mars", b: "saturn", type: "opposition", orb: 1.25, applying: false },
    { a: "venus", b: "pluto", type: "quincunx", orb: 2.75, applying: true },
    { a: "chiron", b: "north-node", type: "semisextile", orb: 1.5, applying: false },
  ],
};

// Representative ChartFacts without cusps: solar chart, honest absence of houses (§6).
const solarChart: ChartFacts = {
  id: "sha256:9d41b7fa22e5c8d1",
  inputs: {
    ut: [2460676.5],
    place: { lat: 40.7128, lon: -74.006 },
    system: "W",
  },
  positions: [
    { body: "sun", lon: 280.01, lat: -0.02, speed: 1.019 },
    { body: "moon", lon: 122.44, lat: 4.1, speed: 13.176 },
    { body: "south-node", lon: 19.87, lat: 0, speed: -0.053 },
  ],
  aspects: [],
};

it("seam types: schema roundtrip OK", () => {
  // ChartFacts with cusps, and without (solar chart).
  const roundtripped = roundtrip(ChartFactsSchema, fullChart);
  expect(roundtripped).toEqual(fullChart);
  expect(roundtrip(ChartFactsSchema, solarChart)).toEqual(solarChart);

  // OrbTable defaults are the §6 table; explicit entries override them.
  expect(OrbTableSchema.parse({})).toEqual({
    conjunction: 8,
    opposition: 8,
    trine: 7,
    square: 7,
    sextile: 4,
    quincunx: 3,
    semisextile: 2,
  });
  const overridden: OrbTable = roundtrip(OrbTableSchema, {
    conjunction: 10,
    opposition: 10,
    trine: 9,
    square: 9,
    sextile: 6,
    quincunx: 4,
    semisextile: 3,
  });
  expect(overridden.conjunction).toBe(10);

  // Every Body parses and survives the roundtrip, and rides inside ChartFacts.
  for (const body of BODIES) {
    expect(roundtrip(BodySchema, body)).toBe(body);
  }
  expect(roundtripped.positions.map((position) => position.body)).toEqual([...BODIES]);

  // Every HouseSystem string parses and survives the roundtrip, alone and inside ChartFacts.
  for (const system of HOUSE_SYSTEMS) {
    expect(roundtrip(HouseSystemSchema, system)).toBe(system);
    const perSystem: ChartFacts = { ...solarChart, inputs: { ...solarChart.inputs, system } };
    expect(roundtrip(ChartFactsSchema, perSystem).inputs.system).toBe(system);
  }

  // Aspects roundtrip standalone.
  expect(roundtrip(AspectSchema, aspectFixture)).toEqual(aspectFixture);
});

it("rejects out-of-domain bodies, house-system codes and non-finite moments", () => {
  expect(() => BodySchema.parse("earth")).toThrow();
  expect(() => HouseSystemSchema.parse("Y")).toThrow(); // "Y" (APC) is in the sweph-wasm domain, outside the fixed 12
  expect(() => HouseSystemSchema.parse("placidus")).toThrow(); // the union holds engine codes, not display names
  expect(() => OrbTableSchema.parse({ sextile: -1 })).toThrow();
  expect(() => JulianDaySchema.parse(Number.POSITIVE_INFINITY)).toThrow();
  expect(() => ChartFactsSchema.parse({ ...solarChart, aspects: undefined })).toThrow();
});
