import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import type { HouseSystems } from "../../../DOCS/sdk/sweph-wasm/index.d.ts";
import {
  type Aspect,
  AspectSchema,
  AspectTypeSchema,
  type Body,
  BodyPositionSchema,
  BodySchema,
  type ChartFacts,
  ChartFactsSchema,
  ChartInputsSchema,
  DEFAULT_ORBS,
  type EclipticPosition,
  EclipticPositionSchema,
  EphemerisConfigSchema,
  type EphemerisEngine,
  EphemerisEngineSchema,
  type HouseCusps,
  HouseCuspsSchema,
  type HouseSystem,
  HouseSystemSchema,
  type OrbTable,
  type OrbTableOverrides,
  OrbTableSchema,
  PlaceSchema,
  UTSchema,
} from "../src/seam.ts";

const houses: HouseCusps = {
  cusps: [350, 20, 50, 80, 110, 140, 170, 200, 230, 260, 290, 320],
  asc: 350,
  mc: 260,
  armc: 259.5,
};

const factContent: Omit<ChartFacts, "id"> = {
  inputs: { ut: [2451545, 2451545.041666667], place: { lat: 43.6532, lon: -79.3832 }, system: "P" },
  positions: [
    { body: "sun", lon: 280.368, lat: 0, speed: 1.019 },
    { body: "moon", lon: 190, lat: -3.25, speed: 13.2 },
    { body: "north-node", lon: 125, lat: 0, speed: -0.053 },
    { body: "south-node", lon: 305, lat: 0, speed: -0.053 },
  ],
  cusps: houses,
  aspects: [{ a: "sun", b: "moon", type: "square", orb: 0.368, applying: true }],
};

const facts: ChartFacts = {
  id: createHash("sha256").update(JSON.stringify(factContent)).digest("hex"),
  ...factContent,
};

function roundtrip<T>(schema: z.ZodType<T>, value: T): T {
  try {
    return schema.parse(JSON.parse(JSON.stringify(value)));
  } catch (error) {
    throw new Error("Schema JSON roundtrip failed", { cause: error });
  }
}

