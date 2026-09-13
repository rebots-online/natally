import type { SwissephModule } from "sweph-wasm/wasm/swisseph";
import type { EphemerisConfig, EphemerisEngine } from "../seam.ts";
import {
  type Aspect,
  type AspectType,
  type Body,
  BodySchema,
  type ChartFacts,
  ChartFactsSchema,
  type EclipticPosition,
  EclipticPositionSchema,
  type HouseCusps,
  HouseCuspsSchema,
  type HouseSystem,
  HouseSystemSchema,
  type OrbTable,
  OrbTableSchema,
  type Place,
  PlaceSchema,
  type UT,
  UTSchema,
} from "../types.ts";
import { SWEPH_TABLE_RANGE, SWEPH_TABLES, SWEPH_WASM } from "./tables.ts";

export type SwephAssetFetch = (url: URL) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * assetRoot is an explicit URL to the locally deployed vendor dist/ contents.
 * A worker can pass new URL("/assets/sweph/", self.location.href). Node callers
 * pass a file: URL plus a fetch implementation that reads those local files.
 * Construction does no I/O; init loads only this pinned 1800–2400 semiset.
 */
export type SwephConfig = EphemerisConfig & {
  assetRoot: string | URL;
  fetch?: SwephAssetFetch;
};

// The published declarations have unresolved Emscripten ambient type references.
// Keep the runtime helpers structural and use the vendor's native signatures.
type Runtime = Pick<
  SwissephModule,
  "_malloc" | "_free" | "_swe_set_ephe_path" | "_swe_calc_ut" | "_swe_houses_ex"
> & {
  getValue(ptr: number, type: "double"): number;
  stringToUTF8(value: string, ptr: number, length: number): void;
  UTF8ToString(ptr: number): string;
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
};

// DOCS/sdk/sweph-wasm/index.d.ts: planetary IDs and SEFLG_* constants.
// North node is the osculating/true lunar node; south is its antipode.
const BODY_IDS = {
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
  chiron: 15,
  "north-node": 11,
  "south-node": 11,
} as const satisfies Record<Body, number>;
const SWIEPH = 2;
const SPEED = 256;
const FLAGS = SWIEPH | SPEED;
const ASPECT_ANGLES = [
  ["conjunction", 0],
  ["opposition", 180],
  ["trine", 120],
  ["square", 90],
  ["sextile", 60],
  ["quincunx", 150],
  ["semisextile", 30],
] as const satisfies ReadonlyArray<readonly [AspectType, number]>;

