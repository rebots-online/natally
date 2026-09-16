import SwissEPH from "sweph-wasm";
import type { SwissephModule } from "sweph-wasm/wasm/swisseph";
import type { EngineConfig, EphemerisEngine } from "../seam";
import {
  ASPECT_TYPES,
  type Aspect,
  AspectSchema,
  type AspectType,
  BODIES,
  type Body,
  type BodyPosition,
  type ChartFacts,
  type EclipticPosition,
  EclipticPositionSchema,
  type GeoPlace,
  type HouseCusps,
  HouseCuspsSchema,
  type HouseSystem,
  type JulianDay,
  type OrbTable,
} from "../types";
import { MOSHIER_MODE, SEMISET_TABLES, SWEPH_HSYS } from "./tables";

// # sweph-wasm backend (task P.1, ARCHITECTURE §6 — the pinned incumbent, D14)
//
// Swiss Ephemeris compiled to WebAssembly behind the EphemerisEngine seam.
// - position: swe_calc_ut with SEFLG_SPEED (speed flags on).
// - cusps:    swe_houses_ex, one `hsys` char per HouseSystem (SWEPH_HSYS).
// - tables:   lazy mount of the SEMISET_TABLES map from cfg.tablesUrl (§13), or
//             the Moshier fallback (`options.mode = "moshier"`) that reads no
//             files — the conformance suite's mode (no network at test time).
// - chiron:   capability flag (§6): assigned by init only when the asteroid
//             table is mounted; absent ⇒ honest absence, never an estimate.
// - wasm load: `options.createWasmModule` (host-injected loader, e.g. the §13
//             sha256-verified cached wasm) or SwissEPH.init()'s own
//             module-relative fetch. Tests inject the real wasm bytes the same
//             way a host would; no mocks anywhere.

/** Swiss Ephemeris planet numbers per the sweph-wasm typings (SE_SUN…SE_CHIRON; stable public API). */
const BODY_IPL: Readonly<Record<Exclude<Body, "south-node">, number>> = {
  sun: 0,
  moon: 1,
  mercury: 2,
  venus: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
  pluto: 9,
  "north-node": 10, // SE_MEAN_NODE
  chiron: 15, // SE_CHIRON — requires the mounted seas_18.se1 table
};

/** Base angle (°) of each of the seven supported aspects. */
const ASPECT_ANGLES: Readonly<Record<AspectType, number>> = {
  conjunction: 0,
  opposition: 180,
  trine: 120,
  square: 90,
  sextile: 60,
  quincunx: 150,
  semisextile: 30,
};

/** Lookahead (days) for the applying/separating call from the two bodies' speeds (§6). */
const APPLYING_LOOKAHEAD_DAYS = 1;

/** Normalize to [0, 360). */
function degnorm(x: number): number {
  const d = x % 360;
  const r = d < 0 ? d + 360 : d;
  return r >= 360 ? 0 : r;
}

/** Normalize to the signed shortest arc (-180, 180]. */
function norm180(x: number): number {
  return degnorm(x + 180) - 180;
}

/** Pull a finite number out of an opaque sweph-wasm result slot (their typings may degrade to any under skipLibCheck; this keeps untyped values out). */
function finiteAt(values: readonly unknown[], index: number): number {
  const v = values[index];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`sweph-wasm: missing or non-finite value at index ${index}`);
  }
  return v;
}

/** Narrow an optional EngineConfig.options entry (options is Record<string, unknown> by contract). */
function readModuleFactory(
  options: Record<string, unknown> | undefined,
): (() => Promise<SwissephModule>) | undefined {
  const v = options?.createWasmModule;
  return typeof v === "function" ? (v as () => Promise<SwissephModule>) : undefined;
}

function isMoshierMode(options: Record<string, unknown> | undefined): boolean {
  return options?.mode === MOSHIER_MODE;
}

/** ChartFacts positions in canonical BODIES order (deterministic aspect output). */
function canonicalOrder(facts: ChartFacts): BodyPosition[] {
  const order = new Map<Body, number>(BODIES.map((body, index) => [body, index]));
  return [...facts.positions].sort(
    (a, b) => (order.get(a.body) ?? BODIES.length) - (order.get(b.body) ?? BODIES.length),
  );
}

/** True when the pair's separation is shrinking toward the exact aspect angle. */
function isApplying(a: BodyPosition, b: BodyPosition, angle: number): boolean {
  const now = norm180(a.lon - b.lon);
  const ahead = norm180(now + (a.speed - b.speed) * APPLYING_LOOKAHEAD_DAYS);
  return Math.abs(ahead - angle) < Math.abs(now - angle);
}

export class SwephEngine implements EphemerisEngine {
  readonly id = "sweph-wasm";

  /**
   * Backend capability flag (§6): present only after init() mounted the
   * asteroid table (seas_18.se1); under the Moshier fallback it stays
   * undefined — honest absence of Chiron (INC-19), never an estimate.
   */
  chiron: ((ut: JulianDay) => EclipticPosition) | undefined;

