// natally — inference host tests (task C.1, ARCHITECTURE §7.1).
// Everything is injected: recorded engine factories, a fake wllama handle, a
// recorded emit fn. No network, no model, no console.

import type { CompanionEvent } from "@natally/lore/types";
import { describe, expect, it } from "vitest";
import { createWebEngineFactory, type WllamaHandle, type WllamaLoadConfig } from "./inference-web";
import {
  type CompleteOptions,
  complete,
  type EngineFactory,
  type EngineParams,
  type InferenceContext,
  kvCacheType,
  mapEngineParams,
  type StreamingEngine,
  selectLane,
  type TurboQuantParams,
} from "./lane";

const MODEL_REF = "natally-models/chat-turboquant-Q4_K_M.gguf";
const QUANT: TurboQuantParams = { weights: "Q4_K_M", kv: "q8_0" };
const TURN_ID = "turn-0001";
const STREAMED_TOKENS = ["Hel", "lo ", "the", "re."];

function ctx(): InferenceContext {
  return {
    turnId: TURN_ID,
    systemPrompt: "You are natally — warm, approachable, ultra-relatable (D13).",
    messages: [{ role: "user", content: "Read me my sky." }],
  };
}

/** A factory that records every `EngineParams` it is handed and returns an
 * engine streaming `STREAMED_TOKENS` in order. */
function recordingFactory(): {
  factory: EngineFactory;
  recorded: EngineParams[];
} {
  const recorded: EngineParams[] = [];
  const factory: EngineFactory = (params) => {
    recorded.push(params);
    const engine: StreamingEngine = {
      async complete(_ctx, onToken) {
        for (const text of STREAMED_TOKENS) {
          onToken(text);
        }
      },
      dispose() {},
    };
    return engine;
  };
  return { factory, recorded };
}

function completeOptions(
  lane: "native" | "web",
  factory: EngineFactory,
  quant: TurboQuantParams,
  events: CompanionEvent[],
): CompleteOptions {
  return {
    lane,
    engineFactory: factory,
    modelRef: MODEL_REF,
    quant,
    emit: (event) => {
      events.push(event);
    },
  };
}

describe("inference lane selection", () => {
  it("selects native when the injected capability flag is true, web when false", () => {
    expect(selectLane(true)).toBe("native");
    expect(selectLane(false)).toBe("web");
  });
});

describe("inference: turboquant params (Q4_K_M, kv q8_0) mapped on both lanes", () => {
  it("hands both lane factories an identical, structurally-copied quant object", async () => {
    const nativeRun = recordingFactory();
    const webRun = recordingFactory();
    const nativeEvents: CompanionEvent[] = [];
    const webEvents: CompanionEvent[] = [];

    await complete(
      ctx(),
      () => {},
      completeOptions("native", nativeRun.factory, QUANT, nativeEvents),
    );
    await complete(ctx(), () => {}, completeOptions("web", webRun.factory, QUANT, webEvents));

    expect(nativeRun.recorded).toHaveLength(1);
    expect(webRun.recorded).toHaveLength(1);
    const [nativeParams] = nativeRun.recorded;
    const [webParams] = webRun.recorded;
    expect(nativeParams).toBeDefined();
    expect(webParams).toBeDefined();
    if (nativeParams === undefined || webParams === undefined) {
      return;
    }

    // The turboquant law itself: Q4_K_M weights + q8_0 KV on BOTH lanes.
    expect(nativeParams.quant).toEqual({ weights: "Q4_K_M", kv: "q8_0" });
    expect(webParams.quant).toEqual({ weights: "Q4_K_M", kv: "q8_0" });
    // Identical mapping across lanes (lane is the only deliberate difference).
    expect(webParams.quant).toEqual(nativeParams.quant);
    expect(webParams.modelRef).toBe(nativeParams.modelRef);
    expect(webParams.maxTokens).toBe(nativeParams.maxTokens);
    // The mapping is a structural copy, never an alias of the caller's object.
    expect(nativeParams.quant).not.toBe(QUANT);
    expect(nativeParams.lane).toBe("native");
    expect(webParams.lane).toBe("web");
  });

  it("maps maxTokens from the context and the q4r8 recursor override through kvCacheType", () => {
    const withRecursor: TurboQuantParams = { ...QUANT, recursor: "q4r8" };
    const plain = mapEngineParams("native", MODEL_REF, QUANT, 128);
    const recursor = mapEngineParams("web", MODEL_REF, withRecursor, undefined);
    expect(plain.maxTokens).toBe(128);
    expect(plain.quant).toEqual({ weights: "Q4_K_M", kv: "q8_0" });
    expect("maxTokens" in recursor).toBe(false);
    expect(recursor.quant).toEqual({ weights: "Q4_K_M", kv: "q8_0", recursor: "q4r8" });
    // §7.1: q4r8 recursor tier overrides the q8_0 KV default.
    expect(kvCacheType(QUANT)).toBe("q8_0");
    expect(kvCacheType(withRecursor)).toBe("q4r8");
  });
});

