import type { GateResult } from "../../../packages/billing/src/trial.js";
import { evaluateGate } from "../../../packages/billing/src/trial.js";
import { buildFacts } from "../../../packages/ephemeris/src/facts.js";
import { EphemerisWorkerHost } from "../../../packages/ephemeris/src/host/web-worker.js";
import type { ChartFacts } from "../../../packages/ephemeris/src/types.js";
import type { Turn } from "../../../packages/lore/src/types.js";
import { createCompanionBus } from "./companion/bus.js";
import { buildFencePrompt, checkFence, createTier1 } from "./companion/fence.js";
import { createWebInferenceEngine } from "./companion/inference-web.js";
import type { InferenceEngine, InferenceStorage, StoredInferenceModel } from "./companion/lane.js";
import { turboquantParams } from "./companion/lane.js";
import { FENCE_ABSENCE } from "./companion/persona.js";
import { loadRuntimeConfig } from "./config.js";
import type { GazetteerEntry } from "./content/index.js";
import { loadGazetteer } from "./content/index.js";
import {
  ChartsRepository,
  openWebDatabase,
  PeopleRepository,
  SessionsRepository,
  TurnsRepository,
} from "./data/index.js";
import { WebMirrorStorage, WebSpaceAdapter } from "./mirror/cache.js";
import { MirrorDownloader } from "./mirror/download.js";
import type { ManifestAsset, ModelManifest } from "./mirror/manifest.js";
import { fetchManifest, MirrorNetwork } from "./mirror/manifest.js";
import type { ConversationPlate, ConversationServices } from "./screens/conversation/types.js";
import type { WebVoice } from "./voice/web.js";
import { createKokoroWebVoice } from "./voice/web.js";

/**
 * Production composition root for the web lane (M.1 + C.1 + C.2 + B.1 over the C.4
 * bus; U.4 persistence + first chart via X.1 and P.4).
 */

const SESSION_STORAGE_KEY = "natally.session";
/** Self-hosted wllama runtime asset (fragility ethos: same-origin, no CDN). */
const WLLAMA_WASM_PATH = "/vendor/wllama/wllama.wasm";
/** Self-hosted detached sweph-wasm semiset (engine assetRoot; T0.V provenance). */
const SWEPH_ASSET_ROOT = "/vendor/sweph/";

const SIGNS = Object.freeze([
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
] as const);

function signOf(longitude: number): string {
  return SIGNS[Math.floor((((longitude % 360) + 360) % 360) / 30)] ?? "Aries";
}

/** Degrees within the sign (astrological convention): 41°50′ absolute → 11°50′ Taurus. */
function degreesOf(longitude: number): string {
  const withinSign = (((longitude % 360) + 360) % 360) % 30;
  const degree = Math.floor(withinSign);
  const minute = Math.floor((withinSign - degree) * 60);
  return `${String(degree).padStart(2, "0")}°${String(minute).padStart(2, "0")}′`;
}

/** Timezone offset (minutes east of UTC) for a wall-clock instant in `tzid`. */
function tzOffsetMinutes(tzid: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzid,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Julian Day from a local wall-clock birth moment in a timezone. */
function julianDay(date: string, time: string, tzid: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guessUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const offset = tzOffsetMinutes(tzid, guessUtc);
  const utcMs = guessUtc - offset * 60000;
  return utcMs / 86400000 + 2440587.5;
}

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

function createStore<Shape>(initial: Shape) {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<Shape>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    get: (): Shape => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
  };
}

