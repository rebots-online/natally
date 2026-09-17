// These are contract fixtures, not an attestation that model inference was run.
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmsEnvelope } from "./envelope";
import {
  createKokoroWebVoice,
  KOKORO_SAMPLE_RATE,
  KOKORO_WORKLET_SOURCE,
  type KokoroWebOptions,
} from "./web";

const mocks = vi.hoisted(() => ({
  phonemize: vi.fn(),
  run: vi.fn(),
  release: vi.fn(),
  create: vi.fn(),
  adapter: vi.fn(),
  env: { wasm: { wasmPaths: "", numThreads: 0 } },
  dispose: vi.fn(),
}));

vi.mock("phonemizer", () => ({ phonemize: mocks.phonemize }));
vi.mock("onnxruntime-web/webgpu", () => ({
  env: mocks.env,
  InferenceSession: { create: mocks.create },
  Tensor: class {
    dispose = mocks.dispose;
    constructor(
      public type: string,
      public data: Float32Array | BigInt64Array,
      public dims: number[],
    ) {}
  },
}));

const options: KokoroWebOptions = {
  modelUrl: "/models/kokoro.onnx",
  tokenizerUrl: "/models/tokenizer.json",
  voiceUrl: "/models/af_heart.bin",
  wasmPaths: "/ort/",
  language: "en-us",
};
const session = {
  inputNames: ["input_ids", "style", "speed"],
  outputNames: ["waveform"],
  run: mocks.run,
  release: mocks.release,
};
let emitted: { type: string }[];
let contexts: TestAudioContext[];
let nodes: TestWorkletNode[];
let assets: Map<string, () => Response>;

