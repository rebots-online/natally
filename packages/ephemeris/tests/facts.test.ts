import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  aspectsBetween,
  type BuildFactsInputs,
  buildFacts,
  type FactsCache,
  type FactsEngine,
} from "../src/facts.ts";
import { SwephEngine } from "../src/sweph/engine.ts";
import type { ChartFacts } from "../src/types.ts";

const engine = new SwephEngine();
const input: BuildFactsInputs = {
  ut: [2448014.105555556],
  place: { lat: 55.6, lon: 13 },
  system: "P",
  timeKnown: true,
};
function cache() {
  const values = new Map<string, unknown>();
  const store: FactsCache = {
    get: (key) => values.get(key),
    put: (key, value) => {
      values.set(key, value);
    },
  };
  return { values, store };
}
beforeAll(async () => {
  await engine.init({
    assetRoot: new URL("../../../VENDORED/sweph-wasm/dist/", import.meta.url),
    fetch: async (url: URL) => {
      const bytes = new Uint8Array(await readFile(url));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    },
  });
});

describe("facts: deterministic id, cache hit, synastry aspects computed", () => {
  it("canonicalizes object keys without changing the requested inputs", async () => {
    const one = await buildFacts(input, { engine, cache: cache().store });
    const two = await buildFacts(
      { timeKnown: true, system: "P", place: { lon: 13, lat: 55.6 }, ut: [...input.ut] },
      { engine, cache: cache().store },
    );
    expect(one.id).toMatch(/^[a-f0-9]{64}$/);
    expect(two).toEqual(one);
    expect(one.inputs.ut).toEqual(input.ut);
    expect(one.positions).toHaveLength(13);
    expect(one.cusps?.cusps).toHaveLength(12);
    expect(one.aspects.length).toBeGreaterThan(0);
  });
  it("uses the cached real result without recalculation", async () => {
    const store = cache().store;
    const first = await buildFacts(input, { engine, cache: store });
    const spy = vi.spyOn(engine, "position");
    try {
      expect(await buildFacts(input, { engine, cache: store })).toEqual(first);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("keeps known-time and house-free facts in different cache entries", async () => {
    const { store, values } = cache();
    const timed = await buildFacts(input, { engine, cache: store });
    const noHouses = await buildFacts({ ...input, timeKnown: false }, { engine, cache: store });
    expect(noHouses.id).not.toBe(timed.id);
    expect(noHouses.cusps).toBeUndefined();
    expect(noHouses.positions).toEqual(timed.positions);
    expect(values.size).toBe(2);
  });
  it("omits Chiron when the backend capability is absent and isolates its cache", async () => {
    const withoutChiron: FactsEngine = {
      id: engine.id,
      position: engine.position.bind(engine),
      cusps: engine.cusps.bind(engine),
      aspects: engine.aspects.bind(engine),
    };
    const { store, values } = cache();
    await buildFacts(input, { engine, cache: store });
    const facts = await buildFacts(input, { engine: withoutChiron, cache: store });
    expect(facts.positions).toHaveLength(12);
    expect(facts.positions.some((position) => position.body === "chiron")).toBe(false);
    expect(values.size).toBe(2);
  });
  it("freezes nested calculation data and recovers from malformed cache rows", async () => {
    const { store, values } = cache();
    const facts = await buildFacts(input, { engine, cache: store });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.inputs.ut)).toBe(true);
    expect(Object.isFrozen(facts.positions[0])).toBe(true);
    expect(() => {
      facts.inputs.ut.push(0);
    }).toThrow();
    for (const key of values.keys()) values.set(key, { id: facts.id });
    expect(await buildFacts(input, { engine, cache: store })).toEqual(facts);
  });
  it("computes actual cross-aspects for two natal plates", async () => {
    const a = await buildFacts(input, { engine, cache: cache().store });
    const b = await buildFacts(
      { ...input, ut: [input.ut[0]! + 7] },
      { engine, cache: cache().store },
    );
    const result = await aspectsBetween(a, b, engine);
    const sun = result.find((aspect) => aspect.a === "sun" && aspect.b === "sun");
    expect(sun?.type).toBe("conjunction");
    expect(sun?.orb).toBeGreaterThan(6);
    expect(sun?.orb).toBeLessThan(8);
    expect(typeof sun?.applying).toBe("boolean");
    expect(Object.keys(result[0]!)).toEqual(["a", "b", "type", "orb", "applying"]);
  });
  it("does not turn absent or multiple times into an invented natal instant", async () => {
    await expect(
      buildFacts({ ...input, ut: [] }, { engine, cache: cache().store }),
    ).rejects.toThrow();
    await expect(
      buildFacts({ ...input, ut: [1, 2] }, { engine, cache: cache().store }),
    ).rejects.toThrow("exactly one UT");
  });
  it("retains synastry pairs for two people with identical chart inputs", async () => {
    const facts = await buildFacts(input, { engine, cache: cache().store });
    expect(facts.aspects.some((aspect) => aspect.a === aspect.b)).toBe(false);
    const pairs = await aspectsBetween(facts, structuredClone(facts), engine);
    expect(pairs).toContainEqual({
      a: "sun",
      b: "sun",
      type: "conjunction",
      orb: 0,
      applying: false,
    });
  });
  it.each([false, true])("snapshots timeKnown=%s before asynchronous work", async (timeKnown) => {
    const requested = { ...input, timeKnown };
    const store = cache().store;
    const pending = buildFacts(requested, { engine, cache: store });
    requested.timeKnown = !timeKnown;
    const facts = await pending;
    expect(facts.cusps !== undefined).toBe(timeKnown);
    expect(await buildFacts({ ...input, timeKnown }, { engine, cache: store })).toEqual(facts);
  });
  it("supports an asynchronous worker engine without changing calculation results", async () => {
    const proxy: FactsEngine = {
      id: engine.id,
      position: async (...args) => engine.position(...args),
      cusps: async (...args) => engine.cusps(...args),
      aspects: async (...args) => engine.aspects(...args),
      chiron: async (...args) => engine.chiron(...args),
    };
    const result: ChartFacts = await buildFacts(input, { engine: proxy, cache: cache().store });
    expect(result).toEqual(await buildFacts(input, { engine, cache: cache().store }));
  });
});
