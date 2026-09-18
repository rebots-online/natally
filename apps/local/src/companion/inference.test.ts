import { describe, expect, it, vi } from "vitest";
import { createCompanionBus } from "./bus.js";
import { buildFencePrompt } from "./fence.js";
import { createWebInferenceEngine, type WllamaEngine } from "./inference-web.js";
import {
  createInferenceHost,
  createNativeEngine,
  type EngineFactoryInput,
  type FenceContext,
  INFERENCE_CAPABILITIES,
  type InferenceEngineFactory,
  type NativeInferenceBridge,
  type NativeInferenceRequest,
  type StoredInferenceModel,
  turboquantParams,
} from "./lane.js";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: ipc.invoke,
  Channel: class {
    onmessage?: (event: unknown) => void;
  },
}));

const messages = buildFencePrompt({
  tier1: { charts: [], glossary: [] },
  memory: [],
  liveTurn: { id: "turn-1", text: "Hello" },
  toolResults: [],
});
const ctx: FenceContext = { messages, maxTokens: 32 };
const assets = { wasm: "/inference/wllama.wasm" };
const webModel: StoredInferenceModel = {
  lane: "web",
  id: "verified-chat-sha256",
  quantization: "Q4_K_M",
  files: [new Blob(["gguf-fixture"])],
};
const nativeModel: StoredInferenceModel = {
  lane: "native",
  id: "verified-chat-sha256",
  quantization: "Q4_K_M",
  path: "/models/chat.gguf",
};

function input(model: StoredInferenceModel): EngineFactoryInput {
  return { lane: model.lane, model, params: turboquantParams(4096, 2), onReady: vi.fn() };
}

function testWllama(
  chunks: { content?: string; reason?: string; finish?: string }[] = [
    { reason: "private reasoning" },
    { content: "Hello" },
    { content: " 🌙" },
    { finish: "stop" },
  ],
) {
  const engine = {
    setCompat: vi.fn(),
    loadModel: vi.fn().mockResolvedValue(undefined),
    getModelMetadata: vi.fn(() => ({ meta: { "general.file_type": "15" } })),
    createChatCompletion: vi.fn(async function* () {
      for (const part of chunks)
        yield {
          choices: [
            {
              delta: {
                content: part.content,
                reasoning_content: part.reason,
              },
              finish_reason: part.finish ?? null,
            },
          ],
        };
    }),
    exit: vi.fn().mockResolvedValue(undefined),
  };
  // The injected fake is deliberately limited to the engine surface under test.
  return { engine, factory: vi.fn(async () => engine as unknown as WllamaEngine) };
}

