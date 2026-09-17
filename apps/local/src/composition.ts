import type { GateResult } from "../../../packages/billing/src/trial.js";
import { evaluateGate } from "../../../packages/billing/src/trial.js";
import type { Turn } from "../../../packages/lore/src/types.js";
import { createCompanionBus } from "./companion/bus.js";
import { buildFencePrompt, checkFence, createTier1 } from "./companion/fence.js";
import { createWebInferenceEngine } from "./companion/inference-web.js";
import type { InferenceEngine, InferenceStorage, StoredInferenceModel } from "./companion/lane.js";
import { turboquantParams } from "./companion/lane.js";
import { FENCE_ABSENCE } from "./companion/persona.js";
import { loadRuntimeConfig } from "./config.js";
import { WebMirrorStorage, WebSpaceAdapter } from "./mirror/cache.js";
import { MirrorDownloader } from "./mirror/download.js";
import type { ManifestAsset, ModelManifest } from "./mirror/manifest.js";
import { fetchManifest, MirrorNetwork } from "./mirror/manifest.js";
import type { ConversationServices } from "./screens/conversation/types.js";

/**
 * Production composition root for the web lane (M.1 + C.1 + C.2 + B.1 over the C.4 bus).
 *
 * Persistence note (pre-first-light): sessions require a real Person (J1), and no
 * birth data exists until the first-light intake lands (U.4). Rather than fabricate
 * a person or birth data, the conversation runs on in-memory turns for now; the
 * X.1 repositories attach when the intake screen creates the first person.
 */

const SESSION_STORAGE_KEY = "natally.session";
/** Self-hosted wllama runtime asset (fragility ethos: same-origin, no CDN). */
const WLLAMA_WASM_PATH = "/vendor/wllama/wllama.wasm";