describe("inference token streaming", () => {
  it("preserves token order on both lanes and publishes CompanionEvent tokens", async () => {
    for (const lane of ["native", "web"] as const) {
      const { factory, recorded } = recordingFactory();
      const events: CompanionEvent[] = [];
      const tokens: string[] = [];

      await complete(
        ctx(),
        (text) => tokens.push(text),
        completeOptions(lane, factory, QUANT, events),
      );

      expect(tokens).toEqual(STREAMED_TOKENS);
      expect(events).toEqual(
        STREAMED_TOKENS.map((text) => ({ type: "token", turnId: TURN_ID, text })),
      );
      // Every token reached the caller before (or with) its bus event.
      expect(events.every((event) => event.type === "token" && tokens.includes(event.text))).toBe(
        true,
      );
      expect(recorded[0]?.lane).toBe(lane);
    }
  });

  it("streams ordered deltas through the web engine's wllama adapter", async () => {
    const loadCalls: Array<{ url: string; config?: WllamaLoadConfig }> = [];
    let resident = false;
    const handle: WllamaHandle = {
      async loadModelUrl(url, config) {
        loadCalls.push({ url, config });
        resident = true;
      },
      isModelLoaded: () => resident,
      async createChatCompletion(messages, options) {
        expect(messages[0]).toEqual({
          role: "system",
          content: "You are natally — warm, approachable, ultra-relatable (D13).",
        });
        expect(messages[1]?.role).toBe("user");
        let current = "";
        for (const piece of STREAMED_TOKENS) {
          current += piece;
          options.onNewToken(0, new Uint8Array(0), current, {});
        }
        return current;
      },
      async exit() {
        resident = false;
      },
    };

    const events: CompanionEvent[] = [];
    const tokens: string[] = [];
    await complete(
      ctx(),
      (text) => tokens.push(text),
      completeOptions("web", createWebEngineFactory(handle), QUANT, events),
    );

    expect(tokens).toEqual(STREAMED_TOKENS);
    expect(events).toEqual(
      STREAMED_TOKENS.map((text) => ({ type: "token", turnId: TURN_ID, text })),
    );
    // Lazy load: the wllama handle received exactly the catalogue artifact and
    // the §7.1 KV pass-through keys.
    expect(loadCalls).toEqual([
      {
        url: MODEL_REF,
        config: { n_ctx: 4096, cache_type_k: "q8_0", cache_type_v: "q8_0" },
      },
    ]);
  });
});

describe("inference lazy engine build", () => {
  it("never calls the factory before the first complete", async () => {
    const { factory, recorded } = recordingFactory();
    const events: CompanionEvent[] = [];
    const options = completeOptions("native", factory, QUANT, events);

    selectLane(true);
    expect(recorded).toHaveLength(0);

    await complete(ctx(), () => {}, options);
    expect(recorded).toHaveLength(1);
  });

  it("throws before building any engine when the context violates the event contract", async () => {
    const { factory, recorded } = recordingFactory();
    const events: CompanionEvent[] = [];
    const options = completeOptions("native", factory, QUANT, events);
    const bad: InferenceContext = { ...ctx(), turnId: "  " };

    await expect(complete(bad, () => {}, options)).rejects.toThrow(/turnId/);
    expect(recorded).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
