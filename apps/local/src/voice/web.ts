// natally — Web-leg voice (D7a): Kokoro synthesis through an INJECTED
// onnxruntime-web structural handle, AudioWorklet playback through an injected
// structural handle, sentence-chunked FIFO queue, and the shared envelope tap.
// ARCHITECTURE.md §10: WebGPU where present, WASM otherwise; PCM through Web
// Audio. The Web Speech API surface is banned on every leg and guarded by
// `scripts/grep-no-speechsynthesis.sh` (TR-5) — this module never touches it.
//
// onnxruntime-web is NOT a dependency of this package: the real module is wired
// in by I.3 through the `OrtHandle` seam below. This file owns orchestration
// only — session creation (execution-provider option passed through verbatim),
// chunking, queueing, the envelope tap, mute, and error events.
//
// Stage wiring (§10): envelope events drive Speaking (orb+mouth); a synthesis
// failure emits a CompanionEvent of the "error" shape so the Stage can go to
// Error on real events only.

import type { CompanionEvent } from "@natally/lore/types";
import { rmsEnvelope } from "./envelope";

// ---------------------------------------------------------------------------
// Structural handles (injected; the real onnxruntime-web module satisfies them)
// ---------------------------------------------------------------------------

/** Minimal structural view of an ONNX tensor (the real ORT Tensor satisfies it). */
export interface OrtTensor {
  readonly type: string;
  readonly dims: readonly number[];
  readonly data: Float32Array | Int32Array | BigInt64Array | Uint8Array;
}

export interface OrtFeeds {
  readonly [name: string]: OrtTensor;
}

export interface OrtOutputs {
  readonly [name: string]: OrtTensor;
}

export interface OrtSessionOptions {
  /**
   * Execution providers, best first. `createWebVoice` passes
   * `["webgpu", "wasm"]` when WebGPU is available (`navigator.gpu`), else
   * `["wasm"]`. Passed through to the injected runtime verbatim — the runtime
   * interprets the option; this module never second-guesses it.
   */
  readonly executionProviders?: readonly string[];
}

export interface OrtSession {
  run(feeds: OrtFeeds): Promise<OrtOutputs>;
}

/** Structural handle for the injected onnxruntime-web module (I.3 wires it). */
export interface OrtHandle {
  createSession(model: Uint8Array | string, options?: OrtSessionOptions): Promise<OrtSession>;
}

/**
 * Structural AudioWorklet playback handle (D7a). The real implementation posts
 * PCM to an AudioWorkletNode and resolves `play` when the worklet reports the
 * buffer drained — or when `stop()` was called (play resolves, never hangs,
 * after stop). Clock alignment between envelope events and audible output is
 * the real handle's concern; this module streams envelope events on the PCM
 * stream (see `createWebVoice`).
 */
export interface WebVoiceAudio {
  play(pcm: Float32Array): Promise<void>;
  stop(): void;
}

/** Reference to the Kokoro model the voice speaks with (mirror-sourced, §13). */
export interface KokoroModelRef {
  /** ONNX model bytes, or a URL the injected ORT runtime can fetch. */
  readonly source: Uint8Array | string;
  /** Sample rate of the synthesized PCM (Kokoro emits 24 kHz). */
  readonly sampleRate: number;
  /** Style latent of the selected voice (Kokoro 256-dim style vector). */
  readonly style: Float32Array;
  /** Speech-rate multiplier fed to Kokoro's speed input; default 1. */
  readonly speed?: number;
}

// ---------------------------------------------------------------------------
// Execution-provider selection (WebGPU when present, WASM fallback)
// ---------------------------------------------------------------------------

/** Best-first execution-provider list for a WebGPU availability flag. */
export function executionProvidersFor(hasWebGpu: boolean): readonly string[] {
  return hasWebGpu ? ["webgpu", "wasm"] : ["wasm"];
}

/**
 * WebGPU availability probe. Structural (`navigator.gpu != null`) so it is
 * honest in every embedding — including non-browser test environments, where
 * it reports false and the WASM provider is selected.
 */
export function hasWebGpu(): boolean {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as unknown as { gpu?: unknown }).gpu;
  return gpu != null;
}

// ---------------------------------------------------------------------------
// Sentence chunking (pure; same semantics as the native leg — document both)
// ---------------------------------------------------------------------------
//
// Normative chunking rules (mirror the Rust leg's documented rules exactly;
// cross-leg agreement is asserted at TR-5 review):
//   1. A sentence break is taken after `!` or `?`, and after `.` unless:
//        a. the `.` sits between two digits (decimal number: "3.14"), or
//        b. the word ending at the `.` is a known abbreviation (set below,
//           compared lowercase with inner dots stripped: "e.g." → "eg"), or
//        c. the word ending at the `.` is a single letter (initials: "J. R. R.").
//   2. A run of consecutive terminators is one break ("What?!" stays whole).
//   3. Terminators stay attached to their sentence; following whitespace is
//      consumed as the inter-sentence gap; chunks are trimmed.
//   4. Breaks happen only at terminator boundaries — never mid-word (rule 1
//      admits no other break site).
//   5. Chunks containing no letter or digit are dropped; empty/whitespace
//      input yields [].

