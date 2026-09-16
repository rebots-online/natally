import { z } from "zod";
import type { EphemerisEngine } from "./seam";
import {
  ASPECT_TYPES,
  type Aspect,
  type AspectType,
  BODIES,
  type BodyPosition,
  type ChartFacts,
  ChartFactsSchema,
  type ChartInputs,
  ChartInputsSchema,
  defaultOrbTable,
  type OrbTable,
} from "./types";

// # ChartFacts builder + cache (ARCHITECTURE §5/§6, task P.4)
//
// `buildFacts` turns validated chart inputs into the content-addressed
// ChartFacts fact set (§5: "immutable; from EphemerisEngine only"). It is pure
// orchestration over the injected EphemerisEngine seam (D14) and an injected
// KV cache; it owns no engine, no storage and no I/O of its own, so any
// backend and any store can sit underneath it.
//
// INC-19: everything produced here is a computed fact — geometry only. No
// compatibility score, no interpretation label, no prose. `Aspect` is exactly
// { a, b, type, orb, applying }.

/**
 * The builder's input: the §5 ChartInputs contract extended with the Person's
 * `timeKnown` flag (§5 entity table). `timeKnown: false` marks a solar chart —
 * date-only birth — which has no houses anywhere the person appears (§6
 * honest-absence rules). The flag participates in the content id because it
 * changes the computed content (cusps or none).
 */
export const FactsInputsSchema = ChartInputsSchema.extend({
  timeKnown: z.boolean(),
});
export type FactsInputs = z.infer<typeof FactsInputsSchema>;

/**
 * Local KV seam for the fact cache (§5: ChartFacts is content-addressed by
 * input hash; the charts table lands here — task X.1 adapts this interface to
 * SQLite). Keyed by the ChartFacts id, holding whole ChartFacts values.
 */
export interface FactsCache {
  get(id: string): Promise<ChartFacts | undefined>;
  put(facts: ChartFacts): Promise<void>;
}

/**
 * Stable key-sorted JSON with no whitespace — the canonical form the content
 * id hashes. Object keys sort by UTF-16 code units; array order is preserved;
 * `undefined` object values are dropped (matching JSON semantics). Numbers
 * serialize through JSON's deterministic number formatting (`-0` as `0`).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: cannot canonicalize value of type ${typeof value}`);
}

/** sha256 of a UTF-8 string as lowercase hex, via the ambient WebCrypto (node ≥ 20, browsers). */
async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("facts: WebCrypto (crypto.subtle) is unavailable in this runtime");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The content id for chart inputs (§5): `sha256:<hex>` over the canonicalized
 * inputs JSON. Identical inputs deterministically yield the identical id; any
 * input change (moment, place, system, timeKnown) yields a different one.
 * The id addresses the *inputs*; a cache instance should be paired with a
 * single engine backend, since backend capability (e.g. Chiron) is not part
 * of the hashed inputs.
 */
export async function chartId(inputs: FactsInputs): Promise<string> {
  const canonical = canonicalJson(FactsInputsSchema.parse(inputs));
  return `sha256:${await sha256Hex(canonical)}`;
}

/** Exact angle of each aspect type in degrees (the geometry behind the §6 orb table). */
const ASPECT_ANGLES: Readonly<Record<AspectType, number>> = {
  conjunction: 0,
  semisextile: 30,
  sextile: 60,
  square: 90,
  trine: 120,
  quincunx: 150,
  opposition: 180,
};

