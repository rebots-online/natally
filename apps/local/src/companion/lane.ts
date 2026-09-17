import type { CompanionBus, CompanionEvent } from "./bus.js";
import type { FenceMessage } from "./fence.js";
import type { WebInferenceAssets } from "./inference-web.js";

export type InferenceLane = "native" | "web";
export type OnToken = (token: string) => void;

/** C.2 supplies buildFencePrompt's messages, including its regeneration prompt. */
export interface FenceContext {
  readonly messages: readonly FenceMessage[];
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

export const TURBOQUANT = Object.freeze({
  weights: "Q4_K_M",
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  recursor: "unsupported",
} as const);

export const INFERENCE_CAPABILITIES = Object.freeze({
  q4r8: Object.freeze({
    supported: false,
    reason: "Neither pinned engine implements the q4r8 recursor; device RAM does not enable it.",
  }),
} as const);

export interface InferenceParams {
  readonly weights: "Q4_K_M";
  readonly cacheTypeK: "q8_0";
  readonly cacheTypeV: "q8_0";
  readonly recursor: "unsupported";
  readonly contextSize: number;
  readonly threads: number;
}

interface StoredModelIdentity {
  /** M.1 immutable content identity; changes when the verified GGUF changes. */
  readonly id: string;
  readonly quantization: "Q4_K_M";
}
export type StoredInferenceModel = StoredModelIdentity &
  (
    | { readonly lane: "native"; readonly path: string }
    | { readonly lane: "web"; readonly files: readonly Blob[] }
  );

/** Parent adapts M.1 storage. This resolver must never download or choose another quant. */
export interface InferenceStorage {
  resolveChatModel(lane: InferenceLane, weights: "Q4_K_M"): Promise<StoredInferenceModel | null>;
}

export interface InferenceEngine {
  complete(ctx: FenceContext, onToken: OnToken): Promise<void>;
  dispose(): Promise<void>;
}

export interface EngineFactoryInput {
  readonly lane: InferenceLane;
  readonly model: StoredInferenceModel;
  readonly params: InferenceParams;
  readonly onReady: () => void;
}
export type InferenceEngineFactory = (input: EngineFactoryInput) => Promise<InferenceEngine>;

export function turboquantParams(contextSize = 4096, threads = 1): InferenceParams {
  if (!Number.isInteger(contextSize) || contextSize < 32 || contextSize > 131072)
    throw new RangeError("Inference context size must be an integer in [32, 131072]");
  if (!Number.isInteger(threads) || threads < 1 || threads > 256)
    throw new RangeError("Inference threads must be an integer in [1, 256]");
  return Object.freeze({ ...TURBOQUANT, contextSize, threads });
}

export interface InferenceHostOptions {
  /** I.3 is the sole platform/capability selector. C.1 consumes its decision. */
  readonly lane: InferenceLane;
  readonly storage: InferenceStorage;
  /** Use a private candidate bus until C.2 approves the completed text. */
  readonly bus: Pick<CompanionBus, "emit" | "signal">;
  readonly webAssets?: WebInferenceAssets;
  readonly contextSize?: number;
  readonly threads?: number;
  /** Parent mounts natally_plugin!("inference", ...); override for a different mount. */
  readonly nativeCommandPrefix?: string;
  readonly engineFactory?: InferenceEngineFactory;
}

export interface InferenceHost extends Omit<InferenceEngine, "complete"> {
  readonly lane: InferenceLane;
  readonly capabilities: typeof INFERENCE_CAPABILITIES;
  complete(ctx: FenceContext, onToken: OnToken): Promise<string>;
}

/** Serial turns, lazy storage/engine access, no silent native-to-web fallback. */
export function createInferenceHost(options: InferenceHostOptions): InferenceHost {
  const lane = options.lane;
  if (lane !== "native" && lane !== "web") throw new TypeError("I.3 must select an inference lane");
  const params = turboquantParams(options.contextSize, options.threads);
  let current: { id: string; engine: InferenceEngine } | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let disposal: Promise<void> | undefined;

  const factory: InferenceEngineFactory =
    options.engineFactory ??
    (async (input) => {
      if (input.lane === "native")
        return createNativeEngine(input, undefined, options.nativeCommandPrefix);
      if (!options.webAssets) throw new Error("Self-hosted wllama assets are required");
      const { createWebInferenceEngine } = await import("./inference-web.js");
      return createWebInferenceEngine(input, options.webAssets);
    });

  async function unload(): Promise<void> {
    const old = current;
    current = undefined;
    await old?.engine.dispose();
  }

  return {
    lane,
    capabilities: INFERENCE_CAPABILITIES,
    complete(ctx, onToken) {
      if (disposed) return Promise.reject(new Error("Inference host is disposed"));
      // Snapshot before queuing: another turn cannot mutate a pending fence prompt.
      const request: FenceContext & { maxTokens: number } = {
        ...ctx,
        messages: ctx.messages.map(({ role, content }) => ({ role, content })),
        maxTokens: ctx.maxTokens ?? Math.min(512, params.contextSize - 1),
      };
      const run = tail.then(async () => {
        request.signal?.throwIfAborted();
        if (
          !request.messages.length ||
          request.messages.some(
            ({ role, content }) =>
              !["system", "user", "assistant"].includes(role) || !content || content.includes("\0"),
          )
        )
          throw new TypeError("Inference requires nonempty fenced messages without NUL bytes");
        if (
          !Number.isInteger(request.maxTokens) ||
          request.maxTokens < 1 ||
          request.maxTokens >= params.contextSize
        )
          throw new RangeError("maxTokens must be positive and smaller than the context");
        try {
          const model = await options.storage.resolveChatModel(lane, params.weights);
          request.signal?.throwIfAborted();
          if (!model) {
            await unload();
            options.bus.signal({ type: "model-presence", present: false });
            throw new Error("The M.1 Q4_K_M chat model is not installed");
          }
          if (!model.id || model.lane !== lane || model.quantization !== params.weights)
            throw new Error("M.1 model identity, lane or quantization does not match turboquant");
          if (!current || current.id !== model.id) {
            await unload();
            options.bus.signal({ type: "engine-load", fraction: 0 });
            const engine = await factory({
              lane,
              model,
              params,
              onReady: () => options.bus.signal({ type: "engine-load", fraction: 1 }),
            });
            current = { id: model.id, engine };
          }
          request.signal?.throwIfAborted();
          let text = "";
          await current.engine.complete(request, (token) => {
            request.signal?.throwIfAborted();
            if (!token) return;
            text += token;
            options.bus.emit({ type: "token", token });
            onToken(token);
          });
          request.signal?.throwIfAborted();
          return text;
        } catch (error) {
          // A failed context/worker must not poison subsequent turns.
          try {
            await unload();
          } catch {
            /* Preserve the inference failure. */
          }
          if (!request.signal?.aborted)
            options.bus.emit({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          throw error;
        }
      });
      tail = run.catch(() => {});
      return run;
    },
    dispose() {
      disposed = true;
      disposal ??= tail.then(unload);
      return disposal;
    },
  };
}

export interface NativeInferenceRequest {
  readonly requestId: string;
  readonly modelId: string;
  readonly modelPath: string;
  readonly params: InferenceParams;
  readonly messages: readonly FenceMessage[];
  readonly maxTokens: number;
}
export type NativeInferenceEvent =
  | Extract<CompanionEvent, { type: "token" | "error" }>
  | { type: "started" | "ready" | "done" };

/** Transport injection tests the real IPC adapter without loading a native model. */
export interface NativeInferenceBridge {
  stream(
    request: NativeInferenceRequest,
    onEvent: (event: NativeInferenceEvent) => void,
  ): Promise<void>;
  cancel(requestId: string): Promise<void>;
  unload(): Promise<void>;
}

async function tauriBridge(commandPrefix: string): Promise<NativeInferenceBridge> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  return {
    async stream(request, onEvent) {
      // IPC command resolution can precede the channel's last message. Wait for done.
      await new Promise<void>((resolve, reject) => {
        const onEventChannel = new Channel<NativeInferenceEvent>();
        onEventChannel.onmessage = (event) => {
          try {
            onEvent(event);
            if (event.type === "done") resolve();
            if (event.type === "error") reject(new Error(event.message));
          } catch (error) {
            reject(error);
          }
        };
        void invoke<void>(`${commandPrefix}inference_complete`, {
          request,
          onEvent: onEventChannel,
        }).catch(reject);
      });
    },
    cancel: (requestId) => invoke(`${commandPrefix}inference_cancel`, { requestId }),
    unload: () => invoke(`${commandPrefix}inference_unload`),
  };
}

export async function createNativeEngine(
  input: EngineFactoryInput,
  bridge?: NativeInferenceBridge,
  commandPrefix = "plugin:inference|",
): Promise<InferenceEngine> {
  if (input.model.lane !== "native")
    throw new TypeError("Native inference requires a native model");
  const model = input.model;
  const transport = bridge ?? (await tauriBridge(commandPrefix));
  return {
    async complete(ctx, onToken) {
      ctx.signal?.throwIfAborted();
      const requestId = globalThis.crypto.randomUUID();
      let callbackFailure: unknown;
      let callbackFailed = false;
      const cancel = () => {
        void transport.cancel(requestId).catch(() => {});
      };
      ctx.signal?.addEventListener("abort", cancel, { once: true });
      try {
        await transport.stream(
          {
            requestId,
            modelId: model.id,
            modelPath: model.path,
            params: input.params,
            messages: ctx.messages,
            maxTokens: ctx.maxTokens ?? Math.min(512, input.params.contextSize - 1),
          },
          (event) => {
            // started closes the race where abort preceded native request registration.
            if (ctx.signal?.aborted) {
              cancel();
              return;
            }
            if (callbackFailed) return;
            try {
              if (event.type === "ready") input.onReady();
              if (event.type === "token") onToken(event.token);
              if (event.type === "error") throw new Error(event.message);
            } catch (error) {
              callbackFailed = true;
              callbackFailure = error;
              cancel();
            }
          },
        );
        ctx.signal?.throwIfAborted();
        if (callbackFailed) throw callbackFailure;
      } catch (error) {
        ctx.signal?.throwIfAborted();
        if (callbackFailed) throw callbackFailure;
        throw error;
      } finally {
        ctx.signal?.removeEventListener("abort", cancel);
      }
    },
    dispose: () => transport.unload(),
  };
}
