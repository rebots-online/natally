import type { Wllama } from "@wllama/wllama/esm/index.js";
import type { EngineFactoryInput, InferenceEngine, InferenceParams } from "./lane.js";

export interface WebInferenceAssets {
  /** Self-hosted copy of @wllama/wllama@3.6.1/esm/wasm/wllama.wasm. */
  readonly wasm: string;
  /** Optional self-hosted wllama-compat assets for browsers without JSPI. */
  readonly compat?: { readonly worker: string; readonly wasm: string };
}

export type WllamaEngine = Pick<
  Wllama,
  "setCompat" | "loadModel" | "getModelMetadata" | "createChatCompletion" | "exit"
>;
export type WllamaFactory = (assets: WebInferenceAssets) => Promise<WllamaEngine>;

function localAsset(path: string): string {
  const url = new URL(path, globalThis.location.href);
  if (url.origin !== globalThis.location.origin || !["http:", "https:"].includes(url.protocol))
    throw new TypeError("wllama assets must be self-hosted on this origin");
  return url.href;
}

async function realWllama(assets: WebInferenceAssets): Promise<WllamaEngine> {
  const { Wllama } = await import("@wllama/wllama/esm/index.js");
  const engine = new Wllama({ default: localAsset(assets.wasm) }, { allowOffline: true });
  // Wllama defaults to a CDN compatibility worker. Never leave that default active.
  engine.setCompat(
    assets.compat
      ? {
          worker: localAsset(assets.compat.worker),
          wasm: localAsset(assets.compat.wasm),
        }
      : null,
  );
  return engine;
}

export function webTurboquantParams(params: InferenceParams) {
  return {
    n_ctx: params.contextSize,
    n_threads: params.threads,
    n_batch: Math.min(512, params.contextSize),
    n_ubatch: Math.min(512, params.contextSize),
    cache_type_k: params.cacheTypeK,
    cache_type_v: params.cacheTypeV,
    flash_attn: true,
    // WebGPU SET_ROWS does not support the required quantized KV on all devices.
    // The WASM CPU lane keeps q8_0 atomic instead of quietly changing precision.
    n_gpu_layers: 0,
    offload_kqv: false,
    no_kv_offload: true,
    ctx_shift: false,
    n_parallel: 1,
    reasoning: false,
  } as const;
}

/** Loads only M.1's verified local blobs; no URL/model downloader is used. */
export async function createWebInferenceEngine(
  input: EngineFactoryInput,
  assets: WebInferenceAssets,
  factory: WllamaFactory = realWllama,
): Promise<InferenceEngine> {
  if (
    input.model.lane !== "web" ||
    !input.model.files.length ||
    input.model.files.some((file) => file.size === 0)
  )
    throw new TypeError("Web inference requires installed, nonempty M.1 GGUF blobs");
  const engine = await factory(assets);
  try {
    await engine.loadModel([...input.model.files], webTurboquantParams(input.params));
    // GGUF general.file_type=15 is MOSTLY_Q4_K_M. A filename is not proof of quantization.
    if (engine.getModelMetadata().meta["general.file_type"] !== "15")
      throw new Error("Installed GGUF is not Q4_K_M (general.file_type must be 15)");
    input.onReady();
  } catch (error) {
    try {
      await engine.exit();
    } catch {
      /* Preserve the loading failure. */
    }
    throw error;
  }
  return {
    async complete(ctx, onToken) {
      ctx.signal?.throwIfAborted();
      const abort = new AbortController();
      const forwardAbort = () => abort.abort(ctx.signal?.reason);
      ctx.signal?.addEventListener("abort", forwardAbort, { once: true });
      try {
        let finished = false;
        const stream = await engine.createChatCompletion({
          messages: ctx.messages.map(({ role, content }) => ({ role, content })),
          max_tokens: ctx.maxTokens ?? Math.min(512, input.params.contextSize - 1),
          stream: true,
          abortSignal: abort.signal,
          cache_prompt: false,
          temperature: 0.7,
          top_k: 40,
          top_p: 0.9,
        });
        for await (const chunk of stream) {
          ctx.signal?.throwIfAborted();
          const token = chunk.choices[0]?.delta.content;
          if (token) onToken(token);
          if (chunk.choices[0]?.finish_reason === "length")
            throw new Error(
              "Inference reached its token limit before completing the fenced candidate",
            );
          const reason = chunk.choices[0]?.finish_reason;
          if (reason) {
            if (reason !== "stop")
              throw new Error(`Unsupported inference finish reason: ${reason}`);
            finished = true;
          }
        }
        ctx.signal?.throwIfAborted();
        if (!finished) throw new Error("Inference stream ended without a completion boundary");
      } finally {
        abort.abort();
        ctx.signal?.removeEventListener("abort", forwardAbort);
      }
    },
    dispose: () => engine.exit(),
  };
}