const ABBREVIATION_TOKENS: ReadonlySet<string> = new Set([
  // Honorifics & titles
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "sr",
  "jr",
  // Latin & scholarly abbreviations (incl. "e.g."/"i.e." after dot-stripping)
  "vs",
  "etc",
  "eg",
  "ie",
  "fig",
  "approx",
  "no",
  "vol",
  "inc",
  "ltd",
  "dept",
  "est",
  // Time-of-day and locale tokens
  "am",
  "pm",
  "us",
  "uk",
  "dc",
]);

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isTerminator = (ch: string): boolean => ch === "." || ch === "!" || ch === "?";

/**
 * Decide whether the `.` at index `i` ends a sentence (rules 1a–1c above).
 */
function isSentenceBreakPeriod(text: string, i: number): boolean {
  const prev = i > 0 ? text.charAt(i - 1) : "";
  const next = i + 1 < text.length ? text.charAt(i + 1) : "";
  if (isDigit(prev) && isDigit(next)) return false; // decimal number
  let start = i;
  while (start > 0 && /[A-Za-z.]/.test(text.charAt(start - 1))) start -= 1;
  const word = text.slice(start, i);
  if (word.length === 0) return true; // lone dot ⇒ sentence end
  const bare = word.replaceAll(".", "").toLowerCase();
  if (ABBREVIATION_TOKENS.has(bare)) return false;
  if (bare.length === 1) return false; // initials
  return true;
}

/**
 * Sentence-chunk text for speech (rules above). Pure and deterministic.
 */
export function chunkSentences(text: string): string[] {
  const trimmedInput = text.trim();
  if (trimmedInput.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!isTerminator(text.charAt(i))) continue;
    if (text.charAt(i) === "." && !isSentenceBreakPeriod(text, i)) continue;
    // One break consumes a run of consecutive terminators (rule 2)…
    let end = i + 1;
    while (end < text.length && isTerminator(text.charAt(end))) end += 1;
    // …and the whitespace gap that follows (rule 3).
    while (end < text.length && /\s/.test(text.charAt(end))) end += 1;
    const chunk = text.slice(start, end).trim();
    if (/\p{L}|\p{N}/u.test(chunk)) chunks.push(chunk);
    start = end;
    i = end - 1; // the for-loop's i += 1 lands on the first char after the gap
  }
  const tail = text.slice(start).trim();
  if (/\p{L}|\p{N}/u.test(tail)) chunks.push(tail);
  return chunks;
}

// ---------------------------------------------------------------------------
// Kokoro feed/output contract (documented seam for I.3)
// ---------------------------------------------------------------------------

// Feed and output names of kokoro-v1.0.onnx: input_ids, style, speed → waveform.
const KOKORO_INPUT_IDS = "input_ids";
const KOKORO_STYLE = "style";
const KOKORO_SPEED = "speed";
const KOKORO_OUTPUT = "waveform";

/**
 * The phonemizer seam. The real Kokoro pipeline expects espeak-style phoneme
 * ids; this deterministic Unicode-codepoint encoding is the structural
 * placeholder so the queue/envelope/playback orchestration is complete and
 * testable. I.3 replaces this one function when wiring the real runtime;
 * nothing else in this module changes.
 */
export function encodeChunk(chunk: string): Int32Array {
  const codePoints = Array.from(chunk);
  const ids = new Int32Array(codePoints.length);
  for (let i = 0; i < codePoints.length; i += 1) {
    const cp = codePoints[i];
    ids[i] = cp === undefined ? 0 : (cp.codePointAt(0) ?? 0);
  }
  return ids;
}

/** Build the Kokoro feed map for one sentence chunk. */
export function buildFeeds(chunk: string, modelRef: KokoroModelRef): OrtFeeds {
  const ids = encodeChunk(chunk);
  const speed = modelRef.speed ?? 1;
  return {
    [KOKORO_INPUT_IDS]: { type: "int32", dims: [ids.length], data: ids },
    [KOKORO_STYLE]: { type: "float32", dims: [modelRef.style.length], data: modelRef.style },
    [KOKORO_SPEED]: { type: "float32", dims: [1], data: Float32Array.of(speed) },
  };
}

/** Extract PCM from a Kokoro output map: `waveform` first, else first float32 output. */
export function readPcm(outputs: OrtOutputs): Float32Array {
  const named = outputs[KOKORO_OUTPUT];
  if (named !== undefined && named.data instanceof Float32Array) return named.data;
  for (const key of Object.keys(outputs)) {
    const tensor = outputs[key];
    if (tensor !== undefined && tensor.data instanceof Float32Array) return tensor.data;
  }
  throw new Error("voice web: synthesis produced no float32 waveform output");
}

// ---------------------------------------------------------------------------
// createWebVoice — orchestration
// ---------------------------------------------------------------------------