  private swe: SwissEPH | undefined;
  private moshier = true;
  private initPromise: Promise<void> | undefined;

  /** Idempotent: a second init() awaits the first; a failed init may be retried. */
  init(cfg: EngineConfig): Promise<void> {
    this.initPromise ??= this.doInit(cfg).catch((error: unknown) => {
      this.initPromise = undefined;
      throw error;
    });
    return this.initPromise;
  }

  position(body: Body, ut: JulianDay): EclipticPosition {
    if (body === "chiron") {
      const chiron = this.chiron;
      if (chiron === undefined) {
        throw new Error(
          "sweph-wasm: chiron not mounted (no asteroid table) — honest absence applies (ARCHITECTURE §6, INC-19)",
        );
      }
      return chiron(ut);
    }
    if (body === "south-node") {
      // Derived fact: exactly opposite the mean node, same rate, mirrored latitude.
      const north = this.position("north-node", ut);
      return EclipticPositionSchema.parse({
        lon: degnorm(north.lon + 180),
        lat: -north.lat,
        speed: north.speed,
      });
    }
    const ipl = BODY_IPL[body];
    if (ipl === undefined) {
      throw new Error(`sweph-wasm: no Swiss Ephemeris id for body "${body}"`);
    }
    return this.ecliptic(ipl, ut);
  }

  cusps(ut: JulianDay, place: GeoPlace, system: HouseSystem): HouseCusps {
    const swe = this.requireSwe();
    // swe_houses_ex takes (geolat, geolon) in that order — mind the swap.
    const raw = swe.swe_houses_ex(ut, this.calcFlag(swe), place.lat, place.lon, SWEPH_HSYS[system]);
    // sweph-wasm returns 1-based cusps (C arrays): index 0 is a placeholder,
    // houses 1–12 sit at indices 1–12 (36 for Gauquelin, which natally maps to
    // sectors elsewhere). ascmc = [asc, mc, armc, vertex, …].
    const cuspSlots: readonly unknown[] = raw.cusps;
    const points: readonly unknown[] = raw.ascmc;
    const cusp = (house: number): number => degnorm(finiteAt(cuspSlots, house));
    return HouseCuspsSchema.parse({
      cusps: Array.from({ length: 12 }, (_, i) => cusp(i + 1)),
      asc: degnorm(finiteAt(points, 0)),
      mc: degnorm(finiteAt(points, 1)),
      armc: degnorm(finiteAt(points, 2)),
    });
  }

  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[] {
    const aspects: Aspect[] = [];
    for (const pa of canonicalOrder(a)) {
      for (const pb of canonicalOrder(b)) {
        const separation = norm180(pa.lon - pb.lon);
        for (const type of ASPECT_TYPES) {
          const orb = Math.abs(separation - ASPECT_ANGLES[type]);
          if (orb <= orbs[type]) {
            aspects.push(
              AspectSchema.parse({
                a: pa.body,
                b: pb.body,
                type,
                orb,
                applying: isApplying(pa, pb, ASPECT_ANGLES[type]),
              }),
            );
          }
        }
      }
    }
    return aspects;
  }

  private async doInit(cfg: EngineConfig): Promise<void> {
    this.moshier = isMoshierMode(cfg.options);
    this.chiron = undefined;
    const createModule = readModuleFactory(cfg.options);
    const wasm = createModule ? await createModule() : await SwissEPH.init();
    const swe = new SwissEPH(wasm);
    if (!this.moshier) {
      // Production: lazy-mount the semiset from the §13 mirror (tablesUrl;
      // sha256 verification happens in the mirror download, before this call).
      await swe.swe_set_ephe_path(
        cfg.tablesUrl,
        SEMISET_TABLES.map((table) => table.file),
      );
      this.chiron = (ut: JulianDay) => this.ecliptic(BODY_IPL.chiron, ut);
    }
    this.swe = swe;
  }

  private calcFlag(swe: SwissEPH): number {
    return (this.moshier ? swe.SEFLG_MOSEPH : swe.SEFLG_SWIEPH) | swe.SEFLG_SPEED;
  }

  private ecliptic(ipl: number, ut: JulianDay): EclipticPosition {
    const swe = this.requireSwe();
    // [lon, lat, dist, lonSpd, latSpd, distSpd], degrees / degrees-per-day.
    const raw: readonly unknown[] = swe.swe_calc_ut(ut, ipl, this.calcFlag(swe));
    return EclipticPositionSchema.parse({
      lon: degnorm(finiteAt(raw, 0)),
      lat: finiteAt(raw, 1),
      speed: finiteAt(raw, 3),
    });
  }

  private requireSwe(): SwissEPH {
    const swe = this.swe;
    if (swe === undefined) {
      throw new Error("sweph-wasm engine not initialized — call init() first (ARCHITECTURE §6)");
    }
    return swe;
  }
}