describe("inference", () => {
  it("reserves enough default context for the factual fence and a generated reply", () => {
    expect(turboquantParams()).toMatchObject({ contextSize: 16_384, threads: 4 });
  });

  it("requires the lane selected by I.3", () => {
    const common = { bus: createCompanionBus(), storage: { resolveChatModel: vi.fn() } };
    expect(createInferenceHost({ ...common, lane: "native" }).lane).toBe("native");
    expect(createInferenceHost({ ...common, lane: "web" }).lane).toBe("web");
    expect(() => createInferenceHost({ ...common, lane: undefined as never })).toThrow("I.3");
  });

  it.each(["web", "native"] as const)(
    "lazily maps atomic params and streams bus deltas on %s",
    async (lane) => {
      const bus = createCompanionBus();
      const events: string[] = [];
      bus.subscribe("token", ({ token }) => events.push(token));
      const storage = {
        resolveChatModel: vi.fn(async () => (lane === "web" ? webModel : nativeModel)),
      };
      const disposal = vi.fn(async () => {});
      const factory = vi.fn<InferenceEngineFactory>(async (args) => {
        expect(args.params).toEqual({
          weights: "Q4_K_M",
          cacheTypeK: "q8_0",
          cacheTypeV: "q8_0",
          recursor: "unsupported",
          contextSize: 16_384,
          threads: 2,
        });
        expect(args.model.quantization).toBe("Q4_K_M");
        args.onReady();
        return {
          complete: async (request, onToken) => {
            expect(request.messages).toEqual(messages);
            onToken("Hello");
            onToken("");
            onToken(" 🌙");
          },
          dispose: disposal,
        };
      });
      const host = createInferenceHost({ storage, bus, engineFactory: factory, threads: 2, lane });
      expect(storage.resolveChatModel).not.toHaveBeenCalled();
      expect(factory).not.toHaveBeenCalled();
      const onToken = vi.fn();
      expect(await host.complete(ctx, onToken)).toBe("Hello 🌙");
      expect(storage.resolveChatModel).toHaveBeenCalledWith(lane, "Q4_K_M");
      expect(events).toEqual(["Hello", " 🌙"]);
      expect(onToken.mock.calls).toEqual([["Hello"], [" 🌙"]]);
      expect(bus.getSnapshot().engineLoad).toBe(1);
      await host.complete(ctx, onToken);
      expect(factory).toHaveBeenCalledTimes(1);
      await host.dispose();
      await host.dispose();
      expect(disposal).toHaveBeenCalledTimes(1);
      await expect(host.complete(ctx, onToken)).rejects.toThrow("disposed");
    },
  );

  it("turboquant params (Q4_K_M, kv q8_0) mapped on both lanes", async () => {
    const { engine, factory } = testWllama();
    const web = await createWebInferenceEngine(input(webModel), assets, factory);
    expect(engine.loadModel).toHaveBeenCalledWith(
      webModel.files,
      expect.objectContaining({
        cache_type_k: "q8_0",
        cache_type_v: "q8_0",
        flash_attn: true,
        n_gpu_layers: 0,
        offload_kqv: false,
        no_kv_offload: true,
        ctx_shift: false,
      }),
    );
    let received: NativeInferenceRequest | undefined;
    const bridge: NativeInferenceBridge = {
      stream: async (request, onEvent) => {
        received = request;
        onEvent({ type: "done" });
      },
      cancel: vi.fn(async () => {}),
      unload: vi.fn(async () => {}),
    };
    const native = await createNativeEngine(input(nativeModel), bridge);
    await native.complete(ctx, vi.fn());
    expect(received).toMatchObject({
      modelPath: "/models/chat.gguf",
      modelId: nativeModel.id,
      params: {
        weights: "Q4_K_M",
        cacheTypeK: "q8_0",
        cacheTypeV: "q8_0",
        recursor: "unsupported",
      },
      messages,
      maxTokens: 32,
    });
    await web.dispose();
  });

  it("preserves the C.2 fenced prompt and emits only web content deltas", async () => {
    const { engine, factory } = testWllama();
    const web = await createWebInferenceEngine(input(webModel), assets, factory);
    const tokens: string[] = [];
    await web.complete(ctx, (token) => tokens.push(token));
    expect(tokens).toEqual(["Hello", " 🌙"]);
    expect(engine.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        stream: true,
        max_tokens: 32,
        cache_prompt: false,
        temperature: 0.7,
        top_k: 40,
        top_p: 0.9,
      }),
    );
    expect(messages[0]?.role).toBe("system");
  });

  it("reports q4r8 unsupported even on a capable device", () => {
    const host = createInferenceHost({
      lane: "web",
      bus: createCompanionBus(),
      storage: { resolveChatModel: vi.fn() },
    });
    expect(host.capabilities).toBe(INFERENCE_CAPABILITIES);
    expect(host.capabilities.q4r8.supported).toBe(false);
    expect(host.capabilities.q4r8.reason).toContain("Neither pinned engine");
  });

  it("rejects the wrong actual GGUF quantization and releases the worker", async () => {
    const { engine, factory } = testWllama();
    engine.getModelMetadata.mockReturnValue({ meta: { "general.file_type": "2" } });
    const args = input(webModel);
    await expect(createWebInferenceEngine(args, assets, factory)).rejects.toThrow("not Q4_K_M");
    expect(args.onReady).not.toHaveBeenCalled();
    expect(engine.exit).toHaveBeenCalledTimes(1);
  });

  it("cleans up a failed web load and preserves its failure", async () => {
    const { engine, factory } = testWllama();
    engine.loadModel.mockRejectedValue(new Error("WASM OOM"));
    engine.exit.mockRejectedValue(new Error("worker already dead"));
    await expect(createWebInferenceEngine(input(webModel), assets, factory)).rejects.toThrow(
      "WASM OOM",
    );
    expect(engine.exit).toHaveBeenCalledTimes(1);
  });

  it("rejects missing storage without initializing any inference engine", async () => {
    const factory = vi.fn<InferenceEngineFactory>();
    const bus = createCompanionBus();
    const host = createInferenceHost({
      lane: "web",
      bus,
      engineFactory: factory,
      storage: { resolveChatModel: async () => null },
    });
    await expect(host.complete(ctx, vi.fn())).rejects.toThrow("not installed");
    expect(factory).not.toHaveBeenCalled();
    expect(bus.getSnapshot().modelPresent).toBe(false);
  });

  it("rejects a wrong storage lane rather than falling back", async () => {
    const factory = vi.fn<InferenceEngineFactory>();
    const host = createInferenceHost({
      lane: "web",
      bus: createCompanionBus(),
      engineFactory: factory,
      storage: { resolveChatModel: async () => nativeModel },
    });
    await expect(host.complete(ctx, vi.fn())).rejects.toThrow("does not match");
    expect(factory).not.toHaveBeenCalled();
  });

  it("serializes simultaneous turns and snapshots pending messages", async () => {
    let active = 0;
    const seen: string[] = [];
    const factory: InferenceEngineFactory = async () => ({
      complete: async (request, token) => {
        expect(++active).toBe(1);
        await Promise.resolve();
        const text = request.messages[0]?.content ?? "missing test prompt";
        seen.push(text);
        token(text);
        active--;
      },
      dispose: async () => {},
    });
    const host = createInferenceHost({
      lane: "web",
      bus: createCompanionBus(),
      engineFactory: factory,
      storage: { resolveChatModel: async () => webModel },
    });
    const mutable = [{ role: "user" as const, content: "second" }];
    const first = host.complete({ messages: [{ role: "user", content: "first" }] }, vi.fn());
    const second = host.complete({ messages: mutable }, vi.fn());
    mutable[0].content = "mutated";
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    expect(seen).toEqual(["first", "second"]);
  });

  it("disposes old model on identity changes and removal", async () => {
    let selected: StoredInferenceModel | null = webModel;
    const dispose = vi.fn(async () => {});
    const factory = vi.fn<InferenceEngineFactory>(async () => ({
      complete: async () => {},
      dispose,
    }));
    const host = createInferenceHost({
      lane: "web",
      bus: createCompanionBus(),
      engineFactory: factory,
      storage: { resolveChatModel: async () => selected },
    });
    await host.complete(ctx, vi.fn());
    selected = { ...webModel, id: "new-content-hash" };
    await host.complete(ctx, vi.fn());
    expect(dispose).toHaveBeenCalledTimes(1);
    selected = null;
    await expect(host.complete(ctx, vi.fn())).rejects.toThrow("not installed");
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("recovers from an engine failure without replaying partial tokens", async () => {
    const dispose = vi.fn(async () => {});
    const factory = vi
      .fn<InferenceEngineFactory>()
      .mockResolvedValueOnce({
        complete: async (_, token) => {
          token("partial");
          throw new Error("decode failed");
        },
        dispose,
      })
      .mockResolvedValueOnce({
        complete: async (_, token) => {
          token("fresh");
        },
        dispose,
      });
    const host = createInferenceHost({
      lane: "web",
      bus: createCompanionBus(),
      engineFactory: factory,
      storage: { resolveChatModel: async () => webModel },
    });
    await expect(host.complete(ctx, vi.fn())).rejects.toThrow("decode failed");
    expect(await host.complete(ctx, vi.fn())).toBe("fresh");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does not claim success for web token-budget exhaustion", async () => {
    const { factory } = testWllama([{ content: "partial" }, { finish: "length" }]);
    const web = await createWebInferenceEngine(input(webModel), assets, factory);
    await expect(web.complete(ctx, vi.fn())).rejects.toThrow("token limit");
  });

  it("rejects web streams that end without an explicit completion boundary", async () => {
    const { factory } = testWllama([{ content: "partial" }]);
    const web = await createWebInferenceEngine(input(webModel), assets, factory);
    await expect(web.complete(ctx, vi.fn())).rejects.toThrow("completion boundary");
  });

  it("waits for native channel completion after the IPC command resolves", async () => {
    let channel: { onmessage: (event: object) => void } | undefined;
    ipc.invoke.mockImplementation(async (command, args) => {
      if (command === "plugin:inference|inference_complete") channel = args.onEvent;
    });
    const native = await createNativeEngine(input(nativeModel));
    const onToken = vi.fn();
    let completed = false;
    const result = native.complete(ctx, onToken).then(() => {
      completed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ipc.invoke).toHaveBeenCalledWith(
      "plugin:inference|inference_complete",
      expect.anything(),
    );
    expect(completed).toBe(false);
    if (!channel) throw new Error("Expected native channel");
    channel.onmessage({ type: "ready" });
    channel.onmessage({ type: "token", token: "hello" });
    channel.onmessage({ type: "done" });
    await result;
    expect(onToken).toHaveBeenCalledWith("hello");
    expect(completed).toBe(true);
    await native.dispose();
    expect(ipc.invoke).toHaveBeenCalledWith("plugin:inference|inference_unload");
  });

  it("preserves consumer errors when cancellation rejects the native IPC command", async () => {
    const failure = new Error("consumer failed");
    const native = await createNativeEngine(input(nativeModel), {
      stream: async (_, event) => {
        event({ type: "token", token: "hello" });
        throw new Error("Inference cancelled");
      },
      cancel: async () => {},
      unload: async () => {},
    });
    await expect(
      native.complete(ctx, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("honors web cancellation without delivering later chunks", async () => {
    const abort = new AbortController();
    const { factory, engine } = testWllama();
    const web = await createWebInferenceEngine(input(webModel), assets, factory);
    const onToken = vi.fn(() => abort.abort());
    await expect(web.complete({ ...ctx, signal: abort.signal }, onToken)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(onToken).toHaveBeenCalledTimes(1);
    const call = engine.createChatCompletion.mock.calls[0] as unknown as [
      { abortSignal: AbortSignal },
    ];
    expect(call[0].abortSignal.aborted).toBe(true);
  });

  it("rejects already aborted turns before accessing storage", async () => {
    const storage = { resolveChatModel: vi.fn(async () => webModel) };
    const host = createInferenceHost({ lane: "web", bus: createCompanionBus(), storage });
    await expect(
      host.complete({ ...ctx, signal: AbortSignal.abort() }, vi.fn()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.resolveChatModel).not.toHaveBeenCalled();
  });

  it("streams native channel events and repeats cancellation after registration", async () => {
    const abort = new AbortController();
    const args = input(nativeModel);
    const bridge: NativeInferenceBridge = {
      stream: async (_, event) => {
        abort.abort();
        event({ type: "started" });
        event({ type: "token", token: "too late" });
        event({ type: "done" });
      },
      cancel: vi.fn(async () => {}),
      unload: vi.fn(async () => {}),
    };
    const native = await createNativeEngine(args, bridge);
    const token = vi.fn();
    await expect(native.complete({ ...ctx, signal: abort.signal }, token)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(token).not.toHaveBeenCalled();
    expect(bridge.cancel).toHaveBeenCalled();
    expect(args.onReady).not.toHaveBeenCalled();
  });

  it("maps native readiness, tokens and failures through the real adapter", async () => {
    const args = input(nativeModel);
    const bridge: NativeInferenceBridge = {
      stream: async (_, event) => {
        event({ type: "started" });
        event({ type: "ready" });
        event({ type: "token", token: "🌙" });
        event({ type: "error", message: "decode failed" });
      },
      cancel: vi.fn(async () => {}),
      unload: vi.fn(async () => {}),
    };
    const native = await createNativeEngine(args, bridge);
    const token = vi.fn();
    await expect(native.complete(ctx, token)).rejects.toThrow("decode failed");
    expect(args.onReady).toHaveBeenCalledTimes(1);
    expect(token).toHaveBeenCalledWith("🌙");
    expect(bridge.cancel).toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, 131073])("rejects invalid context size %s", (size) => {
    expect(() => turboquantParams(size)).toThrow("context size");
  });
});
