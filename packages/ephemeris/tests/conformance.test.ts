import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import SwissephModuleFactory from "sweph-wasm/wasm/swisseph";
import { beforeAll, expect, it } from "vitest";
import { SwephEngine } from "../src/sweph/engine";
import type { HouseCusps } from "../src/types";
import {
  CONFORMANCE_CASES,
  CONFORMANCE_MOMENTS,
  CONFORMANCE_PLACE,
  HOUSE_SYSTEMS_UNDER_TEST,
  jdFromGregorian,
  SPEED_BOUNDS,
} from "./fixtures/conformance";

// # P.1 conformance — sweph-wasm backend, TR-1 invariant mode
//
// Runs the REAL wasm (no mocks). Swiss Ephemeris reference longitudes are not
// supplied yet, so per TR-1 the suite asserts invariants only; it tightens to
// ± 0.01° per case the moment the operator's numbers land in the fixtures.

// The emscripten glue cannot fetch the wasm under node (its fallbacks are
// browser-only), so the test loads the package's own swisseph.wasm bytes and
// hands them to the engine through the same host-injection point production
// uses (options.createWasmModule, the §13 lazy-load seam).
const require_ = createRequire(import.meta.url);
const wasmBytes = readFileSync(
  join(dirname(require_.resolve("sweph-wasm")), "wasm", "swisseph.wasm"),
);
const wasmBinary = new ArrayBuffer(wasmBytes.byteLength);
new Uint8Array(wasmBinary).set(wasmBytes);

let engine: SwephEngine;

beforeAll(async () => {
  engine = new SwephEngine();
  await engine.init({
    tablesUrl: "tests-run-moshier-no-tables",
    options: {
      mode: "moshier",
      createWasmModule: () => SwissephModuleFactory({ wasmBinary }),
    },
  });
});

function cuspAt(houses: HouseCusps, house: number): number {
  const cusp = houses.cusps[house - 1];
  if (cusp === undefined) {
    throw new Error(`fixture error: house ${house} missing from cusps tuple`);
  }
  return cusp;
}

function firstMoment(): (typeof CONFORMANCE_MOMENTS)[number] {
  const moment = CONFORMANCE_MOMENTS[0];
  if (moment === undefined) {
    throw new Error("fixture error: no conformance moments");
  }
  return moment;
}

/** Signed shortest arc (-180, 180] between two longitudes. */
function shortestArc(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

it("sweph backend: 24 cases, invariants hold", () => {
  // The fixture embeds exactly 24 cases: 2 UT moments × 12 bodies.
  expect(CONFORMANCE_CASES).toHaveLength(24);

  for (const { moment, body, expectedLon } of CONFORMANCE_CASES) {
    // Fixture JDs are independent calendar math, not engine output.
    expect(jdFromGregorian(moment.year, moment.month, moment.day, moment.hourUT)).toBeCloseTo(
      moment.jd,
      9,
    );

    const position = engine.position(body, moment.jd);
    // TR-1 invariant mode: lon ∈ [0, 360), |speed| within per-body bounds.
    expect(position.lon).toBeGreaterThanOrEqual(0);
    expect(position.lon).toBeLessThan(360);
    expect(Math.abs(position.speed)).toBeLessThanOrEqual(SPEED_BOUNDS[body]);
    expect(Number.isFinite(position.lat)).toBe(true);

    // Tightens automatically once the operator's reference numbers land.
    if (expectedLon !== null) {
      expect(Math.abs(position.lon - expectedLon)).toBeLessThanOrEqual(0.01);
    }
  }
});

it("chiron is honestly absent under the Moshier fallback (§6, INC-19)", () => {
  expect(engine.chiron).toBeUndefined();
  expect(() => engine.position("chiron", firstMoment().jd)).toThrow(/honest absence/);
});

it("cusps ascend modulo 360 and asc/mc agree for P, K and W at both moments", () => {
  for (const moment of CONFORMANCE_MOMENTS) {
    for (const system of HOUSE_SYSTEMS_UNDER_TEST) {
      const houses = engine.cusps(moment.jd, CONFORMANCE_PLACE, system);

      // TR-1: cusps strictly ascending modulo 360.
      for (let house = 1; house <= 12; house++) {
        const current = cuspAt(houses, house);
        const next = cuspAt(houses, (house % 12) + 1);
        const forward = (((next - current) % 360) + 360) % 360;
        expect(forward, `${system} @ ${moment.label} house ${house}`).toBeGreaterThan(0);
      }

      // TR-1: |normalize(mc − asc)| ≤ 180.
      expect(Math.abs(shortestArc(houses.asc, houses.mc))).toBeLessThanOrEqual(180);

      // Indexing guards: quadrant systems anchor cusp 1 to the Ascendant and
      // cusp 10 to the MC; whole sign starts the Ascendant's sign at cusp 1.
      if (system === "P" || system === "K") {
        expect(cuspAt(houses, 1)).toBeCloseTo(houses.asc, 6);
        expect(cuspAt(houses, 10)).toBeCloseTo(houses.mc, 6);
      }
      if (system === "W") {
        const offset = (((houses.asc - cuspAt(houses, 1)) % 360) + 360) % 360;
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(30);
      }
    }
  }
});

it("determinism: identical moments give identical results (P.4)", () => {
  const moment = CONFORMANCE_MOMENTS[1];
  if (moment === undefined) {
    throw new Error("fixture error: no conformance moments");
  }
  const sun = engine.position("sun", moment.jd);
  expect(engine.position("sun", moment.jd)).toEqual(sun);
  const houses = engine.cusps(moment.jd, CONFORMANCE_PLACE, "P");
  expect(engine.cusps(moment.jd, CONFORMANCE_PLACE, "P")).toEqual(houses);
});
