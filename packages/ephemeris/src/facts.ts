import type { EphemerisEngine } from "./seam.ts";
import {
  type Aspect,
  BodySchema,
  type ChartFacts,
  ChartFactsSchema,
  type ChartInputs,
  ChartInputsSchema,
  DEFAULT_ORBS,
} from "./types.ts";

/** P.4: timeKnown is retained in the calculation key, even for identical UT inputs. */
export type BuildFactsInputs = ChartInputs & { timeKnown: boolean };

export interface FactsCache {
  get(key: string): unknown | Promise<unknown>;
  put(key: string, value: ChartFacts): void | Promise<void>;
}

type AsyncMethod<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => R | Promise<R>
  : never;

/** Both the in-worker synchronous engine and an asynchronous worker client fit here. */
export interface FactsEngine {
  readonly id: string;
  position: AsyncMethod<EphemerisEngine["position"]>;
  cusps: AsyncMethod<EphemerisEngine["cusps"]>;
  aspects: AsyncMethod<EphemerisEngine["aspects"]>;
  chiron?: AsyncMethod<NonNullable<EphemerisEngine["chiron"]>>;
}

export interface FactsDependencies {
  engine: FactsEngine;
  cache: FactsCache;
}

function immutable<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function canonical(inputs: BuildFactsInputs): string {
  // Explicit property order canonicalizes object keys without sorting ordered UT arrays.
  return JSON.stringify({
    place: { lat: inputs.place.lat, lon: inputs.place.lon },
    system: inputs.system,
    timeKnown: inputs.timeKnown,
    ut: inputs.ut,
  });
}

async function inputHash(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build one plate from explicit calculation instants; no birth time is invented.
 * Date-only SolarChartInputs intentionally cannot enter this timed engine seam.
 * Callers build each natal plate separately before aspectsBetween; this function
 * does not invent a composite-chart calculation from multiple UT inputs.
 */
export async function buildFacts(
  input: BuildFactsInputs,
  { engine, cache }: FactsDependencies,
): Promise<ChartFacts> {
  if (typeof input.timeKnown !== "boolean") throw new TypeError("timeKnown must be explicit");
  const inputs = ChartInputsSchema.parse({
    ut: input.ut,
    place: input.place,
    system: input.system,
  });
  // Composite charts have no specified calculation contract. Never silently collapse UTs.
  if (inputs.ut.length !== 1) throw new RangeError("Build each natal plate from exactly one UT");
  const normalized = { ...inputs, timeKnown: input.timeKnown };
  const id = await inputHash(canonical(normalized));
  // The content ID is input-only; the cache namespace also isolates engine/capability changes.
  const hasChiron = typeof engine.chiron === "function";
  const key = JSON.stringify([engine.id, hasChiron, id]);
  const bodies = BodySchema.options.filter((body) => body !== "chiron" || hasChiron);
  const hit = ChartFactsSchema.safeParse(await cache.get(key));
  if (
    hit.success &&
    hit.data.id === id &&
    canonical({ ...hit.data.inputs, timeKnown: hit.data.cusps !== undefined }) ===
      canonical(normalized) &&
    hit.data.positions.length === bodies.length &&
    hit.data.positions.every((position, index) => position.body === bodies[index])
  )
    return immutable(hit.data);

  const ut = inputs.ut[0];
  if (ut === undefined) throw new TypeError("A calculation UT is required");
  const positions = await Promise.all(
    bodies.map(async (body) => ({
      body,
      ...(body === "chiron" && engine.chiron
        ? await engine.chiron(ut)
        : await engine.position(body, ut)),
    })),
  );
  const facts = ChartFactsSchema.parse({
    id,
    inputs,
    positions,
    ...(normalized.timeKnown ? { cusps: await engine.cusps(ut, inputs.place, inputs.system) } : {}),
    aspects: [],
  });
  const order = new Map(bodies.map((body, index) => [body, index]));
  facts.aspects = (await engine.aspects(facts, facts, { ...DEFAULT_ORBS })).filter((aspect) => {
    const left = order.get(aspect.a);
    const right = order.get(aspect.b);
    return left !== undefined && right !== undefined && left < right;
  });
  const result = immutable(ChartFactsSchema.parse(facts));
  await cache.put(key, result);
  return result;
}

/** Synastry is the cross-aspect set: no compatibility score or interpretation. */
export async function aspectsBetween(
  a: ChartFacts,
  b: ChartFacts,
  engine: Pick<FactsEngine, "aspects">,
): Promise<Aspect[]> {
  return immutable(
    await engine.aspects(ChartFactsSchema.parse(a), ChartFactsSchema.parse(b), { ...DEFAULT_ORBS }),
  );
}
