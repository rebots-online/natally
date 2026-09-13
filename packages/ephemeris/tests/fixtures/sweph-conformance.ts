import { readFile } from "node:fs/promises";
import type { SwephAssetFetch } from "../../src/sweph/engine.ts";
import type { Body, HouseSystem } from "../../src/types.ts";

/** Input-only fixtures. No engine output is stored as an expected position. */
export const CONFORMANCE_PLACE = { lat: 55.6, lon: 13 } as const;
export const CONFORMANCE_DATES = ["1990-05-02T14:32:00.000Z", "2026-09-04T00:00:00.000Z"] as const;

/**
 * Conservative absolute geocentric longitude-speed ceilings, degrees/day.
 * These are broad plausibility limits, not per-date measurements or accuracy
 * references. South node is derived from north and checked in the north cases.
 * Pairing the 12 bodies with the 12 house codes covers every system at both UTs.
 */
const BODIES = [
  { body: "sun", maxSpeed: 1.1, system: "P" },
  { body: "moon", maxSpeed: 17, system: "K" },
  { body: "mercury", maxSpeed: 2.5, system: "O" },
  { body: "venus", maxSpeed: 1.5, system: "R" },
  { body: "mars", maxSpeed: 1, system: "C" },
  { body: "jupiter", maxSpeed: 0.3, system: "A" },
  { body: "saturn", maxSpeed: 0.2, system: "V" },
  { body: "uranus", maxSpeed: 0.1, system: "W" },
  { body: "neptune", maxSpeed: 0.07, system: "T" },
  { body: "pluto", maxSpeed: 0.1, system: "X" },
  { body: "chiron", maxSpeed: 0.25, system: "B" },
  { body: "north-node", maxSpeed: 0.5, system: "U" },
] as const satisfies ReadonlyArray<{ body: Body; maxSpeed: number; system: HouseSystem }>;

export const CONFORMANCE_CASES = CONFORMANCE_DATES.flatMap((iso) =>
  BODIES.map((fixture) => ({
    ...fixture,
    iso,
    // Unix epoch = JD 2440587.5. UTC inputs are explicitly Gregorian.
    ut: Date.parse(iso) / 86400000 + 2440587.5,
    place: CONFORMANCE_PLACE,
  })),
);

export const VENDORED_ASSET_ROOT = new URL(
  "../../../../VENDORED/sweph-wasm/dist/",
  import.meta.url,
);

/** Tests mount exactly the same packaged WASM and tables used by the worker. */
export const fetchVendoredAsset: SwephAssetFetch = async (url) => {
  if (url.protocol !== "file:" || !url.href.startsWith(VENDORED_ASSET_ROOT.href)) {
    throw new Error(`Conformance attempted to load a non-vendored asset: ${url.href}`);
  }
  const bytes = await readFile(url);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
};