export interface WebVoiceOptions {
  readonly ort: OrtHandle;
  readonly audio: WebVoiceAudio;
  readonly modelRef: KokoroModelRef;
  /** Receives CompanionEvents: "envelope" per 20 ms window and "error" on engine failure. */
  readonly onEnvelope: (event: CompanionEvent) => void;
}

export interface WebVoice {
  /**
   * Enqueue `text`. It is sentence-chunked (`chunkSentences`) and the chunks
   * are synthesized and played strictly in order (TR-5: queue drains in
   * order). Resolves when this utterance has finished playing, was dropped by
   * `stop()`, or the queue was drained by an engine failure (the failure
   * itself is signalled as an "error" CompanionEvent, not a rejection).
   */
  speak(text: string): Promise<void>;
  /**
   * Mute suppresses playback only: synthesis and the envelope tap still run
   * and "envelope" events still flow (TR-5: mute does not eat the transcript
   * or the envelope). Turning mute on stops the currently audible chunk
   * immediately. Persistence of the flag is config wiring's job, not this
   * module's.
   */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Abort now: drop queued utterances, stop playback, supersede in-flight work. */
  stop(): void;
  readonly sampleRate: number;
}

interface QueueItem {
  run: () => Promise<"done" | "dropped" | "failed">;
  resolve: () => void;
}

/**
 * Create the web-leg voice. Structural contract summary:
 *  - `ort.createSession` receives the model from `modelRef` and an execution-
 *    provider option (WebGPU first when `navigator.gpu` exists, WASM fallback).
 *  - Each sentence chunk is one synthesis call; its PCM streams through the
 *    shared RMS tap (`rmsEnvelope`), emitting one "envelope" CompanionEvent
 *    per 20 ms window in stream order, and is then handed to `audio.play`.
 *    Envelope events are keyed to the PCM stream, not the audio clock — the
 *    real AudioWorklet handle owns clock alignment.
 *  - Engine failures (session creation, run, missing output) emit the
 *    CompanionEvent "error" shape and drain the queue (§10: Error on engine
 *    failure); a later `speak` re-arms the voice.
 */
export function createWebVoice(options: WebVoiceOptions): WebVoice {
  const { ort, audio, modelRef, onEnvelope } = options;
  const executionProviders = executionProvidersFor(hasWebGpu());

  let muted = false;
  // `generation` supersedes work: stop() and each new speak() bump it, so an
  // in-flight utterance observes staleness at its next gate and drops.
  let generation = 0;
  let pending: QueueItem[] = [];
  let running = false;
  let sessionPromise: Promise<OrtSession> | null = null;

  const session = (): Promise<OrtSession> => {
    sessionPromise ??= ort.createSession(modelRef.source, { executionProviders });
    return sessionPromise;
  };

  const runChunk = async (chunk: string, gen: number): Promise<void> => {
    const synthesizer = await session();
    const outputs = await synthesizer.run(buildFeeds(chunk, modelRef));
    const pcm = readPcm(outputs);
    // Envelope tap: the synthesized PCM streams through the shared RMS math;
    // one CompanionEvent per window, in stream order.
    for (const rms of rmsEnvelope(pcm, modelRef.sampleRate)) {
      onEnvelope({ type: "envelope", rms });
    }
    if (gen !== generation || muted) return; // dropped / muted: no playback
    await audio.play(pcm);
  };

  const runUtterance = async (
    text: string,
    gen: number,
  ): Promise<"done" | "dropped" | "failed"> => {
    for (const chunk of chunkSentences(text)) {
      if (gen !== generation) return "dropped";
      try {
        await runChunk(chunk, gen);
      } catch (cause: unknown) {
        const raw = cause instanceof Error ? cause.message : String(cause);
        onEnvelope({ type: "error", message: raw.length > 0 ? raw : "voice web: engine failure" });
        return "failed";
      }
    }
    return "done";
  };

  const flushPending = (): void => {
    for (const item of pending) item.resolve();
    pending = [];
  };

  const pump = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const item = pending.shift();
        if (item === undefined) break;
        const outcome = await item.run();
        item.resolve();
        if (outcome !== "done") {
          // dropped (stop) or failed (engine): nothing queued continues.
          flushPending();
          break;
        }
      }
    } finally {
      running = false;
    }
  };

  const speak = (text: string): Promise<void> =>
    new Promise<void>((resolve) => {
      // No generation bump here: utterances enqueued while one is speaking
      // queue behind it (FIFO, TR-5). Only stop() supersedes in-flight work.
      const gen = generation;
      pending.push({
        run: () => runUtterance(text, gen),
        resolve,
      });
      void pump();
    });

  return {
    speak,
    setMuted(next: boolean): void {
      muted = next;
      if (muted) audio.stop(); // immediate silence; envelopes keep flowing
    },
    isMuted(): boolean {
      return muted;
    },
    stop(): void {
      generation += 1;
      flushPending();
      audio.stop();
    },
    get sampleRate(): number {
      return modelRef.sampleRate;
    },
  };
}