class TestAudioContext extends EventTarget {
  state = "suspended";
  destination = {};
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    super();
    contexts.push(this);
  }
}
class TestWorkletNode {
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  onprocessorerror: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public context: TestAudioContext,
    public name: string,
    public options: AudioWorkletNodeOptions,
  ) {
    nodes.push(this);
  }
  message(data: unknown) {
    this.port.onmessage?.({ data });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  emitted = [];
  contexts = [];
  nodes = [];
  vi.stubGlobal("location", new URL("https://natally.test/"));
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("AudioContext", TestAudioContext);
  vi.stubGlobal("AudioWorkletNode", TestWorkletNode);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:https://natally.test/worklet");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const voice = new Float32Array(510 * 256);
  for (let row = 0; row < 510; row += 1) voice.fill(row + 0.5, row * 256, (row + 1) * 256);
  assets = new Map([
    ["/models/kokoro.onnx", () => new Response(new Uint8Array([1, 2, 3]))],
    [
      "/models/tokenizer.json",
      () =>
        Response.json({
          model: { vocab: { $: 0, a: 43, b: 44, " ": 16, ".": 4, ",": 3, ɹ: 123, j: 52 } },
        }),
    ],
    ["/models/af_heart.bin", () => new Response(voice)],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        assets.get(new URL(url).pathname)?.() ?? new Response(null, { status: 404 }),
    ),
  );
  mocks.phonemize.mockReset().mockResolvedValue(["ab"]);
  mocks.adapter.mockReset().mockResolvedValue({});
  mocks.create.mockReset().mockResolvedValue(session);
  mocks.run.mockReset().mockImplementation(async () => ({
    waveform: { data: Float32Array.of(0.5, -0.5), dispose: mocks.dispose },
  }));
  mocks.release.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function voice(overrides: Partial<KokoroWebOptions> = {}) {
  return createKokoroWebVoice({
    ...options,
    bus: {
      emit: (event) => {
        emitted.push(event);
      },
    },
    ...overrides,
  });
}

async function finishPlayback() {
  await vi.waitFor(() => expect(nodes).toHaveLength(1));
  nodes[0].message({ type: "start" });
  nodes[0].message({ type: "frame", samples: Float32Array.of(0.5, -0.5) });
  nodes[0].message({ type: "done" });
}

describe("Kokoro web inference and playback contract", () => {
  it("feeds phoneme IDs, real voice rows and speed, then emits playback-driven RMS", async () => {
    const tts = await voice();
    expect(tts.backend).toBe("wasm");
    expect(mocks.create).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
      executionProviders: ["wasm"],
    });
    expect(mocks.env.wasm).toEqual({ wasmPaths: "https://natally.test/ort/", numThreads: 1 });
    const speaking = tts.speak("Hello", { speed: 1.25 });
    expect(contexts[0].resume).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(nodes).toHaveLength(1));
    expect(emitted).toEqual([]);
    expect(mocks.phonemize).toHaveBeenCalledWith("Hello", "en-us");
    const feeds = mocks.run.mock.calls[0][0];
    expect([...feeds.input_ids.data]).toEqual([0n, 43n, 44n, 0n]);
    expect(feeds.input_ids.dims).toEqual([1, 4]);
    expect(feeds.style.dims).toEqual([1, 256]);
    expect([...feeds.style.data]).toEqual(Array(256).fill(2.5));
    expect([...feeds.speed.data]).toEqual([1.25]);
    expect(nodes[0].options.processorOptions.pcm).toEqual(Float32Array.of(0.5, -0.5));
    expect(nodes[0].options.processorOptions.sourceRate).toBe(24000);
    await finishPlayback();
    await speaking;
    expect(emitted).toEqual([
      { type: "envelope-start" },
      { type: "envelope-level", level: 0.5 },
      { type: "envelope-end" },
    ]);
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    expect(nodes[0].port.close).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledTimes(4);
    await tts.dispose();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("tries WebGPU, then falls back to WASM on session initialization failure", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: mocks.adapter } });
    mocks.create.mockRejectedValueOnce(new Error("Unsupported GPU"));
    const tts = await voice();
    expect(tts.backend).toBe("wasm");
    expect(mocks.create.mock.calls.map((call) => call[1])).toEqual([
      { executionProviders: ["webgpu", "wasm"] },
      { executionProviders: ["wasm"] },
    ]);
    await tts.dispose();
  });

  it("selects WebGPU when available and keeps WASM operator fallback", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: mocks.adapter } });
    const tts = await voice();
    expect(tts.backend).toBe("webgpu");
    await tts.dispose();
  });

  it.each(["null", "rejected"])(
    "reports WASM when no GPU adapter is available: %s",
    async (failure) => {
      vi.stubGlobal("navigator", { gpu: { requestAdapter: mocks.adapter } });
      if (failure === "null") mocks.adapter.mockResolvedValueOnce(null);
      else mocks.adapter.mockRejectedValueOnce(new Error("Failed to get GPU adapter"));
      const tts = await voice();
      expect(tts.backend).toBe("wasm");
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), {
        executionProviders: ["wasm"],
      });
      await tts.dispose();
    },
  );

  it("retains punctuation and adapts eSpeak IPA to Kokoro's vocabulary", async () => {
    mocks.phonemize.mockResolvedValue(["rʲ"]);
    const tts = await voice({ language: "en" });
    const speaking = tts.speak("Hello, Robin.");
    await finishPlayback();
    await speaking;
    expect(mocks.phonemize.mock.calls).toEqual([
      ["Hello", "en"],
      ["Robin", "en"],
    ]);
    expect([...mocks.run.mock.calls[0][0].input_ids.data]).toEqual([
      0n,
      123n,
      52n,
      3n,
      16n,
      123n,
      52n,
      4n,
      0n,
    ]);
    await tts.dispose();
  });

  it("chunks more than 510 phonemes without silently dropping the remainder", async () => {
    mocks.phonemize.mockResolvedValue(["a".repeat(1021)]);
    const tts = await voice();
    const speaking = tts.speak("A long utterance");
    await finishPlayback();
    await speaking;
    expect(mocks.run.mock.calls.map((call) => call[0].input_ids.dims)).toEqual([
      [1, 512],
      [1, 512],
      [1, 3],
    ]);
    expect(mocks.run.mock.calls.map((call) => call[0].style.data[0])).toEqual([509.5, 509.5, 1.5]);
    expect(nodes[0].options.processorOptions.pcm.length).toBe(6);
    await tts.dispose();
  });

  it("passes decimals, grouped numbers and clock times intact to eSpeak", async () => {
    const tts = await voice();
    const speaking = tts.speak("3.14 and 1,234 at 12:30.");
    await finishPlayback();
    await speaking;
    expect(mocks.phonemize).toHaveBeenCalledWith("3.14 and 1,234 at 12:30", "en-us");
    await tts.dispose();
  });

  it("cancels a pending audio permission promise without running inference", async () => {
    class PendingAudioContext extends TestAudioContext {
      resume = vi.fn(() => new Promise<void>(() => {}));
    }
    vi.stubGlobal("AudioContext", PendingAudioContext);
    const tts = await voice();
    const speaking = tts.speak("Hello");
    const rejected = expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    tts.stop();
    await rejected;
    expect(mocks.run).not.toHaveBeenCalled();
    await tts.dispose();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("fails promptly if the audio context is suspended during inference", async () => {
    mocks.run.mockImplementationOnce(async () => {
      contexts[0].state = "suspended";
      return { waveform: { data: Float32Array.of(0.5), dispose: mocks.dispose } };
    });
    const tts = await voice();
    await expect(tts.speak("Hello")).rejects.toThrow("interrupted");
    expect(nodes).toEqual([]);
    await tts.dispose();
  });

  it("does not emit a level after an envelope-start listener stops playback", async () => {
    const tts = await voice({
      bus: {
        emit: (event) => {
          emitted.push(event);
          if (event.type === "envelope-start") tts.stop();
        },
      },
    });
    const speaking = tts.speak("Hello");
    const rejected = expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(nodes).toHaveLength(1));
    nodes[0].message({ type: "start" });
    nodes[0].message({ type: "frame", samples: Float32Array.of(0.5) });
    await rejected;
    expect(emitted).toEqual([{ type: "envelope-start" }, { type: "envelope-end" }]);
    await tts.dispose();
  });

  it("stops active playback once and rejects overlapping calls", async () => {
    const tts = await voice();
    const speaking = tts.speak("Hello");
    const rejected = expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(nodes).toHaveLength(1));
    await expect(tts.speak("Overlap")).rejects.toThrow("already speaking");
    nodes[0].message({ type: "start" });
    nodes[0].message({ type: "frame", samples: Float32Array.of(0.5) });
    tts.stop();
    tts.stop();
    await rejected;
    expect(emitted.filter((event) => event.type === "envelope-end")).toHaveLength(1);
    expect(emitted.some((event) => event.type === "error")).toBe(false);
    await tts.dispose();
    await tts.dispose();
    expect(mocks.release).toHaveBeenCalledOnce();
    await expect(tts.speak("Later")).rejects.toThrow("disposed");
  });

  it("does not play canceled inference and disposes only after the run finishes", async () => {
    let complete!: (value: unknown) => void;
    mocks.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const tts = await voice();
    const speaking = tts.speak("Hello");
    const rejected = expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    const disposal = tts.dispose();
    expect(mocks.release).not.toHaveBeenCalled();
    complete({ waveform: { data: Float32Array.of(0.1), dispose: mocks.dispose } });
    await rejected;
    await disposal;
    expect(nodes).toEqual([]);
    expect(emitted).toEqual([]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("accepts caller cancellation and no-ops empty input", async () => {
    const tts = await voice();
    await tts.speak("  ");
    await expect(tts.speak("Hello", { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(tts.speak("Hello", { speed: 0 })).rejects.toThrow("positive");
    expect(contexts).toEqual([]);
    const controller = new AbortController();
    const speaking = tts.speak("Hello", { signal: controller.signal });
    const rejected = expect(speaking).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(nodes).toHaveLength(1));
    controller.abort();
    await rejected;
    expect(emitted).toEqual([]);
    await tts.dispose();
  });

  it.each(["processor", "suspend"])(
    "ends the envelope when playback fails: %s",
    async (failure) => {
      const tts = await voice();
      const speaking = tts.speak("Hello");
      const rejected = expect(speaking).rejects.toThrow();
      await vi.waitFor(() => expect(nodes).toHaveLength(1));
      nodes[0].message({ type: "start" });
      nodes[0].message({ type: "frame", samples: Float32Array.of(0.2) });
      if (failure === "processor") nodes[0].onprocessorerror?.();
      else {
        contexts[0].state = "suspended";
        contexts[0].dispatchEvent(new Event("statechange"));
      }
      await rejected;
      expect(emitted.slice(-2)).toEqual([
        { type: "envelope-end" },
        { type: "error", message: expect.any(String) },
      ]);
      await tts.dispose();
    },
  );

  it("rejects inference failure instead of inventing audio", async () => {
    mocks.run.mockRejectedValueOnce(new Error("ONNX execution failed"));
    const tts = await voice();
    await expect(tts.speak("Hello")).rejects.toThrow("ONNX execution failed");
    expect(nodes).toEqual([]);
    expect(emitted).toEqual([{ type: "error", message: "ONNX execution failed" }]);
    await tts.dispose();
  });

  it("rejects invalid model output", async () => {
    mocks.run.mockResolvedValueOnce({
      waveform: { data: Float32Array.of(NaN), dispose: mocks.dispose },
    });
    const tts = await voice();
    await expect(tts.speak("Hello")).rejects.toThrow("invalid PCM");
    expect(nodes).toEqual([]);
    await tts.dispose();
  });

  it("rejects unavailable and malformed assets without creating a session", async () => {
    await expect(voice({ modelUrl: "/missing.onnx" })).rejects.toThrow("404");
    await expect(voice({ modelUrl: "https://elsewhere.test/model.onnx" })).rejects.toThrow(
      "origin",
    );
    await expect(voice({ wasmPaths: "/ort" })).rejects.toThrow("ending in /");
    assets.set("/models/tokenizer.json", () => new Response("{"));
    await expect(voice()).rejects.toThrow();
    assets.set("/models/tokenizer.json", () => Response.json({ model: { vocab: { $: 0 } } }));
    assets.set("/models/af_heart.bin", () => new Response(new Float32Array(256)));
    await expect(voice()).rejects.toThrow("510 rows");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reads model, tokenizer and voice through the verified cache adapter while offline", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    const readAsset = vi.fn(async (url: string) => {
      const asset = assets.get(new URL(url).pathname);
      if (!asset) throw new Error(`missing test asset: ${url}`);
      return asset();
    });
    const tts = await voice({ readAsset });
    const speaking = tts.speak("Hello");
    await finishPlayback();
    await speaking;
    expect(readAsset.mock.calls.map(([url]) => url)).toEqual([
      "https://natally.test/models/kokoro.onnx",
      "https://natally.test/models/tokenizer.json",
      "https://natally.test/models/af_heart.bin",
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledOnce();
    await tts.dispose();
  });

  it("retains response, tokenizer, and voice validation for cached assets", async () => {
    const readAsset = async (url: string) => {
      const asset = assets.get(new URL(url).pathname);
      if (!asset) throw new Error(`missing test asset: ${url}`);
      return asset();
    };
    assets.set("/models/kokoro.onnx", () => new Response(null, { status: 503 }));
    await expect(voice({ readAsset })).rejects.toThrow("503");
    assets.set("/models/kokoro.onnx", () => new Response(new Uint8Array([1])));
    assets.set("/models/tokenizer.json", () => Response.json({ model: { vocab: { $: 1 } } }));
    await expect(voice({ readAsset })).rejects.toThrow("boundary token");
    assets.set("/models/tokenizer.json", () =>
      Response.json({ model: { vocab: { $: 0, a: 43 } } }),
    );
    assets.set("/models/af_heart.bin", () => new Response(new Float32Array(510 * 256)));
    await expect(voice({ readAsset })).rejects.toThrow("empty or contains invalid");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("production AudioWorklet processor", () => {
  type Message = { type: "start" } | { type: "done" } | { type: "frame"; samples: Float32Array };
  interface Processor {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  }
  function createProcessor(pcm: Float32Array, rate: number, onMessage: (message: Message) => void) {
    let Implementation!: new (options: {
      processorOptions: { pcm: Float32Array; sourceRate: number };
    }) => Processor;
    runInNewContext(KOKORO_WORKLET_SOURCE, {
      sampleRate: rate,
      AudioWorkletProcessor: class {
        port = { postMessage: onMessage };
      },
      registerProcessor: (_name: string, value: typeof Implementation) => {
        Implementation = value;
      },
    });
    return new Implementation({ processorOptions: { pcm, sourceRate: KOKORO_SAMPLE_RATE } });
  }
  function render(pcm: Float32Array, rate: number, quantum: number) {
    const events: Message[] = [];
    const processor = createProcessor(pcm, rate, (message) => events.push(message));
    const output: number[] = [];
    let running = true;
    while (running) {
      const block = new Float32Array(quantum).fill(999);
      running = processor.process([], [[block]]);
      output.push(...block);
      if (output.length > 100_000) throw new Error("Worklet did not finish");
    }
    return { output, events };
  }

  it("resamples 24 kHz PCM to 48 kHz and reports exactly the rendered frames", () => {
    const { output, events } = render(Float32Array.of(0, 1, 0, -1), 48000, 4);
    expect(output).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
    expect(
      events.filter((event) => event.type === "frame").flatMap((event) => [...event.samples]),
    ).toEqual(output);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(rmsEnvelope(output)).toBeCloseTo(Math.sqrt(3.75 / 8));
  });

  it("handles non-128 quanta, clips peaks, and zeros the final unused samples", () => {
    const { output, events } = render(Float32Array.of(2, -2, 0.5), 24000, 5);
    expect(output).toEqual([1, -1, 0.5, 0, 0]);
    expect(events).toHaveLength(3);
    expect(events[1].type).toBe("frame");
    if (events[1].type !== "frame") throw new Error("Expected final envelope window");
    expect([...events[1].samples]).toEqual([1, -1, 0.5]);
    expect(rmsEnvelope(events[1].samples)).toBeCloseTo(Math.sqrt(2.25 / 3));
  });

  it.each([24_000, 44_100, 48_000, 96_000])(
    "emits 20 ms RMS windows at %i Hz across changing render quanta",
    async (rate) => {
      // 50 ms from Kokoro: two full envelope windows plus a 10 ms final window.
      mocks.run.mockResolvedValueOnce({
        waveform: { data: new Float32Array(1200).fill(0.5), dispose: mocks.dispose },
      });
      const tts = await voice();
      const speaking = tts.speak("Hello");
      await vi.waitFor(() => expect(nodes).toHaveLength(1));
      const windows: Float32Array[] = [];
      const processor = createProcessor(nodes[0].options.processorOptions.pcm, rate, (message) => {
        if (message.type === "frame") windows.push(message.samples);
        nodes[0].message(message); // Exercise the production bus handler and RMS too.
      });
      let processed = 0;
      let iteration = 0;
      let running = true;
      const total = rate * 0.05;
      const windowSize = rate * 0.02;
      while (running) {
        // Most are 128-frame quanta; a changing block size must not reset windows.
        const quantum = iteration++ % 3 === 2 ? 233 : 128;
        const output = new Float32Array(quantum);
        running = processor.process([], [[output]]);
        processed = Math.min(total, processed + quantum);
        const expected =
          Math.floor(processed / windowSize) + (!running && processed % windowSize !== 0 ? 1 : 0);
        expect(windows).toHaveLength(expected);
        if (iteration === 1) expect(emitted).toEqual([{ type: "envelope-start" }]);
        expect(processed < total).toBe(running);
      }
      await speaking;
      expect(windows.map((window) => window.length)).toEqual([windowSize, windowSize, rate * 0.01]);
      expect(emitted).toEqual([
        { type: "envelope-start" },
        { type: "envelope-level", level: 0.5 },
        { type: "envelope-level", level: 0.5 },
        { type: "envelope-level", level: 0.5 },
        { type: "envelope-end" },
      ]);
      // Even an extra call after completion cannot duplicate the last window/end.
      expect(processor.process([], [[new Float32Array(128)]])).toBe(false);
      expect(windows).toHaveLength(3);
      await tts.dispose();
    },
  );

  it("aggregates sample energy across quantum boundaries and flushes only once on an exact window", () => {
    const pcm = new Float32Array(480);
    pcm.fill(1, 0, 128);
    const { events } = render(pcm, 24_000, 128);
    const windows = events.filter((event) => event.type === "frame");
    expect(events.map((event) => event.type)).toEqual(["start", "frame", "done"]);
    expect(windows[0].samples.length).toBe(480);
    expect(rmsEnvelope(windows[0].samples)).toBeCloseTo(Math.sqrt(128 / 480));
  });
});
