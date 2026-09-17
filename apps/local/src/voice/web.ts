import type { InferenceSession, Tensor } from "onnxruntime-web";
import { type CompanionBus, companionBus } from "../companion/bus";
import { rmsEnvelope } from "./envelope";

export const KOKORO_SAMPLE_RATE = 24_000;
const STYLE_DIM = 256;
const MAX_PHONEMES = 510;

export interface KokoroWebOptions {
  /** Local, provisioned Kokoro v1.0 ONNX export, tokenizer.json and voice .bin. */
  modelUrl: string;
  tokenizerUrl: string;
  voiceUrl: string;
  /** Same-origin directory containing this ORT version's .wasm and .mjs files. */
  wasmPaths: string;
  /** Must match the chosen voice asset (a* = en-us, b* = en). */
  language: "en-us" | "en";
  bus?: Pick<CompanionBus, "emit">;
  /** M1 may return verified cached assets; receives absolute same-origin URLs. */
  readAsset?: (url: string) => Promise<Response>;
}

export interface WebVoice {
  readonly backend: "webgpu" | "wasm";
  /** Call from a user gesture. Resolves after playback; overlapping calls reject. */
  speak(text: string, options?: { speed?: number; signal?: AbortSignal }): Promise<void>;
  stop(): void;
  dispose(): Promise<void>;
}

type Vocabulary = Readonly<Record<string, number>>;
type Phonemize = (text: string, language: string) => Promise<string[]>;

// Kept here because V.2 owns web.ts, not a separate worklet entrypoint. No eval
// runs in the app: audioWorklet.addModule loads this as a local Blob ES module.
// Each reported frame is 20 ms of PCM actually written to the output, after
// resampling. The final partial window excludes unused render-quantum padding.
export const KOKORO_WORKLET_SOURCE = `
class KokoroPlayback extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.pcm = options.processorOptions.pcm;
    this.rendered = 0;
    this.step = options.processorOptions.sourceRate / sampleRate;
    this.outputLength = Math.ceil(this.pcm.length * sampleRate / options.processorOptions.sourceRate);
    this.window = new Float32Array(Math.max(1, Math.round(sampleRate * 0.020)));
    this.windowLength = 0;
    this.started = false;
    this.done = false;
  }
  flushWindow() {
    if (this.windowLength === 0) return;
    const frame = this.window.slice(0, this.windowLength);
    this.port.postMessage({ type: "frame", samples: frame }, [frame.buffer]);
    this.windowLength = 0;
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);
    if (this.done) return false;
    if (!this.started && this.outputLength > 0) {
      this.started = true;
      this.port.postMessage({ type: "start" });
    }
    for (let i = 0; i < output.length && this.rendered < this.outputLength; i++) {
      const position = this.rendered * this.step;
      const index = Math.floor(position);
      const fraction = position - index;
      const left = this.pcm[index];
      const right = this.pcm[Math.min(index + 1, this.pcm.length - 1)];
      output[i] = Math.max(-1, Math.min(1, left + (right - left) * fraction));
      this.rendered += 1;
      this.window[this.windowLength++] = output[i];
      if (this.windowLength === this.window.length) this.flushWindow();
    }
    if (this.rendered >= this.outputLength) {
      this.flushWindow();
      this.port.postMessage({ type: "done" });
      this.done = true;
      return false;
    }
    return true;
  }
}
registerProcessor("natally-kokoro", KokoroPlayback);
`;

