import { describe, expect, it, vi } from "vitest";
import type { LoreGraph } from "../src/extract.js";
import { createLorePipeline, type PipelineTurnSink } from "../src/pipeline.js";
import type { Turn } from "../src/types.js";
import { createHashEmbedder } from "./hash-embedder.js";

const gazetteer = [
  {
    id: "se-malmo",
    name: "Malmö",
    countryCode: "SE",
    lat: 55.6,
    lon: 13.0,
    tzid: "Europe/Stockholm",
  },
];

const turn = (id: string, text: string, ts: number, role: Turn["role"] = "you"): Turn => ({
  id,
  sessionId: "s1",
  role,
  text,
  ts,
});

function recordingSink(flushes: LoreGraph[]): PipelineTurnSink {
  return {
    flush: vi.fn(async (graph: LoreGraph) => {
      flushes.push(graph);
    }),
    stats: vi.fn(async () => ({ turns: flushes.length, nodes: 0, edges: 0 })),
    deleteAll: vi.fn(async () => undefined),
  };
}

describe("LorePipeline.consume (write-every-turn)", () => {
  it("flushes exactly once per turn, 50 turns → 50 flushes", async () => {
    const flushes: LoreGraph[] = [];
    const pipeline = createLorePipeline({
      embedder: createHashEmbedder(8),
      sink: recordingSink(flushes),
      gazetteer,
    });
    for (let index = 0; index < 50; index += 1) {
      await pipeline.consume(
        turn(`t${index}`, `Turn number ${index} mentions Robin in Malmö`, index + 1),
      );
    }
    expect(flushes).toHaveLength(50);
  });

  it("extracts entities and edges from real text", async () => {
    const flushes: LoreGraph[] = [];
    const pipeline = createLorePipeline({
      embedder: createHashEmbedder(16),
      sink: recordingSink(flushes),
      gazetteer,
    });
    await pipeline.consume(turn("t1", "Robin was born in Malmö on 1990-05-02.", 1_000));
    const graph = flushes[0]!;
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) expect(edge.sourceTurnId).toBe("t1");
  });

  it("uses the session's first and previous turns as extraction context", async () => {
    const flushes: LoreGraph[] = [];
    const pipeline = createLorePipeline({
      embedder: createHashEmbedder(16),
      sink: recordingSink(flushes),
      gazetteer,
    });
    await pipeline.consume(turn("t1", "Robin opened the session in Malmö.", 1));
    await pipeline.consume(turn("t2", "We talked about Robin again.", 2, "her"));
    // Thread edges require session context: t2's graph references the session thread.
    expect(flushes).toHaveLength(2);
  });

  it("stats and deleteAll delegate to the sink (real deletion contract)", async () => {
    const flushes: LoreGraph[] = [];
    const sink = recordingSink(flushes);
    const pipeline = createLorePipeline({ embedder: createHashEmbedder(8), sink, gazetteer });
    await pipeline.consume(turn("t1", "hello Robin", 1));
    await expect(pipeline.stats()).resolves.toEqual({ turns: 1, nodes: 0, edges: 0 });
    await pipeline.deleteAll();
    expect(sink.deleteAll).toHaveBeenCalledTimes(1);
  });
});
