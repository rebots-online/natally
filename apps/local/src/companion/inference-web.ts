// natally — web leg of the inference host: a `StreamingEngine` factory that
// wraps an injected wllama handle (task C.1, ARCHITECTURE §7.1).
//
// The wllama handle is injected STRUCTURALLY (no `@wllama/wllama` dependency is
// declared by this task): the interfaces below are the exact surface this
// module touches, and the production handle must satisfy them. wllama is not
// yet present in node_modules, so its loader config is documented here as
// pass-through config keys — wllama forwards `LoadModelConfig` verbatim into
// the llama.cpp context params, which is precisely where §7.1's KV-cache
// compression must land:
//
//   - `n_ctx`          — the companion context window (fixed 4096 until C.2
//                        owns the fence budget law).
//   - `cache_type_k`   — KV key-cache ggml type: `q8_0` default, `q4r8` when
//                        the recursor tier flag is set (`kvCacheType`, lane.ts).
//   - `cache_type_v`   — KV value-cache ggml type: same tier as the keys
//                        (atomic turboquant — keys and values compress
//                        together, §7.1).
//
// The WEIGHTS tier (Q4_K_M) is deliberately NOT a loader key: weight
// quantization is a property of the artifact, so it is honoured by `modelRef`
// pointing at the Q4_K_M quant from the frozen catalogue mirror (M.1,
// `RobinsAIWorld/natally-models`) — asserted contractually by
// `TurboQuantParams["weights"]`.
//
// Lazy load law: the model loads on the first `complete` (never at injection
// time) from the M.1 storage `modelRef` (path/URL), and stays cached in the
// handle afterwards; repeated completions reuse it.

import {
  type EngineFactory,
  type EngineParams,
  type InferenceContext,
  kvCacheType,
  type StreamingEngine,
} from "./lane";

/** Fixed companion context window until C.2 owns the fence budget law (§7.2). */
const CONTEXT_TOKENS = 4096;

/** Shared default completion budget (mirrors the native leg's
 * `DEFAULT_MAX_TOKENS` in `src-tauri/src/inference/llama.rs`). */
const DEFAULT_MAX_TOKENS = 256;

/**
 * Pass-through loader config: wllama forwards these keys verbatim into the
 * llama.cpp context params (documented mapping — see the file header; typed
 * loosely as string/number/boolean because wllama is injected structurally
 * here, not imported).
 */
export interface WllamaLoadConfig {
  [key: string]: string | number | boolean;
}

/** Minimal chat message shape wllama's `createChatCompletion` accepts. */
export interface WllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Fourth argument of wllama's per-token callback (structural subset). */
export interface WllamaTokenOptionals {
  abortSignal?: () => boolean;
}

/**
 * Structural subset of the wllama handle this module uses. The injected
 * production handle (a real `@wllama/wllama` `Wllama` instance once the
 * dependency lands) must satisfy this interface exactly; no other surface is
 * touched. onnxruntime-web/in-browser execution only — the OS speech-synthesis
 * API is never involved (D7a; see the V-phase ban guard) and nothing here
 * reaches the network for inference
 * (§7.3: the only egress is the local pipeline).
 */
export interface WllamaHandle {
  /** Fetches and loads a GGUF artifact from a path/URL with the given
   * pass-through loader config. */
  loadModelUrl(url: string, config?: WllamaLoadConfig): Promise<unknown>;
  /** Streams a chat completion; `onNewToken` receives the cumulative text so
   * far (the engine derives ordered deltas from it). Resolves with the full
   * text (or null). */
  createChatCompletion(
    messages: WllamaChatMessage[],
    options: {
      nPredict: number;
      onNewToken: (
        token: number,
        piece: Uint8Array,
        currentText: string,
        optionals: WllamaTokenOptionals,
      ) => void;
    },
  ): Promise<string | null>;
  /** True once a model is resident in the handle. */
  isModelLoaded(): boolean;
  /** Frees the handle's resident model (process teardown — owned by the
   * caller, never called by the engine wrapper's `dispose`). */
  exit(): Promise<void>;
}

/** Builds the pass-through loader config for one engine (single §7.1 KV
 * mapping, derived through `kvCacheType` so both lanes agree). */
function loaderConfig(params: EngineParams): WllamaLoadConfig {
  const kv = kvCacheType(params.quant);
  return {
    n_ctx: CONTEXT_TOKENS,
    cache_type_k: kv,
    cache_type_v: kv,
  };
}

/** Collapses the fence context into wllama chat messages (system prompt first). */
function toWllamaMessages(ctx: InferenceContext): WllamaChatMessage[] {
  return [
    { role: "system", content: ctx.systemPrompt },
    ...ctx.messages.map((message) => ({
      role: message.role === "user" ? ("user" as const) : ("assistant" as const),
      content: message.content,
    })),
  ];
}

/** One web-lane engine: lazily loads the model from `modelRef`, then streams
 * ordered token deltas out of wllama's cumulative-text callback. */
class WllamaStreamingEngine implements StreamingEngine {
  private loadedModelRef: string | undefined;

  constructor(
    private readonly handle: WllamaHandle,
    private readonly params: EngineParams,
  ) {}

  async complete(ctx: InferenceContext, onToken: (text: string) => void): Promise<void> {
    await this.ensureLoaded();
    let emitted = 0;
    await this.handle.createChatCompletion(toWllamaMessages(ctx), {
      nPredict: ctx.maxTokens ?? DEFAULT_MAX_TOKENS,
      onNewToken: (_token, _piece, currentText) => {
        if (currentText.length > emitted) {
          onToken(currentText.slice(emitted));
          emitted = currentText.length;
        }
      },
    });
  }

  /**
   * The engine wrapper owns no exclusive resource — the model cache lives in
   * the injected handle (which survives across completions, lazy-load law), so
   * disposal is a no-op here by design. Handle teardown (`exit`) belongs to
   * the caller (I.3 wiring).
   */
  dispose(): void {}

  private async ensureLoaded(): Promise<void> {
    if (this.loadedModelRef === this.params.modelRef) {
      return;
    }
    if (this.handle.isModelLoaded()) {
      // The handle came pre-resident with some other artifact — free it so the
      // catalogue artifact named by `modelRef` is authoritative (one model per
      // handle).
      await this.handle.exit();
    }
    await this.handle.loadModelUrl(this.params.modelRef, loaderConfig(this.params));
    this.loadedModelRef = this.params.modelRef;
  }
}

/** Binds a wllama handle into a web-lane `EngineFactory`. The factory is lazy:
 * it builds an engine per `complete` call, and the engine loads the model only
 * on its first completion. */
export function createWebEngineFactory(handle: WllamaHandle): EngineFactory {
  return (params: EngineParams) => new WllamaStreamingEngine(handle, params);
}