function localUrl(value: string, directory = false): string {
  const url = new URL(value, globalThis.location.href);
  if (url.origin !== globalThis.location.origin || !["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("Kokoro assets must be served from this application's origin");
  }
  if (directory && (!url.pathname.endsWith("/") || url.search || url.hash)) {
    throw new TypeError("wasmPaths must be a directory URL ending in /");
  }
  return url.href;
}

async function fetchAsset(
  url: string,
  readAsset: (url: string) => Promise<Response>,
): Promise<Response> {
  const response = await readAsset(url);
  if (!response.ok) throw new Error(`Kokoro asset request failed (${response.status}): ${url}`);
  return response;
}

function vocabularyFrom(value: unknown): Vocabulary {
  const vocab = (value as { model?: { vocab?: unknown } } | null)?.model?.vocab;
  if (!vocab || typeof vocab !== "object" || Array.isArray(vocab)) {
    throw new TypeError("Expected Kokoro tokenizer.json model.vocab");
  }
  const entries = Object.entries(vocab);
  if (
    !entries.length ||
    entries.some(
      ([key, id]) => [...key].length !== 1 || !Number.isSafeInteger(id) || id < 0 || id > 177,
    )
  ) {
    throw new TypeError("Invalid Kokoro character vocabulary");
  }
  if ((vocab as Vocabulary).$ !== 0) throw new TypeError("Kokoro boundary token must be $ = 0");
  return Object.freeze(Object.fromEntries(entries)) as Vocabulary;
}

/** Real eSpeak-NG IPA, with punctuation retained and Kokoro's IPA substitutions. */
async function phonemesFor(
  text: string,
  language: KokoroWebOptions["language"],
  phonemize: Phonemize,
): Promise<string> {
  const normalized = text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  // Keep decimal numbers, grouped thousands and clock times intact for eSpeak.
  const pieces = normalized.split(/([;!?¡¿—…"«»“”(){}[\]]+|(?<!\d)[,:.]+|[,:.]+(?!\d))/u);
  const result: string[] = [];
  // eSpeak uses a shared voice; serialize calls instead of racing set_voice.
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (index % 2 === 1 || !piece.trim()) result.push(piece);
    else {
      const phones = (await phonemize(piece.trim(), language)).join(" ");
      if (!phones.trim()) throw new Error("Kokoro phonemization produced no phonemes");
      result.push(`${/^\s/.test(piece) ? " " : ""}${phones}${/\s$/.test(piece) ? " " : ""}`);
    }
  }
  let phones = result
    .join("")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l");
  if (language === "en-us") phones = phones.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return phones.trim();
}

function tokenChunks(phonemes: string, vocabulary: Vocabulary): number[][] {
  // The official character tokenizer removes characters outside its vocabulary.
  const characters = [...phonemes].filter((character) => Object.hasOwn(vocabulary, character));
  if (!characters.length) throw new Error("No Kokoro tokens in phonemized text");
  const chunks: number[][] = [];
  for (let start = 0; start < characters.length; ) {
    let end = Math.min(start + MAX_PHONEMES, characters.length);
    if (end < characters.length) {
      for (let boundary = end - 1; boundary > start; boundary -= 1) {
        if (/[ ;:,.!?]/.test(characters[boundary])) {
          end = boundary + 1;
          break;
        }
      }
    }
    chunks.push(characters.slice(start, end).map((character) => vocabulary[character]));
    start = end;
  }
  return chunks;
}

function abortError(): DOMException {
  return new DOMException("Voice playback stopped", "AbortError");
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Browser permission promises may never settle; cancellation must still work. */
function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Requires onnxruntime-web and phonemizer; intentionally no CDN or built-in voice fallback.
 * Parent provisions matching model/tokenizer/voice assets from the frozen model mirror.
 * The phonemizer package bundles eSpeak-NG; it does not use browser speech services.
 */
export async function createKokoroWebVoice(options: KokoroWebOptions): Promise<WebVoice> {
  const modelUrl = localUrl(options.modelUrl);
  const tokenizerUrl = localUrl(options.tokenizerUrl);
  const voiceUrl = localUrl(options.voiceUrl);
  const wasmPaths = localUrl(options.wasmPaths, true);
  if (!["en-us", "en"].includes(options.language))
    throw new TypeError("Unsupported Kokoro voice language");
  const language = options.language;
  const bus = options.bus ?? companionBus;
  const readAsset = options.readAsset ?? ((url: string) => fetch(url, { redirect: "error" }));
  const [ort, { phonemize }, modelResponse, tokenizerResponse, voiceResponse] = await Promise.all([
    import("onnxruntime-web/webgpu"),
    import("phonemizer"),
    fetchAsset(modelUrl, readAsset),
    fetchAsset(tokenizerUrl, readAsset),
    fetchAsset(voiceUrl, readAsset),
  ]);
  const vocabulary = vocabularyFrom(await tokenizerResponse.json());
  const voiceBytes = await voiceResponse.arrayBuffer();
  if (voiceBytes.byteLength !== 510 * STYLE_DIM * Float32Array.BYTES_PER_ELEMENT) {
    throw new TypeError("Kokoro v1 voice must contain 510 rows of 256 float32 values");
  }
  const voice = new Float32Array(voiceBytes);
  if (!voice.every(Number.isFinite) || !voice.some((value) => value !== 0)) {
    throw new TypeError("Kokoro voice asset is empty or contains invalid values");
  }
  const model = await modelResponse.arrayBuffer();
  ort.env.wasm.wasmPaths = wasmPaths;
  // Works without COOP/COEP; no proxy worker (which cannot serve WebGPU).
  ort.env.wasm.numThreads = 1;
  let backend: WebVoice["backend"] = "wasm";
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<object | null> } }).gpu;
  if (gpu) {
    try {
      // Browsers can expose navigator.gpu without an available adapter. ORT can
      // silently remove an unavailable provider, so check this before selecting it.
      if (await gpu.requestAdapter()) backend = "webgpu";
    } catch {
      /* Adapter unavailable: initialize the WASM execution provider. */
    }
  }
  let session: InferenceSession;
  try {
    session = await ort.InferenceSession.create(model, {
      executionProviders: backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
    });
  } catch (error) {
    if (backend !== "webgpu") throw error;
    backend = "wasm";
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  }
  if (
    !["input_ids", "style", "speed"].every((name) => session.inputNames.includes(name)) ||
    !session.outputNames.includes("waveform")
  ) {
    await session.release();
    throw new TypeError("Expected Kokoro ONNX input_ids/style/speed -> waveform export");
  }

  let context: AudioContext | undefined;
  let active: { controller: AbortController; promise: Promise<void> } | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const loadWorklet = async (audio: AudioContext): Promise<void> => {
    const url = URL.createObjectURL(new Blob([KOKORO_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await audio.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  let workletReady: Promise<void> | undefined;

  async function synthesize(
    text: string,
    speed: number,
    signal: AbortSignal,
  ): Promise<Float32Array> {
    assertActive(signal);
    const phonemes = await abortable(phonemesFor(text, language, phonemize), signal);
    const chunks: Float32Array[] = [];
    for (const ids of tokenChunks(phonemes, vocabulary)) {
      assertActive(signal);
      const row = Math.min(ids.length, 509);
      const feeds: Record<string, Tensor> = {
        input_ids: new ort.Tensor("int64", BigInt64Array.from([0, ...ids, 0], BigInt), [
          1,
          ids.length + 2,
        ]),
        style: new ort.Tensor("float32", voice.slice(row * STYLE_DIM, (row + 1) * STYLE_DIM), [
          1,
          STYLE_DIM,
        ]),
        speed: new ort.Tensor("float32", Float32Array.of(speed), [1]),
      };
      let outputs: InferenceSession.ReturnType | undefined;
      try {
        outputs = await session.run(feeds);
        assertActive(signal);
        const pcm = outputs.waveform?.data;
        if (!(pcm instanceof Float32Array) || pcm.length === 0 || !pcm.every(Number.isFinite)) {
          throw new TypeError("Kokoro returned invalid PCM");
        }
        chunks.push(pcm.slice());
      } finally {
        for (const tensor of Object.values(feeds)) {
          tensor.dispose();
        }
        if (outputs) {
          for (const tensor of Object.values(outputs)) {
            tensor.dispose();
          }
        }
      }
    }
    const pcm = new Float32Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    return pcm;
  }

  async function play(audio: AudioContext, pcm: Float32Array, signal: AbortSignal): Promise<void> {
    assertActive(signal);
    if (audio.state !== "running") throw new Error("Audio playback was interrupted");
    await new Promise<void>((resolve, reject) => {
      const node = new AudioWorkletNode(audio, "natally-kokoro", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { pcm, sourceRate: KOKORO_SAMPLE_RATE },
      });
      let started = false;
      let finished = false;
      const finish = (error?: unknown): void => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        audio.removeEventListener("statechange", onStateChange);
        node.port.onmessage = null;
        node.onprocessorerror = null;
        node.disconnect();
        node.port.close();
        try {
          if (started) bus.emit({ type: "envelope-end" });
        } catch (failure) {
          error ??= failure;
        }
        if (error !== undefined) reject(error);
        else resolve();
      };
      const onAbort = (): void => finish(abortError());
      const onStateChange = (): void => {
        if (audio.state !== "running") finish(new Error("Audio playback was interrupted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      audio.addEventListener("statechange", onStateChange);
      node.onprocessorerror = () => finish(new Error("Kokoro AudioWorklet failed"));
      node.port.onmessage = (event: MessageEvent) => {
        if (finished) return;
        try {
          if (event.data.type === "start") {
            if (!started) {
              started = true;
              bus.emit({ type: "envelope-start" });
            }
          } else if (event.data.type === "frame" && started) {
            bus.emit({ type: "envelope-level", level: rmsEnvelope(event.data.samples) });
          } else if (event.data.type === "done") finish();
        } catch (error) {
          finish(error);
        }
      };
      try {
        node.connect(audio.destination);
      } catch (error) {
        finish(error);
      }
    });
  }

  return {
    get backend() {
      return backend;
    },
    speak(text, { speed = 1, signal } = {}) {
      if (disposed) return Promise.reject(new Error("Kokoro voice is disposed"));
      if (active) return Promise.reject(new Error("Kokoro voice is already speaking"));
      if (!Number.isFinite(speed) || speed <= 0)
        return Promise.reject(new RangeError("Voice speed must be positive"));
      if (signal?.aborted) return Promise.reject(abortError());
      if (!text.trim()) return Promise.resolve();
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const promise = (async () => {
        try {
          // Resume synchronously within speak's user-gesture call stack, before inference.
          context ??= new AudioContext();
          const resumed = context.resume();
          await abortable(resumed, controller.signal);
          assertActive(controller.signal);
          workletReady ??= loadWorklet(context).catch((error) => {
            workletReady = undefined;
            throw error;
          });
          await abortable(workletReady, controller.signal);
          const pcm = await synthesize(text, speed, controller.signal);
          await play(context, pcm, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted)
            bus.emit({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          throw error;
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      })();
      const tracked = promise.finally(() => {
        active = undefined;
      });
      active = { controller, promise: tracked };
      return tracked;
    },
    stop() {
      active?.controller.abort();
    },
    dispose() {
      disposal ??= (async () => {
        disposed = true;
        active?.controller.abort();
        try {
          await active?.promise;
        } catch {
          /* speak reports its own failure. */
        }
        try {
          if (context && context.state !== "closed") await context.close();
        } finally {
          await session.release();
        }
      })();
      return disposal;
    },
  };
}
