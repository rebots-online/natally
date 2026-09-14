import { z } from "zod";
import type {
  Aspect,
  Body,
  ChartFacts,
  EclipticPosition,
  HouseCusps,
  HouseSystem,
  OrbTable,
  Place,
  UT,
} from "./types.ts";

export * from "./types.ts";

/** Engine-specific initialization data, interpreted by the selected adapter. */
export const EphemerisConfigSchema = z.record(z.string(), z.unknown());
export type EphemerisConfig = z.infer<typeof EphemerisConfigSchema>;

/**
 * Swappable calculation seam. Initialization loads resources asynchronously;
 * subsequent calculations are synchronous, matching the vendored SDK's methods
 * (DOCS/sdk/sweph-wasm/index.d.ts:644, :726, :1386).
 */
export interface EphemerisEngine {
  readonly id: string;
  init(cfg: EphemerisConfig): Promise<void>;
  position(body: Body, ut: UT): EclipticPosition;
  cusps(ut: UT, place: Place, system: HouseSystem): HouseCusps;
  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Aspect[];
  chiron?(ut: UT): EclipticPosition;
}

/**
 * Validates the callable surface without cloning an adapter or losing its
 * prototype/receiver. Argument and result contracts are the exported data schemas;
 * inspecting an engine never invokes its methods or loads its resources.
 */
export const EphemerisEngineSchema = z.custom<EphemerisEngine>(
  (value) => {
    if (typeof value !== "object" || value === null) return false;
    const engine = value as Partial<EphemerisEngine>;
    return (
      typeof engine.id === "string" &&
      engine.id.length > 0 &&
      typeof engine.init === "function" &&
      typeof engine.position === "function" &&
      typeof engine.cusps === "function" &&
      typeof engine.aspects === "function" &&
      (engine.chiron === undefined || typeof engine.chiron === "function")
    );
  },
  { message: "Expected an EphemerisEngine with the complete callable seam" },
);
