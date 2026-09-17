import type { EphemerisConfig } from "../seam.ts";
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
} from "../types.ts";
import {
  type HostOperation,
  type HostParams,
  HostRequestSchema,
  type HostResponse,
  type HostResult,
  HostResultSchemas,
} from "./protocol.ts";

export type EphemerisInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** I.3 supplies Tauri's invoke. This module contains no platform detection. */
export class NativeEphemerisHost {
  readonly id = "swisseph-native@fa78b5065810fa9077e96475e33decb8f3ecd61c";
  private nextId = 0;

  constructor(private readonly invoke: EphemerisInvoke) {}

  async init(cfg: EphemerisConfig = {}): Promise<void> {
    await this.request("init", cfg as HostParams<"init">);
  }
  position(body: Body, ut: UT): Promise<EclipticPosition> {
    return this.request("position", { body, ut });
  }
  chiron(ut: UT): Promise<EclipticPosition> {
    return this.position("chiron", ut);
  }
  cusps(ut: UT, place: Place, system: HouseSystem): Promise<HouseCusps> {
    return this.request("cusps", { ut, place, system });
  }
  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Promise<Aspect[]> {
    return this.request("aspects", { a, b, orbs });
  }

  async request<Op extends HostOperation>(op: Op, params: HostParams<Op>): Promise<HostResult<Op>> {
    const id = this.nextId++;
    const request = HostRequestSchema.parse({ id, op, params });
    const response = await this.invoke<HostResponse>("plugin:ephemeris|ephemeris_request", {
      request,
    });
    if (!response || response.id !== id) throw new Error("Invalid native ephemeris response ID");
    if (response.ok !== true) {
      const error = new Error(response.error?.message ?? "Native ephemeris command failed");
      error.name = response.error?.name ?? "EphemerisError";
      throw error;
    }
    return HostResultSchemas[op].parse(response.result) as HostResult<Op>;
  }
}
