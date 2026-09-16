import { z } from "zod";
import {
  type Aspect,
  AspectSchema,
  BodySchema,
  ChartFactsSchema,
  defaultOrbTable,
  type EclipticPosition,
  EclipticPositionSchema,
  GeoPlaceSchema,
  type HouseCusps,
  HouseCuspsSchema,
  HouseSystemSchema,
  JulianDaySchema,
  OrbTableSchema,
} from "../types";

// # Host JSON protocol (task P.3, ARCHITECTURE §4)
//
// Wire contract between the UI thread and the off-thread ephemeris host:
// request `{id, op, params}` → response `{id, ok, result|error}`. One op per
// message, exactly one response per request, correlated by the caller-chosen
// `id`. The same wire shape is spoken by the worker entry (web-worker.ts) and
// by the native tokio task (native/host.rs); messages travel as JSON strings
// (postMessage on the web leg, mpsc payloads on the native leg), so every
// field here is JSON-round-trippable. Params/results are validated against
// the §6 seam schemas of ../types.ts — the host adds no facts of its own.

/** The four host ops. */
export const HOST_OPS = ["init", "position", "cusps", "aspects"] as const;
export type HostOp = (typeof HOST_OPS)[number];

/** Every request carries a caller-chosen, non-empty correlation id. */
const RequestIdSchema = z.string().min(1);

/** init params: the §6/§13 engine config seam reduced to JSON fields. */
export const InitParamsSchema = z.object({
  tablesUrl: z.string().min(1),
  /** true ⇒ the Moshier fallback (no table mount, Chiron honestly absent). */
  moshier: z.boolean(),
});
export type InitParams = z.infer<typeof InitParamsSchema>;

/** init result: which engine answered and in which mode. */
export const InitResultSchema = z.object({
  engine: z.string().min(1),
  moshier: z.boolean(),
});
export type InitResult = z.infer<typeof InitResultSchema>;

export const PositionParamsSchema = z.object({
  body: BodySchema,
  ut: JulianDaySchema,
});
export type PositionParams = z.infer<typeof PositionParamsSchema>;

export const CuspsParamsSchema = z.object({
  ut: JulianDaySchema,
  place: GeoPlaceSchema,
  system: HouseSystemSchema,
});
export type CuspsParams = z.infer<typeof CuspsParamsSchema>;

export const AspectsParamsSchema = z.object({
  a: ChartFactsSchema,
  b: ChartFactsSchema,
  /** Missing orbs parse to the §6 default table (8/8/7/7/4/3/2). */
  orbs: OrbTableSchema.default(defaultOrbTable),
});
export type AspectsParams = z.infer<typeof AspectsParamsSchema>;

/** The request union, discriminated by `op`. */
export const HostRequestSchema = z.discriminatedUnion("op", [
  z.object({ id: RequestIdSchema, op: z.literal("init"), params: InitParamsSchema }),
  z.object({ id: RequestIdSchema, op: z.literal("position"), params: PositionParamsSchema }),
  z.object({ id: RequestIdSchema, op: z.literal("cusps"), params: CuspsParamsSchema }),
  z.object({ id: RequestIdSchema, op: z.literal("aspects"), params: AspectsParamsSchema }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

/** Params keyed by op (helper typing for callers that stay generic). */
export interface HostParamsMap {
  init: InitParams;
  position: PositionParams;
  cusps: CuspsParams;
  aspects: AspectsParams;
}

/** Results keyed by op (mirror of the seam's return shapes). */
export interface HostResultMap {
  init: InitResult;
  position: EclipticPosition;
  cusps: HouseCusps;
  aspects: Aspect[];
}

/** The response shell: exactly `{id, ok, result}` or `{id, ok, error}`. */
export const HostResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: RequestIdSchema, ok: z.literal(true), result: z.unknown() }),
  z.object({ id: RequestIdSchema, ok: z.literal(false), error: z.string().min(1) }),
]);
export type HostResponse = z.infer<typeof HostResponseSchema>;

/** Result schema per op (the worker validates before it answers). */
const RESULT_SCHEMAS: Readonly<{ [Op in HostOp]: z.ZodType }> = {
  init: InitResultSchema,
  position: EclipticPositionSchema,
  cusps: HouseCuspsSchema,
  aspects: z.array(AspectSchema),
};

/** Typed decode target: the result narrows to the requested op's shape. */
export type HostReply<O extends HostOp> =
  | { id: string; ok: true; result: HostResultMap[O] }
  | { id: string; ok: false; error: string };

/** Accept a JSON string or an already-parsed value (postMessage may clone either). */
function asJson(payload: unknown): unknown {
  if (typeof payload !== "string") {
    return payload;
  }
  return JSON.parse(payload) as unknown;
}

/** Validate and canonicalize a request onto the wire (JSON string). */
export function encodeRequest(request: HostRequest): string {
  return JSON.stringify(HostRequestSchema.parse(request));
}

/** Parse a wire payload into a validated request (worker / native side). */
export function decodeRequest(payload: unknown): HostRequest {
  return HostRequestSchema.parse(asJson(payload));
}

/** Build an ok response, validating the result against the op's schema. */
export function makeOkResponse(op: HostOp, id: string, result: unknown): HostResponse {
  return { id, ok: true, result: RESULT_SCHEMAS[op].parse(result) };
}

/** Build an error response (the protocol's only failure shape). */
export function makeErrorResponse(id: string, error: string): HostResponse {
  return { id, ok: false, error };
}

/** Validate and canonicalize a response onto the wire (JSON string). */
export function encodeResponse(response: HostResponse): string {
  return JSON.stringify(HostResponseSchema.parse(response));
}

/**
 * Parse a wire payload into a reply whose result is validated (and typed)
 * against the caller's op. A `{ok: true}` reply whose result does not match
 * the op's schema is a protocol violation and throws.
 */
export function decodeResponse<O extends HostOp>(payload: unknown, op: O): HostReply<O> {
  const wire = HostResponseSchema.parse(asJson(payload));
  if (!wire.ok) {
    return { id: wire.id, ok: false, error: wire.error };
  }
  return {
    id: wire.id,
    ok: true,
    result: RESULT_SCHEMAS[op].parse(wire.result) as HostResultMap[O],
  };
}