function readStoredSessionId(): string {
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (stored) return stored;
  const id = `s-${crypto.randomUUID()}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

function newTurn(sessionId: string, role: Turn["role"], text: string): Turn {
  return { id: `t-${crypto.randomUUID()}`, sessionId, role, text, ts: Date.now() };
}

export type ModelPhase = "boot" | "absent" | "downloading" | "loading" | "ready" | "error";

export interface ModelState {
  readonly phase: ModelPhase;
  readonly row: { id: string; label: string; quant?: string; bytes?: number } | null;
  readonly percent: number;
  readonly error: string | null;
}

function createModelStore() {
  let state: ModelState = { phase: "boot", row: null, percent: 0, error: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ModelState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    get: (): ModelState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
  };
}

function createAccess() {
  const config = loadRuntimeConfig();
  const listeners = new Set<() => void>();
  let snapshot: GateResult | null = null;
  const recompute = () => {
    // No licensed token verification is wired yet (B.3 integration); the local trial
    // gate is evaluated over committed readings once B.2's ledger lands here.
    const next = evaluateGate(config.trial, [], () => Date.now(), false);
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  recompute();
  return {
    getSnapshot: (): GateResult | null => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recompute,
  };
}

export interface Composition {
  sessionId: string;
  services: ConversationServices;
  readonly models: ReturnType<typeof createModelStore>;
  downloadModel(modelId: string): Promise<void>;
}

let composition: Promise<Composition> | undefined;

export function createConversationComposition(): Promise<Composition> {
  composition ??= (async () => {
    const config = loadRuntimeConfig();
    const bus = createCompanionBus();
    const access = createAccess();
    const sessionId = readStoredSessionId();
    const memoryTurns: Turn[] = [];
    let engine: InferenceEngine | null = null;

    const models = createModelStore();
    // The model is absent until an engine actually loads: signal Asleep immediately,
    // before any catalogue work, so the wake plate renders without waiting on network.
    bus.signal({ type: "model-presence", present: false });
    const network = new MirrorNetwork(config);
    const storage = new WebMirrorStorage({
      cacheStorage: window.caches,
      locks: navigator.locks,
      origin: window.location.origin,
    });
    const downloader = new MirrorDownloader(network, storage, new WebSpaceAdapter());

    // Boot the model catalogue from the mirror manifest; absence is honest, not fatal.
    let manifest: ModelManifest | null = null;
    let chatAsset: ManifestAsset | null = null;
    try {
      manifest = await fetchManifest(network);
      chatAsset =
        manifest.assets.find((asset) => asset.id === config.trial.trialModel) ??
        manifest.assets.find((asset) => asset.kind === "llm") ??
        null;
    } catch (error) {
      models.set({
        phase: "absent",
        error: `Model catalogue unavailable: ${(error as Error).message}`,
      });
    }

    const inferenceStorage: InferenceStorage = {
      async resolveChatModel(lane, weights): Promise<StoredInferenceModel | null> {
        if (lane !== "web" || !chatAsset || !(await storage.isPresent(chatAsset))) return null;
        const stream = await storage.read(chatAsset);
        if (!stream) return null;
        const blob = await new Response(stream).blob();
        return {
          lane: "web",
          id: chatAsset.id,
          quantization: "Q4_K_M",
          files: [blob],
        } satisfies StoredInferenceModel;
      },
    };

    const wakeEngine = async (): Promise<void> => {
      if (!chatAsset) return;
      models.set({ phase: "loading", percent: 0, error: null });
      bus.signal({ type: "engine-load", fraction: 0 });
      const model = await inferenceStorage.resolveChatModel("web", "Q4_K_M");
      if (!model) throw new Error("Downloaded model is not present in M.1 storage");
      engine = await createWebInferenceEngine(
        { lane: "web", model, params: turboquantParams(4096, 1), onReady: () => undefined },
        { wasm: WLLAMA_WASM_PATH },
      );
      bus.signal({ type: "engine-load", fraction: 1 });
      bus.signal({ type: "model-presence", present: true });
      models.set({ phase: "ready" });
    };

    if (chatAsset) {
      models.set({
        phase: "absent",
        row: {
          id: chatAsset.id,
          label: "Qwen3.5 2B",
          quant: chatAsset.quant,
          bytes: chatAsset.bytes,
        },
      });
      if (await storage.isPresent(chatAsset)) {
        // Already downloaded on a previous visit: wake immediately.
        try {
          await wakeEngine();
        } catch (error) {
          models.set({ phase: "error", error: (error as Error).message });
          bus.emit({ type: "error", message: (error as Error).message });
        }
      }
    }

    const downloadModel = async (modelId: string): Promise<void> => {
      if (!manifest) throw new Error("Model catalogue is unavailable");
      const asset = manifest.assets.find((entry) => entry.id === modelId);
      if (!asset) throw new Error(`Unknown model: ${modelId}`);
      models.set({ phase: "downloading", percent: 0, error: null });
      try {
        await downloader.download(asset, {
          onProgress: (progress) => {
            const fraction = Math.min(1, progress.percent / 100);
            bus.signal({ type: "engine-load", fraction });
            models.set({ percent: progress.percent });
          },
        });
        await wakeEngine();
      } catch (error) {
        models.set({ phase: "error", error: (error as Error).message });
        bus.emit({ type: "error", message: (error as Error).message });
        throw error;
      }
    };

    const services: ConversationServices = {
      bus,
      turns: {
        async list(targetSessionId: string) {
          return memoryTurns.filter((turn) => turn.sessionId === targetSessionId);
        },
      },
      access,
      async submit(text, context) {
        if (context.signal.aborted) return;
        const userTurn = newTurn(context.sessionId, "you", text);
        memoryTurns.push(userTurn);
        bus.emit({ type: "turn", turn: userTurn });

        const replyText = await (async () => {
          if (!engine) {
            return (
              "I'm listening, but I have no voice yet — my readings begin once my model " +
              "arrives. Charts still work while I sleep."
            );
          }
          const tier1 = createTier1([], []);
          const ask = async (regeneration: string | null): Promise<string> => {
            const messages = buildFencePrompt({
              tier1,
              memory: [],
              liveTurn: { id: userTurn.id, text },
              toolResults: [],
            });
            // The fence prompt builder owns persona and tiers; a regeneration appends
            // the quoted violation as C.2 specifies (one retry, then honest absence).
            const finalMessages = regeneration
              ? [
                  ...messages,
                  {
                    role: "user" as const,
                    content: `Your last reply violated the fence: ${regeneration}. Reply again strictly within it.`,
                  },
                ]
              : messages;
            let output = "";
            await engine!.complete(
              { messages: finalMessages, maxTokens: 512, signal: context.signal },
              (token) => {
                output += token;
                bus.emit({ type: "token", token });
              },
            );
            return output.trim();
          };
          const first = await ask(null);
          const verdict = checkFence(first, tier1);
          if (verdict.ok) return first;
          const quoted = verdict.violations
            .map((violation) => JSON.stringify(violation))
            .join("; ");
          const second = await ask(quoted);
          const secondVerdict = checkFence(second, tier1);
          return secondVerdict.ok ? second : FENCE_ABSENCE;
        })();

        if (context.signal.aborted) return;
        const reply = newTurn(context.sessionId, "her", replyText);
        memoryTurns.push(reply);
        bus.emit({ type: "turn", turn: reply });
      },
    };
    return { sessionId, services, models, downloadModel };
  })();
  return composition;
}