function normalize(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function signedAngle(angle: number): number {
  return normalize(angle + 180) - 180;
}

function checkDate(ut: UT): void {
  UTSchema.parse(ut);
  if (ut < SWEPH_TABLE_RANGE.start || ut >= SWEPH_TABLE_RANGE.end) {
    throw new RangeError("sweph-wasm bundled tables cover Gregorian 1800–2400 only");
  }
}

const localFetch: SwephAssetFetch = (url) =>
  globalThis.fetch(url, { credentials: "same-origin", redirect: "error" });

async function readAsset(
  root: URL,
  fetchAsset: SwephAssetFetch,
  asset: { readonly path: string; readonly bytes: number; readonly sha256: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetchAsset(new URL(asset.path, root));
  if (!response.ok) throw new Error(`sweph asset ${asset.path}: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== asset.bytes) {
    throw new Error(`sweph asset ${asset.path}: byte length mismatch`);
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== asset.sha256) throw new Error(`sweph asset ${asset.path}: SHA-256 mismatch`);
  return new Uint8Array(buffer);
}

/** Native buffers are released on both successful calculations and errors. */
function withBuffer<T>(wasm: Runtime, bytes: number, use: (ptr: number) => T): T {
  const ptr = wasm._malloc(bytes);
  if (!ptr) throw new Error("sweph-wasm allocation failed");
  try {
    return use(ptr);
  } finally {
    wasm._free(ptr);
  }
}

export class SwephEngine implements EphemerisEngine {
  readonly id = "sweph-wasm@2.6.9";
  private wasm: Runtime | undefined;
  private loading: Promise<void> | undefined;
  private assetRoot: string | undefined;
  private fetchAsset: SwephAssetFetch | undefined;

  async init(cfg: EphemerisConfig): Promise<void> {
    if (!(typeof cfg.assetRoot === "string" || cfg.assetRoot instanceof URL)) {
      throw new TypeError("sweph init requires an explicit assetRoot URL");
    }
    const root = new URL(cfg.assetRoot);
    if (!["file:", "http:", "https:"].includes(root.protocol) || root.search || root.hash) {
      throw new TypeError(
        "sweph assetRoot must be a file/http(s) directory URL without query or hash",
      );
    }
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    if (cfg.fetch !== undefined && typeof cfg.fetch !== "function") {
      throw new TypeError("sweph fetch must be a function");
    }
    const fetchAsset = cfg.fetch === undefined ? localFetch : (cfg.fetch as SwephAssetFetch);
    if (this.loading || this.wasm) {
      if (root.href !== this.assetRoot || fetchAsset !== this.fetchAsset) {
        throw new Error(
          "sweph engine is already initialized or initializing with different assets",
        );
      }
      return this.loading;
    }
    this.assetRoot = root.href;
    this.fetchAsset = fetchAsset;
    this.loading = this.load(root, fetchAsset);
    try {
      await this.loading;
    } catch (error) {
      this.assetRoot = undefined;
      this.fetchAsset = undefined;
      throw error;
    } finally {
      this.loading = undefined;
    }
  }

  private async load(root: URL, fetchAsset: SwephAssetFetch): Promise<void> {
    const [binary, tables] = await Promise.all([
      readAsset(root, fetchAsset, SWEPH_WASM),
      Promise.all(
        SWEPH_TABLES.map(async (table) => ({
          name: table.name,
          data: await readAsset(root, fetchAsset, table),
        })),
      ),
    ]);
    const { default: Module } = await import("sweph-wasm/wasm/swisseph");
    const wasm: Runtime = await Module({
      wasmBinary: binary,
      locateFile: (path: string) => {
        if (path !== "swisseph.wasm") throw new Error(`Unexpected sweph runtime asset: ${path}`);
        return new URL(SWEPH_WASM.path, root).href;
      },
    });
    wasm.FS.mkdir("/ephe");
    for (const table of tables) wasm.FS.writeFile(`/ephe/${table.name}`, table.data);
    // Bypass the SDK downloader: it uses global fetch and tolerates missing files.
    // Native path API: VENDORED/sweph-wasm/dist/wasm/swisseph.d.ts, _swe_set_ephe_path.
    withBuffer(wasm, 6, (ptr) => {
      wasm.stringToUTF8("/ephe", ptr, 6);
      wasm._swe_set_ephe_path(ptr);
    });
    this.wasm = wasm;
  }

  private ready(): Runtime {
    if (!this.wasm) throw new Error("sweph engine is not initialized; await init(cfg) first");
    return this.wasm;
  }

  position(body: Body, ut: UT): EclipticPosition {
    const wasm = this.ready();
    BodySchema.parse(body);
    checkDate(ut);
    // Native swe_calc_ut preserves the return flags (the JS convenience wrapper
    // discards them). Require SWIEPH + SPEED, rejecting silent Moshier fallback.
    return withBuffer(wasm, 6 * 8 + 256, (ptr) => {
      const errorPtr = ptr + 6 * 8;
      wasm.stringToUTF8("", errorPtr, 256);
      const result = wasm._swe_calc_ut(ut, BODY_IDS[body], FLAGS, ptr, errorPtr);
      if (result < 0 || (result & FLAGS) !== FLAGS) {
        throw new Error(`swe_calc_ut ${body}: ${wasm.UTF8ToString(errorPtr) || `flags ${result}`}`);
      }
      const opposite = body === "south-node";
      return EclipticPositionSchema.parse({
        lon: normalize(wasm.getValue(ptr, "double") + (opposite ? 180 : 0)),
        lat: wasm.getValue(ptr + 8, "double") * (opposite ? -1 : 1),
        speed: wasm.getValue(ptr + 3 * 8, "double"),
      });
    });
  }

  chiron(ut: UT): EclipticPosition {
    return this.position("chiron", ut);
  }

  cusps(ut: UT, place: Place, system: HouseSystem): HouseCusps {
    const wasm = this.ready();
    checkDate(ut);
    PlaceSchema.parse(place);
    HouseSystemSchema.parse(system);
    // Native cusps are 1-based; ascmc[0..2] = ascendant, MC, ARMC.
    // VENDORED/sweph-wasm/swisseph/swehouse.c: swe_houses_ex and cusp[0] sentinel.
    return withBuffer(wasm, (13 + 10) * 8, (ptr) => {
      const anglesPtr = ptr + 13 * 8;
      const result = wasm._swe_houses_ex(
        ut,
        0,
        place.lat,
        place.lon,
        system.charCodeAt(0),
        ptr,
        anglesPtr,
      );
      if (result < 0) throw new Error(`swe_houses_ex ${system}: unavailable at this date/place`);
      return HouseCuspsSchema.parse({
        cusps: Array.from({ length: 12 }, (_, index) =>
          normalize(wasm.getValue(ptr + (index + 1) * 8, "double")),
        ),
        asc: normalize(wasm.getValue(anglesPtr, "double")),
        mc: normalize(wasm.getValue(anglesPtr + 8, "double")),
        armc: normalize(wasm.getValue(anglesPtr + 16, "double")),
      });
    });
  }

  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[] {
    ChartFactsSchema.parse(a);
    ChartFactsSchema.parse(b);
    const limits = OrbTableSchema.parse(orbs);
    const result: Aspect[] = [];
    const sameChart = a.id === b.id;
    for (let i = 0; i < a.positions.length; i++) {
      const left = a.positions[i];
      if (!left) continue;
      for (let j = sameChart ? i + 1 : 0; j < b.positions.length; j++) {
        const right = b.positions[j];
        if (!right) continue;
        const delta = signedAngle(right.lon - left.lon);
        const separation = Math.abs(delta);
        for (const [type, angle] of ASPECT_ANGLES) {
          const offset = separation - angle;
          const orb = Math.abs(offset);
          if (orb <= limits[type]) {
            result.push({
              a: left.body,
              b: right.body,
              type,
              orb,
              // d(separation)/dt from signed longitude speeds; exact = not applying.
              applying: offset * Math.sign(delta) * (right.speed - left.speed) < 0,
            });
          }
        }
      }
    }
    return result;
  }
}
