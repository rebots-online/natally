// natally — V.2 web-voice orchestration tests: queue order, mute suppression,
// execution-provider pass-through, stop semantics, and engine-failure events —
// all against injected fake OrtHandle / WebVoiceAudio handles (tests only; no
// mocks ship in src). Events are validated against the lore CompanionEvent
// schemas so the bus contract (packages/lore/src/types.ts) is enforced here.
import {
  CompanionEventSchema,
  type CompanionEvent,
  type EnvelopeEvent,
} from "@natally/lore/types";
import { describe, expect, it } from "vitest";
import {
  createWebVoice,
  executionProvidersFor,
  type KokoroModelRef,
  type OrtHandle,
  type OrtOutputs,
  type OrtSessionOptions,
  type WebVoiceAudio,
} from "./web";

const MODEL_BYTES = Uint8Array.of(1, 2, 3);

const modelRef: KokoroModelRef = {
  source: MODEL_BYTES,
  sampleRate: 24000, // Kokoro's rate; windowSizeFor(24000) === 480
  style: new Float32Array(256),
  speed: 1,
};

/** Deterministic sine: amplitude × sin(2π·i/period). */
function sine(samples: number, period: number, amplitude = 1): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * i) / period);
  }
  return out;
}

/**
 * One 20 ms window (480 samples @ 24 kHz) per clip; "Beta?" carries two
 * amplitude halves so peak normalization yields [1, 0.5].
 */
const PCM_FOR: Record<string, Float32Array> = {
  "Alpha.": sine(480, 20, 1),
  "Beta?": (() => {
    const pcm = new Float32Array(960);
    pcm.set(sine(480, 20, 1), 0);
    pcm.set(sine(480, 20, 0.5), 480);
    return pcm;
  })(),
  "Yes!": new Float32Array(480),
};

interface Fakes {
  readonly ort: OrtHandle;
  readonly audio: WebVoiceAudio;
  readonly createCalls: Array<{ model: Uint8Array | string; options?: OrtSessionOptions }>;
  readonly played: Float32Array[];
  readonly stopCalls: () => number;
  readonly releasePlay: () => void;
}

function makeFakes(options?: { failRun?: boolean; blockPlay?: boolean }): Fakes {
  const createCalls: Fakes["createCalls"] = [];
  const played: Float32Array[] = [];
  let stops = 0;
  let release: (() => void) | null = null;
  // blockPlay gates every play() behind an unresolved promise so a test can
  // hold the in-flight chunk open across stop(); default is a resolved gate.
  const gate =
    options?.blockPlay === true
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
  const ort: OrtHandle = {
    createSession: async (model, createOptions) => {
      createCalls.push({ model, options: createOptions });
      return {
        run: async (feeds) => {
          if (options?.failRun === true) {
            throw new Error("fake engine: run failed");
          }
          const ids = feeds["input_ids"];
          if (ids === undefined || !(ids.data instanceof Int32Array)) {
            throw new Error("fake engine: missing input_ids");
          }
          const chunk = String.fromCodePoint(...Array.from(ids.data));
          const pcm = PCM_FOR[chunk];
          if (pcm === undefined) throw new Error(`fake engine: no pcm for ${chunk}`);
          const outputs: OrtOutputs = {
            waveform: { type: "float32", dims: [pcm.length], data: pcm },
          };
          return outputs;
        },
      };
    },
  };
  const audio: WebVoiceAudio = {
    play: async (pcm) => {
      played.push(pcm);
      await gate;
    },
    stop: () => {
      stops += 1;
    },
  };
  return {
    ort,
    audio,
    createCalls,
    played,
    stopCalls: () => stops,
    releasePlay: () => {
      if (release !== null) release();
    },
  };
}

