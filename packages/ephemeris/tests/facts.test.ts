import { expect, it } from "vitest";
import {
  aspectsBetween,
  buildFacts,
  canonicalJson,
  chartId,
  type FactsCache,
  type FactsInputs,
} from "../src/facts";
import { type ChartFacts, defaultOrbTable } from "../src/types";
import { DeterministicEngine } from "./fixtures/deterministic-engine";

// # P.4 — ChartFacts builder + cache
//
// Runs entirely against the real deterministic engine fixture (no mocks):
// fixed longitudes/speeds engineered so the sun–moon conjunction is
// separating and the sun–mercury trine is applying (see the fixture header).

/** Real in-memory KV — the injectable FactsCache a caller would bind to the charts table (X.1 adapts). */
class MemoryFactsCache implements FactsCache {
  private readonly entries = new Map<string, ChartFacts>();

  async get(id: string): Promise<ChartFacts | undefined> {
    return this.entries.get(id);
  }

  async put(facts: ChartFacts): Promise<void> {
    this.entries.set(facts.id, facts);
  }
}

const timedInputs: FactsInputs = {
  ut: [2460676.5, 2460677.986],
  place: { lat: 52.52, lon: 13.405, elevation: 34 },
  system: "P",
  timeKnown: true,
};

// Date-only birth: solar chart — same engine geometry, different content id,
// and no houses anywhere (§6 honest absence).
const solarInputs: FactsInputs = { ...timedInputs, system: "W", timeKnown: false };

// A second person: different place ⇒ different id, cross-aspects for synastry.
const partnerInputs: FactsInputs = { ...timedInputs, place: { lat: 40.7128, lon: -74.006 } };

it("facts: deterministic id, cache hit, synastry aspects computed", async () => {
  // -- Deterministic id: two fresh engines build the identical content id. --
  const [first, rebuilt] = await Promise.all([
    buildFacts(timedInputs, new DeterministicEngine(), new MemoryFactsCache()),
    buildFacts(timedInputs, new DeterministicEngine(), new MemoryFactsCache()),
  ]);
  expect(first.id).toBe(rebuilt.id);
  expect(first.id).toBe(await chartId(timedInputs));
  expect(first.id).toMatch(/^sha256:[0-9a-f]{64}$/);

  // Canonicalization is key-sorted, whitespace-free, array-order preserving.
  expect(canonicalJson({ b: 1, a: [2, null], c: { y: 1, x: -0 } })).toBe(
    '{"a":[2,null],"b":1,"c":{"x":0,"y":1}}',
  );

  // Any input change — including the timeKnown flag — changes the content id.
  const solar = await buildFacts(solarInputs, new DeterministicEngine(), new MemoryFactsCache());
  expect(solar.id).not.toBe(first.id);

  // -- Cache hit: the second build never touches the engine. --
  const engine = new DeterministicEngine();
  const cache = new MemoryFactsCache();
  const built = await buildFacts(timedInputs, engine, cache);
  // 12 bodies via position() + chiron via the capability flag; timed ⇒ one cusps call.
  expect(built.positions).toHaveLength(13);
  expect(engine.calls).toEqual({ position: 12, chiron: 1, cusps: 1 });

  const cached = await buildFacts(timedInputs, engine, cache);
  expect(cached).toEqual(built);
  expect(engine.calls).toEqual({ position: 12, chiron: 1, cusps: 1 }); // counter stays flat

  // -- Engineered aspects: one separating, one applying, from speeds. --
  expect(built.aspects).toHaveLength(7); // 2 engineered + 5 incidental oppositions (fixture header)
  expect(built.aspects.find((aspect) => aspect.a === "sun" && aspect.b === "moon")).toEqual({
    a: "sun",
    b: "moon",
    type: "conjunction",
    orb: 3,
    applying: false, // moon outruns the sun: the 3° gap opens
  });
  expect(built.aspects.find((aspect) => aspect.a === "sun" && aspect.b === "mercury")).toEqual({
    a: "sun",
    b: "mercury",
    type: "trine",
    orb: 6,
    applying: true, // mercury slower than the sun: the 114° gap closes toward 120°
  });
  for (const aspect of built.aspects) {
    expect(aspect.orb).toBeLessThanOrEqual(defaultOrbTable[aspect.type]);
  }

  // -- Solar chart: no cusp fields anywhere, engine never asked for houses. --
  const solarEngine = new DeterministicEngine();
  const solarFacts = await buildFacts(solarInputs, solarEngine, new MemoryFactsCache());
  expect(solarFacts.cusps).toBeUndefined();
  expect("cusps" in solarFacts).toBe(false);
  expect(solarEngine.calls.cusps).toBe(0);

  // -- Synastry: cross-aspects between two charts, geometry only (INC-19). --
  const natal = await buildFacts(timedInputs, new DeterministicEngine(), new MemoryFactsCache());
  const partner = await buildFacts(
    partnerInputs,
    new DeterministicEngine(),
    new MemoryFactsCache(),
  );
  expect(partner.id).not.toBe(natal.id);
  const cross = aspectsBetween(natal, partner);
  // 13 same-body pairs (partile conjunctions) + the fixture's 7 in-orb pairs
  // mirrored in both orientations.
  expect(cross).toHaveLength(27);
  expect(cross.find((aspect) => aspect.a === "sun" && aspect.b === "moon")).toEqual({
    a: "sun",
    b: "moon",
    type: "conjunction",
    orb: 3,
    applying: false,
  });
  expect(cross.find((aspect) => aspect.a === "sun" && aspect.b === "mercury")).toEqual({
    a: "sun",
    b: "mercury",
    type: "trine",
    orb: 6,
    applying: true,
  });
  // Orientation flip stays physically consistent: moon(A) vs sun(B) is the
  // moon 3° ahead of the sun and pulling away ⇒ separating in both readings.
  expect(cross.find((aspect) => aspect.a === "moon" && aspect.b === "sun")).toEqual({
    a: "moon",
    b: "sun",
    type: "conjunction",
    orb: 3,
    applying: false,
  });
  for (const aspect of cross) {
    expect(aspect.orb).toBeLessThanOrEqual(defaultOrbTable[aspect.type]);
    // Aspect is exactly { a, b, type, orb, applying } — no score, no label (INC-19).
    expect(Object.keys(aspect).sort()).toEqual(["a", "applying", "b", "orb", "type"]);
  }
});
