import { aspectsBetween } from "../../src/facts";
import type {
  Aspect,
  Body,
  ChartFacts,
  EclipticPosition,
  EngineConfig,
  EphemerisEngine,
  GeoPlace,
  HouseCusps,
  HouseSystem,
  JulianDay,
  OrbTable,
} from "../../src/seam";

// # Deterministic EphemerisEngine fixture (tests only — never imported by src/)
//
// A real injectable EphemerisEngine implementation with fixed longitudes and
// speeds: identical calls always return identical values, so tests can assert
// exact aspects and applying/separating directions. Positions do not vary
// with the moment or place — the fixture is a stand-in backend, not an
// ephemeris; inputs still flow into the builder's content id and cusps call.
//
// Engineered geometry (default §6 orb table):
// - sun 0° (speed 1.0) × moon 3° (speed 13.0): conjunction, orb 3 — the moon
//   outruns the sun, the gap opens ⇒ SEPARATING;
// - sun 0° × mercury 114° (speed 1.5): trine, orb 6 — mercury slower than the
//   sun, the 114° gap closes toward exact ⇒ APPLYING.
// Every other body is placed outside all aspect bands except five incidental
// oppositions (venus–jupiter, mars–chiron, saturn–neptune, uranus–pluto and
// the necessarily opposed lunar nodes), so targeted assertions stay crisp.

/** Fixed longitude/speed table keyed by body; latitude is a constant stand-in. */
const BASE_POSITIONS: Readonly<Record<Body, { lon: number; speed: number }>> = {
  sun: { lon: 0, speed: 1.0 },
  moon: { lon: 3, speed: 13.0 },
  mercury: { lon: 114, speed: 1.5 },
  venus: { lon: 327.5, speed: 1.2 },
  mars: { lon: 80, speed: 0.65 },
  jupiter: { lon: 146.5, speed: 0.08 },
  saturn: { lon: 105, speed: -0.03 },
  uranus: { lon: 131, speed: 0.02 },
  neptune: { lon: 285, speed: 0.01 },
  pluto: { lon: 311.5, speed: -0.01 },
  chiron: { lon: 259, speed: -0.02 },
  "north-node": { lon: 336.5, speed: -0.05 },
  "south-node": { lon: 156.5, speed: 0.05 },
};

const HOUSE_ANGLES: HouseCusps = {
  cusps: [10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  asc: 10,
  mc: 70,
  armc: 68,
};

/**
 * Deterministic seam implementation. `calls` counts engine invocations so
 * tests can prove a cache hit (the counter stays flat when `buildFacts`
 * serves from its injected cache instead of the engine).
 */
export class DeterministicEngine implements EphemerisEngine {
  readonly id = "deterministic-fixture";

  readonly calls = { position: 0, chiron: 0, cusps: 0 };

  async init(_cfg: EngineConfig): Promise<void> {}

  position(body: Body, _ut: JulianDay): EclipticPosition {
    this.calls.position += 1;
    const base = BASE_POSITIONS[body];
    return { lon: base.lon, lat: 0, speed: base.speed };
  }

  cusps(_ut: JulianDay, _place: GeoPlace, _system: HouseSystem): HouseCusps {
    this.calls.cusps += 1;
    return HOUSE_ANGLES;
  }

  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[] {
    return aspectsBetween(a, b, orbs);
  }

  chiron(_ut: JulianDay): EclipticPosition {
    this.calls.chiron += 1;
    const base = BASE_POSITIONS.chiron;
    return { lon: base.lon, lat: 0, speed: base.speed };
  }
}
