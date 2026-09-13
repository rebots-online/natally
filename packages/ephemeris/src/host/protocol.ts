import { z } from "zod";
import type { EphemerisEngine } from "../seam.ts";
import {
  AspectSchema,
  BodySchema,
  ChartFactsSchema,
  EclipticPositionSchema,
  HouseCuspsSchema,
  HouseSystemSchema,
  OrbTableSchema,
  PlaceSchema,
  UTSchema,
} from "../types.ts";

/** The wire accepts JSON only: functions, URL instances and undefined cannot cross it. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
export const HostRequestIdSchema = z.union([
  z.string().min(1),
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
]);
export type HostRequestId = z.infer<typeof HostRequestIdSchema>;

export const HostRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({
    id: HostRequestIdSchema,
    op: z.literal("init"),
    params: z.record(z.string(), JsonValueSchema),
  }),
  z.strictObject({
    id: HostRequestIdSchema,
    op: z.literal("position"),
    params: z.strictObject({ body: BodySchema, ut: UTSchema }),
  }),
  z.strictObject({
    id: HostRequestIdSchema,
    op: z.literal("cusps"),
    params: z.strictObject({ ut: UTSchema, place: PlaceSchema, system: HouseSystemSchema }),
  }),
  z.strictObject({
    id: HostRequestIdSchema,
    op: z.literal("aspects"),
    params: z.strictObject({ a: ChartFactsSchema, b: ChartFactsSchema, orbs: OrbTableSchema }),
  }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;
export type HostOperation = HostRequest["op"];
export type HostParams<Op extends HostOperation> = Extract<
  z.input<typeof HostRequestSchema>,
  { op: Op }
>["params"];
export const HostResultSchemas = {
  init: z.null(),
  position: EclipticPositionSchema,
  cusps: HouseCuspsSchema,
  aspects: z.array(AspectSchema),
};
export type HostResult<Op extends HostOperation> = z.infer<(typeof HostResultSchemas)[Op]>;
export type SerializedHostError = { name: string; message: string };
export type HostResponse =
  | { id: HostRequestId; ok: true; result: HostResult<HostOperation> }
  | { id: HostRequestId | null; ok: false; error: SerializedHostError };

export function serializeHostError(error: unknown): SerializedHostError {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return {
    name: "Error",
    message: typeof error === "string" ? error : "Unknown ephemeris host failure",
  };
}

/** One engine per worker; importing this module on the UI thread creates no engine. */
export function createHostDispatcher(
  loadEngine: () => Promise<EphemerisEngine> = async () => {
    const { SwephEngine } = await import("../sweph/engine.ts");
    return new SwephEngine();
  },
): (input: unknown) => Promise<HostResponse> {
  let engine: EphemerisEngine | undefined;
  let initialized = false;
  let tail: Promise<unknown> = Promise.resolve();

  async function dispatch(input: unknown): Promise<HostResponse> {
    const candidateId =
      typeof input === "object" && input !== null && "id" in input ? input.id : undefined;
    const parsedId = HostRequestIdSchema.safeParse(candidateId);
    const id = parsedId.success ? parsedId.data : null;
    try {
      const request = HostRequestSchema.parse(input);
      if (request.op === "init") {
        initialized = false;
        const candidate = engine ?? (await loadEngine());
        await candidate.init(request.params);
        engine = candidate;
        initialized = true;
        return { id: request.id, ok: true, result: null };
      }
      if (!engine || !initialized)
        throw new Error("ephemeris host is not initialized; await init first");
      let result: HostResult<HostOperation>;
      switch (request.op) {
        case "position":
          result = EclipticPositionSchema.parse(
            engine.position(request.params.body, request.params.ut),
          );
          break;
        case "cusps":
          result = HouseCuspsSchema.parse(
            engine.cusps(request.params.ut, request.params.place, request.params.system),
          );
          break;
        case "aspects":
          result = HostResultSchemas.aspects.parse(
            engine.aspects(request.params.a, request.params.b, request.params.orbs),
          );
          break;
      }
      return { id: request.id, ok: true, result };
    } catch (error) {
      return { id, ok: false, error: serializeHostError(error) };
    }
  }

  // Message callbacks may overlap while init awaits assets. The queue also recovers
  // after a failed init/calculation, so every subsequent request gets its own reply.
  return (input) => {
    const response = tail.then(() => dispatch(input));
    tail = response.catch(() => undefined);
    return response;
  };
}

export interface HostWorkerPort {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(response: HostResponse): void;
}

/** Shared entrypoint for a dedicated browser worker and the Node test adapter. */
export function attachEphemerisWorker(port: HostWorkerPort): void {
  const dispatch = createHostDispatcher();
  port.addEventListener("message", (event) => {
    void dispatch(event.data).then((response) => port.postMessage(response));
  });
}

// This module is the worker entry. It never imports the client that constructs
// it, so Vite's worker bundler does not encounter a self-referencing Worker URL.
// Window/Node imports only expose schemas and functions; they create no engine.
if (
  typeof self !== "undefined" &&
  typeof document === "undefined" &&
  typeof self.postMessage === "function"
) {
  attachEphemerisWorker(self);
}