/** Wrap a degree difference to the signed short arc (−180, 180]; exactly ±180 resolves positive. */
function normalizeSigned180(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Derive the aspect between two positioned bodies, or undefined when none
 * applies under `orbs`. The pair yields at most one aspect — the smallest-orb
 * match (ties break in ASPECT_TYPES order). Applying/separating is the sign
 * of the orb's closing rate from the two speeds: with x the signed short arc
 * from a to b and e the exact angle, the orb moves at
 * sign(x)·sign(separation − e)·(speedB − speedA), so the aspect applies when
 * that rate is negative. A partile hit (orb 0, rate sign indeterminate) reads
 * as separating — the next instant opens the orb.
 */
function deriveAspect(a: BodyPosition, b: BodyPosition, orbs: OrbTable): Aspect | undefined {
  const offset = normalizeSigned180(b.lon - a.lon);
  const separation = Math.abs(offset);
  let matched: { type: AspectType; orb: number } | undefined;
  for (const type of ASPECT_TYPES) {
    const orb = Math.abs(separation - ASPECT_ANGLES[type]);
    if (orb <= orbs[type] && (matched === undefined || orb < matched.orb)) {
      matched = { type, orb };
    }
  }
  if (matched === undefined) {
    return undefined;
  }
  const orientation = Math.sign(offset);
  const radial = Math.sign(separation - ASPECT_ANGLES[matched.type]);
  const closing = orientation * radial * (a.speed - b.speed);
  return { a: a.body, b: b.body, type: matched.type, orb: matched.orb, applying: closing > 0 };
}

/** Aspects among one chart's own positions (each unordered pair considered once, array order). */
function intraAspects(positions: readonly BodyPosition[], orbs: OrbTable): Aspect[] {
  const aspects: Aspect[] = [];
  for (const [index, a] of positions.entries()) {
    for (const b of positions.slice(index + 1)) {
      const aspect = deriveAspect(a, b, orbs);
      if (aspect !== undefined) {
        aspects.push(aspect);
      }
    }
  }
  return aspects;
}

/**
 * Build the ChartFacts fact set for `inputs` (§5/§6):
 *
 * - content id per `chartId` — identical inputs build identical facts;
 * - positions for all bodies at the chart moment `ut[0]` (any further moments
 *   ride in the content id), with Chiron included only when the backend
 *   advertises the capability (§6: absent ⇒ honest absence, never an estimate);
 * - house cusps only when `timeKnown` is true — a date-only (solar) chart
 *   calls the engine without cusps and the facts carry no cusp fields at all
 *   (§6 honest-absence rules; the minimal solar guard lives here until P.2's
 *   solar module lands, which this builder does not create or modify);
 * - aspects among the chart's own bodies under the §6 default orb table.
 *
 * Cache first: a cache hit returns the stored facts without touching the
 * engine. The result is validated against ChartFactsSchema before it is
 * stored and returned; the facts' `inputs` field is the ChartInputs contract
 * shape (the `timeKnown` flag drives computation and the id, but is not part
 * of the stored contract — the Person record carries it).
 */
export async function buildFacts(
  inputs: FactsInputs,
  engine: EphemerisEngine,
  cache: FactsCache,
): Promise<ChartFacts> {
  const parsed = FactsInputsSchema.parse(inputs);
  const id = await chartId(parsed);
  const cached = await cache.get(id);
  if (cached !== undefined) {
    return cached;
  }

  const moment = parsed.ut[0];
  if (moment === undefined) {
    // Unreachable after the schema's min(1); kept as an honest guard.
    throw new TypeError("buildFacts: inputs carry no chart moment");
  }

  // Positions in the §6 union order (BODIES), Chiron inline behind its
  // backend capability flag (§6: absent ⇒ honest absence, never an estimate).
  const positions: BodyPosition[] = [];
  for (const body of BODIES) {
    if (body === "chiron") {
      if (engine.chiron !== undefined) {
        positions.push({ body, ...engine.chiron(moment) });
      }
      continue;
    }
    positions.push({ body, ...engine.position(body, moment) });
  }

  // Solar guard: timeKnown false ⇒ no houses anywhere (§6).
  const houseCusps = parsed.timeKnown
    ? engine.cusps(moment, parsed.place, parsed.system)
    : undefined;

  const contractInputs: ChartInputs = ChartInputsSchema.parse({
    ut: parsed.ut,
    place: parsed.place,
    system: parsed.system,
  });
  const candidate: ChartFacts = {
    id,
    inputs: contractInputs,
    positions,
    aspects: intraAspects(positions, defaultOrbTable),
  };
  if (houseCusps !== undefined) {
    candidate.cusps = houseCusps;
  }

  const facts = ChartFactsSchema.parse(candidate);
  await cache.put(facts);
  return facts;
}

/**
 * Cross-chart (synastry) aspects between two fact sets: every body of `a`
 * against every body of `b`, under the same orb rules (default: the §6 table).
 *
 * Disambiguation of repeated body ids: in each returned Aspect, `a` is a body
 * of the FIRST chart and `b` a body of the SECOND chart. When both charts
 * contain the same body, the aspect means `firstChart:{body} ×
 * secondChart:{body}` — e.g. `a: "sun", b: "sun"` is person A's Sun against
 * person B's Sun. The result is geometry only — no score, no label (INC-19).
 */
export function aspectsBetween(
  a: ChartFacts,
  b: ChartFacts,
  orbs: OrbTable = defaultOrbTable,
): Aspect[] {
  const aspects: Aspect[] = [];
  for (const pa of a.positions) {
    for (const pb of b.positions) {
      const aspect = deriveAspect(pa, pb, orbs);
      if (aspect !== undefined) {
        aspects.push(aspect);
      }
    }
  }
  return aspects;
}