async function waitUntil(condition: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Narrowing read of the events as envelope shapes. */
function envelopes(events: CompanionEvent[]): EnvelopeEvent[] {
  return events.filter((event): event is EnvelopeEvent => event.type === "envelope");
}

describe("voice web: queue order + mute suppression", () => {
  it("passes the WebGPU-or-WASM execution-provider option through, session created once", async () => {
    expect(executionProvidersFor(true)).toEqual(["webgpu", "wasm"]);
    expect(executionProvidersFor(false)).toEqual(["wasm"]);
    const fakes = makeFakes();
    const voice = createWebVoice({
      ort: fakes.ort,
      audio: fakes.audio,
      modelRef,
      onEnvelope: () => undefined,
    });
    await voice.speak("Alpha.");
    await voice.speak("Beta.");
    expect(fakes.createCalls).toHaveLength(1); // lazy singleton session
    const call = fakes.createCalls[0];
    expect(call?.model).toBe(MODEL_BYTES);
    // Non-browser test environment ⇒ no navigator.gpu ⇒ WASM selected.
    expect(call?.options?.executionProviders).toEqual(["wasm"]);
  });

  it("chunks play in order and envelope events stream per window in chunk order", async () => {
    const fakes = makeFakes();
    const events: CompanionEvent[] = [];
    const voice = createWebVoice({
      ort: fakes.ort,
      audio: fakes.audio,
      modelRef,
      onEnvelope: (event) => {
        events.push(event);
      },
    });
    await voice.speak("Alpha. Beta? Yes!");
    expect(fakes.played.map((pcm) => pcm.length)).toEqual([480, 960, 480]);
    // "Alpha." loud, "Beta?" mixed → [1, 0.5], "Yes!" silent → [0].
    const rms = envelopes(events).map((event) => event.rms);
    expect(rms).toHaveLength(4);
    expect(rms[0]).toBeCloseTo(1, 9);
    expect(rms[1]).toBeCloseTo(1, 9);
    expect(rms[2]).toBeCloseTo(0.5, 9);
    expect(rms[3]).toBeCloseTo(0, 9);
    for (const event of events) {
      expect(CompanionEventSchema.parse(event)).toBeDefined();
    }
  });

  it("mute suppresses playback but not the envelope tap", async () => {
    const fakes = makeFakes();
    const events: CompanionEvent[] = [];
    const voice = createWebVoice({
      ort: fakes.ort,
      audio: fakes.audio,
      modelRef,
      onEnvelope: (event) => {
        events.push(event);
      },
    });
    voice.setMuted(true);
    expect(voice.isMuted()).toBe(true);
    expect(fakes.stopCalls()).toBe(1); // immediate silence
    await voice.speak("Alpha.");
    expect(fakes.played).toHaveLength(0); // no playback while muted
    expect(envelopes(events).map((event) => event.rms)).toEqual([1]); // envelope still flows
    voice.setMuted(false);
    await voice.speak("Alpha.");
    expect(fakes.played).toHaveLength(1); // unmuted speaks again
    expect(envelopes(events)).toHaveLength(2);
  });

  it("stop() drops queued chunks, unblocks the in-flight one, and re-arms", async () => {
    const fakes = makeFakes({ blockPlay: true });
    const voice = createWebVoice({
      ort: fakes.ort,
      audio: fakes.audio,
      modelRef,
      onEnvelope: () => undefined,
    });
    const done = voice.speak("Alpha. Beta.");
    await waitUntil(() => fakes.played.length === 1); // "Alpha." gated in play
    voice.stop();
    fakes.releasePlay();
    await done;
    expect(fakes.played).toHaveLength(1); // "Beta." dropped
    expect(fakes.stopCalls()).toBeGreaterThanOrEqual(1);
    await voice.speak("Alpha."); // fresh speak re-arms the voice
    expect(fakes.played).toHaveLength(2);
  });

  it("engine failure emits the CompanionEvent error shape and drains the queue", async () => {
    const fakes = makeFakes({ failRun: true });
    const events: CompanionEvent[] = [];
    const voice = createWebVoice({
      ort: fakes.ort,
      audio: fakes.audio,
      modelRef,
      onEnvelope: (event) => {
        events.push(event);
      },
    });
    const first = voice.speak("Alpha.");
    const second = voice.speak("Beta.");
    await first;
    await second;
    expect(fakes.played).toHaveLength(0);
    const errors = events.filter((event) => event.type === "error");
    expect(errors).toHaveLength(1); // queued utterance flushed, never run
    const message = errors[0]?.type === "error" ? errors[0].message : "";
    expect(message).toContain("fake engine");
    for (const event of events) {
      expect(CompanionEventSchema.parse(event)).toBeDefined();
    }
  });
});