describe("closed ephemeris vocabulary", () => {
  it("uses every supplied body glyph without inventing an extra body", () => {
    const expected = [
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
    ];
    const glyphs = readFileSync(
      new URL("../../../LIBS/UI/FIGMA/glyphs/glyph-ids.txt", import.meta.url),
      "utf8",
    )
      .trim()
      .split(/\r?\n/u);
    expect(BodySchema.options).toEqual(expected);
    for (const body of expected) {
      expect(glyphs).toContain(`g-${body}`);
      expect(BodySchema.parse(body)).toBe(body);
    }
  });

  it.each(["earth", "ceres", "lilith", "Sun", "north_node", ""])(
    "rejects unlisted body %j",
    (body) => {
      expect(BodySchema.safeParse(body).success).toBe(false);
    },
  );

  it("pins all twelve house codes to the vendored SDK union", () => {
    expectTypeOf<HouseSystem>().toExtend<HouseSystems>();
    expect(HouseSystemSchema.options).toEqual([
      "P",
      "K",
      "O",
      "R",
      "C",
      "A",
      "V",
      "W",
      "T",
      "X",
      "B",
      "U",
    ]);
    for (const code of HouseSystemSchema.options) expect(HouseSystemSchema.parse(code)).toBe(code);
  });

  it.each(["D", "E", "G", "H", "I", "i", "N", "p", "Placidus", ""])(
    "rejects unpinned house %j",
    (code) => {
      expect(HouseSystemSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe("positions, places and universal time", () => {
  it("preserves retrograde and stationary speed and normalized boundary angles", () => {
    for (const speed of [-13.2, 0, 15]) {
      const position = { lon: 359.999999, lat: -90, speed };
      expect(roundtrip(EclipticPositionSchema, position)).toEqual(position);
    }
    expect(EclipticPositionSchema.parse({ lon: 0, lat: 90, speed: 0 })).toEqual({
      lon: 0,
      lat: 90,
      speed: 0,
    });
  });

  it.each([
    { lon: -0.001, lat: 0, speed: 1 },
    { lon: 360, lat: 0, speed: 1 },
    { lon: Number.NaN, lat: 0, speed: 1 },
    { lon: 1, lat: -90.001, speed: 1 },
    { lon: 1, lat: 90.001, speed: 1 },
    { lon: 1, lat: 0, speed: Infinity },
    { lon: 1, lat: 0, speed: -Infinity },
    { lon: "1", lat: 0, speed: 1 },
    { lon: 1, lat: 0 },
  ])("rejects malformed ecliptic position %j", (position) => {
    expect(EclipticPositionSchema.safeParse(position).success).toBe(false);
  });

  it("requires a listed body on chart positions", () => {
    expect(BodyPositionSchema.safeParse({ body: "moon", lon: 0, lat: 0, speed: 13 }).success).toBe(
      true,
    );
    expect(BodyPositionSchema.safeParse({ lon: 0, lat: 0, speed: 13 }).success).toBe(false);
    expect(BodyPositionSchema.safeParse({ body: "earth", lon: 0, lat: 0, speed: 13 }).success).toBe(
      false,
    );
  });

  it("validates signed geographic degrees separately from ecliptic longitude", () => {
    expect(PlaceSchema.parse({ lat: -90, lon: -180 })).toEqual({ lat: -90, lon: -180 });
    expect(PlaceSchema.parse({ lat: 90, lon: 180 })).toEqual({ lat: 90, lon: 180 });
    for (const place of [
      { lat: 91, lon: 0 },
      { lat: 0, lon: 181 },
      { lat: 0, lon: -181 },
      { lat: NaN, lon: 0 },
    ]) {
      expect(PlaceSchema.safeParse(place).success).toBe(false);
    }
  });

  it("preserves finite fractional Julian days and requires at least one input instant", () => {
    for (const ut of [-1, 0, 2451545.125]) expect(UTSchema.parse(ut)).toBe(ut);
    for (const ut of [NaN, Infinity, -Infinity, "2451545.125"])
      expect(UTSchema.safeParse(ut).success).toBe(false);
    expect(ChartInputsSchema.safeParse({ ...facts.inputs, ut: [] }).success).toBe(false);
    expect(ChartInputsSchema.safeParse({ ...facts.inputs, ut: [Infinity] }).success).toBe(false);
  });
});

describe("orb and aspect contracts", () => {
  it("provides the seven specified defaults and independent partial overrides", () => {
    const expected = {
      conjunction: 8,
      opposition: 8,
      trine: 7,
      square: 7,
      sextile: 4,
      quincunx: 3,
      semisextile: 2,
    };
    expect(OrbTableSchema.parse({})).toEqual(expected);
    expect(DEFAULT_ORBS).toEqual(expected);
    expect(Object.isFrozen(DEFAULT_ORBS)).toBe(true);
    const override: OrbTableOverrides = { conjunction: 0, square: 5.5 };
    const parsed = OrbTableSchema.parse(override);
    expect(parsed).toEqual({ ...expected, conjunction: 0, square: 5.5 });
    parsed.trine = 1;
    expect(OrbTableSchema.parse({})).toEqual(expected);
    expect(DEFAULT_ORBS).toEqual(expected);
    expect(override).toEqual({ conjunction: 0, square: 5.5 });
    expect(roundtrip(OrbTableSchema, expected)).toEqual(expected);
  });

  it.each([-1, 180.001, Infinity, NaN, "8", null])("rejects invalid orb override %j", (orb) => {
    for (const type of AspectTypeSchema.options) {
      expect(OrbTableSchema.safeParse({ [type]: orb }).success).toBe(false);
    }
  });

  it("rejects unlisted aspect types and preserves applying versus separating", () => {
    expect(AspectTypeSchema.options).toEqual([
      "conjunction",
      "opposition",
      "trine",
      "square",
      "sextile",
      "quincunx",
      "semisextile",
    ]);
    for (const type of AspectTypeSchema.options) {
      for (const applying of [true, false]) {
        const aspect: Aspect = { a: "sun", b: "moon", type, orb: 0, applying };
        expect(roundtrip(AspectSchema, aspect)).toEqual(aspect);
      }
    }
    const aspect = { a: "sun", b: "moon", type: "trine", orb: 2, applying: false };
    expect(AspectSchema.safeParse({ ...aspect, type: "quintile" }).success).toBe(false);
    expect(AspectSchema.safeParse({ ...aspect, applying: "false" }).success).toBe(false);
    expect(AspectSchema.safeParse({ ...aspect, a: "earth" }).success).toBe(false);
    expect(AspectSchema.safeParse({ ...aspect, orb: -1 }).success).toBe(false);
    expect(OrbTableSchema.safeParse({ quintile: 2 }).success).toBe(false);
  });
});

describe("chart facts", () => {
  it("represents house cusps as a twelve-element tuple without assuming sorted longitude", () => {
    expectTypeOf<HouseCusps["cusps"]["length"]>().toEqualTypeOf<12>();
    expect(roundtrip(HouseCuspsSchema, houses)).toEqual(houses);
    expect(HouseCuspsSchema.safeParse({ ...houses, cusps: houses.cusps.slice(1) }).success).toBe(
      false,
    );
    expect(HouseCuspsSchema.safeParse({ ...houses, cusps: [...houses.cusps, 0] }).success).toBe(
      false,
    );
    expect(
      HouseCuspsSchema.safeParse({ ...houses, cusps: [360, ...houses.cusps.slice(1)] }).success,
    ).toBe(false);
    for (const field of ["asc", "mc", "armc"] as const) {
      expect(HouseCuspsSchema.safeParse({ ...houses, [field]: undefined }).success).toBe(false);
      expect(HouseCuspsSchema.safeParse({ ...houses, [field]: Infinity }).success).toBe(false);
    }
  });

  it("permits absent houses and aspects without manufacturing data", () => {
    const { cusps: omitted, ...withoutHouses } = facts;
    expect(omitted).toEqual(houses);
    const parsed = roundtrip(ChartFactsSchema, { ...withoutHouses, aspects: [] });
    expect(parsed).not.toHaveProperty("cusps");
    expect(parsed.aspects).toEqual([]);
    expect(ChartFactsSchema.safeParse({ ...facts, cusps: null }).success).toBe(false);
  });

  it("rejects incomplete and corrupt nested chart facts", () => {
    for (const invalid of [
      { ...facts, id: "" },
      { ...facts, id: undefined },
      { ...facts, inputs: { ...facts.inputs, system: "G" } },
      { ...facts, inputs: { ...facts.inputs, place: { lat: 100, lon: 0 } } },
      { ...facts, positions: [{ body: "sun", lon: 360, lat: 0, speed: 1 }] },
      { ...facts, cusps: { cusps: houses.cusps } },
      { ...facts, aspects: [{ a: "sun", b: "moon", type: "square", orb: 1 }] },
      { ...facts, compatibilityScore: 99 },
    ])
      expect(ChartFactsSchema.safeParse(invalid).success).toBe(false);
  });

  it("seam types: schema roundtrip OK", () => {
    expectTypeOf<z.infer<typeof ChartFactsSchema>>().toEqualTypeOf<ChartFacts>();
    expectTypeOf<z.infer<typeof EclipticPositionSchema>>().toEqualTypeOf<EclipticPosition>();
    expectTypeOf<z.infer<typeof BodySchema>>().toEqualTypeOf<Body>();
    expectTypeOf<z.infer<typeof OrbTableSchema>>().toEqualTypeOf<OrbTable>();
    const parsed = roundtrip(ChartFactsSchema, facts);
    expect(parsed).toEqual(facts);
    expect(parsed.id).toBe(createHash("sha256").update(JSON.stringify(factContent)).digest("hex"));
    expect(parsed).not.toBe(facts);
    expect(parsed.positions).not.toBe(facts.positions);
    expect(parsed.inputs.ut).toEqual(facts.inputs.ut);
    console.info("seam types: schema roundtrip OK");
  });
});

describe("EphemerisEngine seam validation", () => {
  function engineFixture() {
    // Deliberately non-calculating callables: validating a contract must never execute them.
    const notCalled = () => {
      throw new Error("Validation must not call the engine");
    };
    return {
      id: "contract-test",
      init: vi.fn<EphemerisEngine["init"]>(notCalled),
      position: vi.fn<EphemerisEngine["position"]>(notCalled),
      cusps: vi.fn<EphemerisEngine["cusps"]>(notCalled),
      aspects: vi.fn<EphemerisEngine["aspects"]>(notCalled),
    } satisfies EphemerisEngine;
  }

  it("accepts engines with or without Chiron and preserves object identity", () => {
    const engine = engineFixture();
    expect(EphemerisEngineSchema.parse(engine)).toBe(engine);
    expect(engine.init).not.toHaveBeenCalled();
    expect(engine.position).not.toHaveBeenCalled();
    expect(engine.cusps).not.toHaveBeenCalled();
    expect(engine.aspects).not.toHaveBeenCalled();
    const withChiron = { ...engine, chiron: vi.fn<NonNullable<EphemerisEngine["chiron"]>>() };
    expect(EphemerisEngineSchema.parse(withChiron)).toBe(withChiron);
    expect(withChiron.chiron).not.toHaveBeenCalled();
  });

  it("passes complete ChartFacts to the aspects method and preserves its result", () => {
    expectTypeOf<EphemerisEngine["aspects"]>().toEqualTypeOf<
      (a: ChartFacts, b: ChartFacts, orbs: OrbTable) => Aspect[]
    >();
    const a = roundtrip(ChartFactsSchema, facts);
    const b = roundtrip(ChartFactsSchema, facts);
    const orbs = OrbTableSchema.parse({ square: 5 });
    const expected = facts.aspects.map((aspect) => AspectSchema.parse(aspect));
    const engine = engineFixture();
    // Contract fixture only: the calculation adapter reads each chart's positions.
    engine.aspects.mockImplementation((left, right, table) => {
      expect(left.positions).toBe(a.positions);
      expect(right.positions).toBe(b.positions);
      expect(table).toBe(orbs);
      return expected;
    });
    const parsed = EphemerisEngineSchema.parse(engine);
    expect(parsed.aspects(a, b, orbs)).toBe(expected);
    expect(engine.aspects).toHaveBeenCalledExactlyOnceWith(a, b, orbs);
  });

  it("preserves class prototypes and private state when validating adapters", () => {
    class IdentityFixture {
      #id = "prototype-contract-test";
      get id() {
        return this.#id;
      }
      init = engineFixture().init;
      position = engineFixture().position;
      cusps = engineFixture().cusps;
      aspects = engineFixture().aspects;
    }
    const engine = new IdentityFixture();
    const parsed = EphemerisEngineSchema.parse(engine);
    expect(parsed).toBe(engine);
    expect(parsed).toBeInstanceOf(IdentityFixture);
    expect(parsed.id).toBe("prototype-contract-test");
  });

  it("rejects missing or non-callable required methods and invalid optional Chiron", () => {
    for (const method of ["init", "position", "cusps", "aspects"] as const) {
      expect(
        EphemerisEngineSchema.safeParse({ ...engineFixture(), [method]: undefined }).success,
      ).toBe(false);
      expect(EphemerisEngineSchema.safeParse({ ...engineFixture(), [method]: 42 }).success).toBe(
        false,
      );
    }
    for (const invalid of [
      null,
      [],
      {},
      { ...engineFixture(), id: "" },
      { ...engineFixture(), chiron: false },
    ]) {
      expect(EphemerisEngineSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts adapter-owned initialization data without prescribing engine-specific settings", () => {
    const cfg = { tablePath: "/ephemeris", precision: 64 };
    expect(EphemerisConfigSchema.parse({})).toEqual({});
    expect(EphemerisConfigSchema.parse(cfg)).toEqual(cfg);
    expect(EphemerisConfigSchema.safeParse(null).success).toBe(false);
    expect(EphemerisConfigSchema.safeParse([]).success).toBe(false);
  });
});
