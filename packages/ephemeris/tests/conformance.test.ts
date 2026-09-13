import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SwephEngine } from "../src/sweph/engine.ts";
import { SWEPH_TABLES, SWEPH_WASM } from "../src/sweph/tables.ts";
import {
  type ChartFacts,
  DEFAULT_ORBS,
  EclipticPositionSchema,
  HouseCuspsSchema,
  HouseSystemSchema,
} from "../src/types.ts";
import {
  CONFORMANCE_CASES,
  CONFORMANCE_DATES,
  fetchVendoredAsset,
  VENDORED_ASSET_ROOT,
} from "./fixtures/sweph-conformance.ts";

function normalize(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function signedAngle(angle: number): number {
  return normalize(angle + 180) - 180;
}

function expectAngle(angle: number): void {
  expect(Number.isFinite(angle)).toBe(true);
  expect(angle).toBeGreaterThanOrEqual(0);
  expect(angle).toBeLessThan(360);
}

describe("sweph backend: 24 cases, invariants hold", () => {
  const engine = new SwephEngine();
  const requests: string[] = [];
  let completed = 0;
  const config = {
    assetRoot: VENDORED_ASSET_ROOT,
    fetch: async (url: URL) => {
      requests.push(url.href);
      return fetchVendoredAsset(url);
    },
  };

  beforeAll(async () => {
    expect(CONFORMANCE_CASES).toHaveLength(24);
    for (const iso of CONFORMANCE_DATES) {
      const cases = CONFORMANCE_CASES.filter((fixture) => fixture.iso === iso);
      expect(new Set(cases.map(({ body }) => body)).size).toBe(12);
      expect(cases.map(({ system }) => system).sort()).toEqual(
        [...HouseSystemSchema.options].sort(),
      );
    }
    expect(requests).toHaveLength(0);
    expect(() => engine.position("sun", 2440587.5)).toThrow("not initialized");
    await expect(engine.init({})).rejects.toThrow("explicit assetRoot");
    await Promise.all([engine.init(config), engine.init(config)]);
    await engine.init(config);
    expect(requests.sort()).toEqual(
      [SWEPH_WASM, ...SWEPH_TABLES]
        .map(({ path }) => new URL(path, VENDORED_ASSET_ROOT).href)
        .sort(),
    );
    expect(() => engine.position("sun", 2378495.5)).toThrow("1800–2400");
    expect(() => engine.position("sun", 2597641.5)).toThrow("1800–2400");
    // A negative native result must not expose the vendor's polar house fallback.
    expect(() => engine.cusps(2461287.5, { lat: 89, lon: 13 }, "P")).toThrow("unavailable");
  }, 30000);

  it.each(CONFORMANCE_CASES)("$iso / $body / houses $system", (fixture) => {
    const { body, ut, place, system, maxSpeed } = fixture;
    const position = engine.position(body, ut);
    expect(EclipticPositionSchema.safeParse(position).success).toBe(true);
    expectAngle(position.lon);
    expect(Number.isFinite(position.speed)).toBe(true);
    expect(Math.abs(position.speed)).toBeLessThanOrEqual(maxSpeed);
    // Internal derivative consistency, not an independent positional reference.
    const step = 0.001;
    const motion = signedAngle(
      engine.position(body, ut + step).lon - engine.position(body, ut - step).lon,
    );
    expect(Math.abs(motion / (2 * step) - position.speed)).toBeLessThan(0.01);

    const houses = engine.cusps(ut, place, system);
    expect(HouseCuspsSchema.safeParse(houses).success).toBe(true);
    expect(houses.cusps).toHaveLength(12);
    let winding = 0;
    for (let i = 0; i < houses.cusps.length; i++) {
      const current = houses.cusps[i];
      const next = houses.cusps[(i + 1) % 12];
      if (current === undefined || next === undefined) throw new Error("Missing house cusp");
      expectAngle(current);
      const advance = normalize(next - current);
      expect(advance).toBeGreaterThan(0);
      expect(advance).toBeLessThan(180);
      winding += advance;
      if (system === "A" || system === "V" || system === "W") expect(advance).toBeCloseTo(30, 8);
      if (system === "W") expect(current % 30).toBeCloseTo(0, 8);
    }
    expect(winding).toBeCloseTo(360, 8);
    for (const angle of [houses.asc, houses.mc, houses.armc]) expectAngle(angle);
    expect(Math.abs(signedAngle(houses.mc - houses.asc))).toBeLessThanOrEqual(180);
    if (system === "A")
      expect(Math.abs(signedAngle(houses.cusps[0] - houses.asc))).toBeLessThan(1e-8);

    if (body === "chiron") expect(engine.chiron(ut)).toEqual(position);
    if (body === "north-node") {
      const south = engine.position("south-node", ut);
      expect(EclipticPositionSchema.safeParse(south).success).toBe(true);
      expect(normalize(south.lon - position.lon)).toBeCloseTo(180, 8);
      expect(south.lat).toBeCloseTo(-position.lat, 8);
      expect(south.speed).toBeCloseTo(position.speed, 8);
    }

    // Use real positions inside complete ChartFacts; no precomputed aspect output.
    const chart: ChartFacts = {
      id: `conformance:${fixture.iso}:${body}`,
      inputs: { ut: [ut], place, system },
      positions: [{ body, ...position }],
      cusps: houses,
      aspects: [],
    };
    const future: ChartFacts = {
      ...chart,
      id: `${chart.id}:next`,
      inputs: { ut: [ut + step], place, system },
      positions: [{ body, ...engine.position(body, ut + step) }],
    };
    expect(engine.aspects(chart, chart, { ...DEFAULT_ORBS })).toEqual([]);
    expect(
      engine.aspects(chart, { ...chart, id: `${chart.id}:copy` }, { ...DEFAULT_ORBS }),
    ).toEqual([{ a: body, b: body, type: "conjunction", orb: 0, applying: false }]);
    const aspects = engine.aspects(chart, future, { ...DEFAULT_ORBS });
    expect(aspects).toHaveLength(1);
    for (const aspect of aspects) {
      const right = future.positions[0];
      if (!right) throw new Error("Missing comparison position");
      expect(aspect.a).toBe(body);
      expect(aspect.b).toBe(body);
      expect(aspect.type).toBe("conjunction");
      expect(aspect.orb).toBeCloseTo(Math.abs(signedAngle(right.lon - position.lon)), 8);
      expect(aspect.orb).toBeLessThanOrEqual(DEFAULT_ORBS[aspect.type]);
    }
    completed++;
  });

  afterAll(() => {
    if (completed === 24) console.info("sweph backend: 24 cases, invariants hold");
  });
});