export interface IntakeState {
  readonly needed: boolean;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface IntakeDraft {
  readonly name: string;
  readonly date: string;
  readonly time: string | null;
  readonly unknownTime: boolean;
  readonly placeId: string | null;
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
  readonly models: ReturnType<typeof createStore<ModelState>>;
  readonly intake: ReturnType<typeof createStore<IntakeState>>;
  readonly gazetteer: readonly GazetteerEntry[];
  createPerson(draft: IntakeDraft): Promise<void>;
  downloadModel(modelId: string): Promise<void>;
  replayLastReply(): void;
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

    // ---- Persistence (X.1): SQLite when OPFS is available, memory otherwise. ----
    let people: PeopleRepository | null = null;
    let sessions: SessionsRepository | null = null;
    let turns: TurnsRepository | null = null;
    let chartsRepo: ChartsRepository | null = null;
    try {
      const db = await openWebDatabase();
      people = new PeopleRepository(db);
      sessions = new SessionsRepository(db);
      turns = new TurnsRepository(db);
      chartsRepo = new ChartsRepository(db);
    } catch {
      // OPFS unavailable (or storage denied): the conversation stays in memory and
      // the intake reruns next visit. Absence is honest, never fabricated.
    }

    const gazetteer = loadGazetteer();
    const models = createStore<ModelState>({ phase: "boot", row: null, percent: 0, error: null });
    const intake = createStore<IntakeState>({ needed: true, busy: false, error: null });

    // The model is absent until an engine actually loads: signal Asleep immediately,
    // before any catalogue work, so the wake plate renders without waiting on network.
    bus.signal({ type: "model-presence", present: false });

    // ---- Person + first chart (U.4 / J1 / P.4) ----
    let chart: ChartFacts | null = null;
    let platesCache: readonly ConversationPlate[] = [];

    const existingPeople = people ? await people.list() : [];
    if (existingPeople.length > 0) {
      intake.set({ needed: false });
    }

    let ephemeris: EphemerisWorkerHost | null = null;
    const factsCache = new Map<string, ChartFacts>();
    const ensureEphemeris = async (): Promise<EphemerisWorkerHost> => {
      ephemeris ??= new EphemerisWorkerHost();
      await ephemeris.init({ assetRoot: new URL(SWEPH_ASSET_ROOT, window.location.origin).href });
      return ephemeris;
    };

    const plateOf = (facts: ChartFacts, name: string, provenance: string): ConversationPlate => {
      const content: ConversationPlate["content"][number][] = [
        ...facts.positions
          .filter((position) => position.body !== "chiron")
          .slice(0, 4)
          .map((position) => ({
            kind: "computed" as const,
            text: `${position.body.replace(/-/g, " ")} ${degreesOf(position.lon)} ${signOf(position.lon)}`,
          })),
      ];
      content.push({
        kind: "authored-static",
        label: "What it is",
        text: "Positions are computed by the Swiss Ephemeris on this device.",
      });
      if (!facts.cusps) {
        content.push({ kind: "absence", text: "Birth time unknown — no houses, no Ascendant." });
      }
      return {
        id: facts.id,
        sessionId,
        ts: Date.now(),
        title: `Natal · ${name}`,
        provenance,
        content,
      };
    };

    let lastReplyText: string | null = null;
    const speakReply = (text: string): void => {
      // Voice failure must never take the written reply down with it (honest absence).
      void ensureVoice()
        .then((voice) => voice?.speak(text))
        .catch(() => undefined);
    };

    const createPerson = async (draft: IntakeDraft): Promise<void> => {
      if (people === null) throw new Error("Persistent storage is unavailable for the intake");
      const place = gazetteer.find((entry) => entry.id === draft.placeId);
      if (!place) throw new Error("Choose a birth place from the list");
      intake.set({ busy: true, error: null });
      try {
        const wallTime = draft.time ?? "12:00";
        const jd = julianDay(draft.date, wallTime, place.tzid);
        const host = await ensureEphemeris();
        const facts = await buildFacts(
          {
            ut: [jd],
            place: { lat: place.lat, lon: place.lon },
            system: draft.unknownTime ? "W" : "P",
            timeKnown: !draft.unknownTime,
          },
          {
            engine: host,
            cache: {
              get: (key) => factsCache.get(key),
              put: (key, value) => void factsCache.set(key, value),
            },
          },
        );
        const person = {
          id: `p-${crypto.randomUUID()}`,
          name: draft.name,
          birth: {
            date: draft.date,
            ...(draft.time && !draft.unknownTime ? { time: draft.time } : {}),
            place: `${place.name}, ${place.countryCode}`,
            timeKnown: !draft.unknownTime,
          },
        };
        await people.upsert(person);
        if (sessions) {
          await sessions.upsert({ id: sessionId, personId: person.id, startedAt: Date.now() });
        }
        if (chartsRepo) {
          await chartsRepo.upsert(facts, [person.id]);
        }
        chart = facts;
        const provenance = `${draft.unknownTime ? "Whole Sign" : "Placidus"} · ${draft.date}${draft.time && !draft.unknownTime ? ` ${draft.time}` : ""} · ${place.name}`;
        platesCache = [plateOf(facts, person.name, provenance)];
        const sun = facts.positions.find((position) => position.body === "sun");
        const greeting =
          `Your sky is drawn, ${person.name}.` +
          (sun ? ` The Sun stands in ${signOf(sun.lon)} at ${degreesOf(sun.lon)}.` : "") +
          (facts.cusps
            ? " Houses and angles are live — ask me anything about them."
            : " Without a birth time I read the sky without houses, honestly.");
        const greetingTurn = newTurn(sessionId, "her", greeting);
        if (turns) await turns.upsert(greetingTurn);
        else memoryTurns.push(greetingTurn);
        bus.emit({ type: "chart-computed", chartId: facts.id });
        bus.emit({ type: "turn", turn: greetingTurn });
        lastReplyText = greeting;
        speakReply(greeting);
        intake.set({ needed: false, busy: false });
      } catch (error) {
        intake.set({ busy: false, error: (error as Error).message });
      }
    };

    // ---- Model catalogue + inference (M.1 + C.1) ----
    const network = new MirrorNetwork(config);
    const storage = new WebMirrorStorage({
      cacheStorage: window.caches,
      locks: navigator.locks,
      origin: window.location.origin,
    });
    const downloader = new MirrorDownloader(network, storage, new WebSpaceAdapter());

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
      async resolveChatModel(lane, _weights): Promise<StoredInferenceModel | null> {
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

    // ---- Voice (V.2): provision the Kokoro trio and read replies aloud. ----
    const voiceModelAsset = manifest?.assets.find((asset) => asset.id === "kokoro-v1-q8") ?? null;
    const voiceTokenizerAsset =
      manifest?.assets.find((asset) => asset.id === "kokoro-tokenizer") ?? null;
    const voiceVoicesAsset =
      manifest?.assets.find((asset) => asset.id === "kokoro-voices-af_heart") ?? null;

    const provisionVoiceAssets = async (): Promise<boolean> => {
      if (!voiceModelAsset || !voiceTokenizerAsset || !voiceVoicesAsset) return false;
      for (const asset of [voiceModelAsset, voiceTokenizerAsset, voiceVoicesAsset]) {
        if (!(await storage.isPresent(asset))) {
          await downloader.download(asset, {});
        }
      }
      return true;
    };

    /** Serves mirror assets to the voice module from verified M.1 cache storage. */
    const readAsset = async (url: string): Promise<Response> => {
      const name = url.split("/").pop() ?? "";
      const asset = manifest?.assets.find((entry) => entry.file === name);
      if (!asset) throw new Error(`Unknown mirror asset: ${name}`);
      const stream = await storage.read(asset);
      if (!stream) throw new Error(`Asset not present in M.1 storage: ${name}`);
      return new Response(stream);
    };

    let voicePromise: Promise<WebVoice | null> | undefined;
    const ensureVoice = async (): Promise<WebVoice | null> => {
      voicePromise ??= (async () => {
        if (!(await provisionVoiceAssets())) return null;
        return createKokoroWebVoice({
          modelUrl: "/voice/kokoro-v1-q8.onnx",
          tokenizerUrl: "/voice/tokenizer.json",
          voiceUrl: "/voice/af_heart.bin",
          wasmPaths: "/vendor/ort/",
          language: "en-us",
          bus,
          readAsset,
        });
      })();
      return voicePromise;
    };

    const replayLastReply = (): void => {
      if (lastReplyText) speakReply(lastReplyText);
    };

    // ---- Conversation services (the screen's whole world) ----
    const services: ConversationServices = {
      bus,
      turns: {
        async list(targetSessionId: string) {
          if (turns) return turns.list(targetSessionId);
          return memoryTurns.filter((turn) => turn.sessionId === targetSessionId);
        },
      },
      access,
      plates: {
        async list(targetSessionId: string) {
          return platesCache.filter((plate) => plate.sessionId === targetSessionId);
        },
        async get(chartId: string) {
          return platesCache.find((plate) => plate.id === chartId) ?? null;
        },
      },
      async submit(text, context) {
        if (context.signal.aborted) return;
        const userTurn = newTurn(context.sessionId, "you", text);
        if (turns) await turns.upsert(userTurn);
        else memoryTurns.push(userTurn);
        bus.emit({ type: "turn", turn: userTurn });

        const replyText = await (async () => {
          if (!engine) {
            return (
              "I'm listening, but I have no voice yet — my readings begin once my model " +
              "arrives. Charts still work while I sleep."
            );
          }
          const tier1 = createTier1(chart ? [chart] : [], []);
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
        if (turns) await turns.upsert(reply);
        else memoryTurns.push(reply);
        bus.emit({ type: "turn", turn: reply });
        lastReplyText = replyText;
        speakReply(replyText);
      },
    };
    // Reload path: restore the latest chart + plate from SQLite so the sky persists.
    if (!chart && existingPeople.length > 0 && chartsRepo) {
      const person = existingPeople[0];
      if (person) {
        const records = await chartsRepo.list();
        const record = records.find((row) => row.inputs.personIds.includes(person.id));
        const restored = record?.facts ?? null;
        if (restored) {
          chart = restored;
          const place = person.birth.place.split(",")[0] ?? person.birth.place;
          const provenance = `${person.birth.timeKnown ? "Placidus" : "Whole Sign"} · ${person.birth.date}${person.birth.time ? ` ${person.birth.time}` : ""} · ${place}`;
          platesCache = [plateOf(restored, person.name, provenance)];
        }
      }
    }

    return {
      sessionId,
      services,
      models,
      intake,
      gazetteer,
      createPerson,
      downloadModel: async (modelId: string) => {
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
      },
      replayLastReply,
    };
  })();
  return composition;
}
