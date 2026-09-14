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
  type HostResponse,
  type HostResult,
  HostResultSchemas,
} from "./protocol.ts";

/** Literal module URL is intentionally visible to Vite's worker bundler. */
export function createEphemerisWorker(): Worker {
  return new Worker(new URL("./protocol.ts", import.meta.url), { type: "module" });
}

/** Promise facade; responses are correlated by ID, never by arrival order. */
export class EphemerisWorkerHost {
  readonly id = "sweph-wasm@2.6.9";
  private readonly worker: Worker;
  private nextId = 0;
  private failure: Error | undefined;
  private readonly pending = new Map<
    number,
    {
      resolve: (response: Extract<HostResponse, { ok: true }>) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(worker: Worker = createEphemerisWorker()) {
    this.worker = worker;
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
    worker.addEventListener("messageerror", this.onMessageError);
  }

  /** cfg must be JSON; pass assetRoot as a string, never a fetch function. */
  async init(cfg: EphemerisConfig): Promise<void> {
    await this.request("init", cfg as HostParams<"init">);
  }

  position(body: Body, ut: UT): Promise<EclipticPosition> {
    return this.request("position", { body, ut });
  }

  cusps(ut: UT, place: Place, system: HouseSystem): Promise<HouseCusps> {
    return this.request("cusps", { ut, place, system });
  }

  aspects(a: ChartFacts, b: ChartFacts, orbs: OrbTable): Promise<Aspect[]> {
    return this.request("aspects", { a, b, orbs });
  }

  chiron(ut: UT): Promise<EclipticPosition> {
    return this.position("chiron", ut);
  }

  request<Op extends HostOperation>(op: Op, params: HostParams<Op>): Promise<HostResult<Op>> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (response) => {
          try {
            resolve(HostResultSchemas[op].parse(response.result) as HostResult<Op>);
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });
      try {
        this.worker.postMessage({ id, op, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private readonly onMessage = (event: MessageEvent<HostResponse>): void => {
    const response = event.data;
    if (!response || typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok === true) pending.resolve(response);
    else if (
      response.ok === false &&
      response.error &&
      typeof response.error.message === "string"
    ) {
      const error = new Error(response.error.message);
      error.name = response.error.name;
      pending.reject(error);
    } else pending.reject(new Error("Invalid ephemeris worker response"));
  };

  private readonly onError = (event: ErrorEvent): void => {
    this.close(new Error(event.message || "Ephemeris worker failed"));
  };
  private readonly onMessageError = (): void => {
    this.close(new Error("Ephemeris worker response could not be deserialized"));
  };

  close(error = new Error("Ephemeris worker host closed")): void {
    if (this.failure) return;
    this.failure = error;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onMessageError);
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
