// natally — I.3 capability layer tests: both legs of all five capabilities,
// the deep freeze, the wiring-time bindings, and the integrator law grep —
// no Tauri-global selection outside capabilities.ts (TR-9). Everything is
// injected (fake invoke shells, fake wllama/ORT handles); no network, no
// console. The banned symbol is composed from parts so this scanner file
// itself never contains it contiguously (the raw CI grep must stay clean).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LicenseToken } from "@natally/billing";
import { CompanionEventSchema } from "@natally/lore/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindDb,
  bindInference,
  bindInferenceBus,
  bindVoice,
  type CapabilityMap,
  capabilities,
  resolveCapabilities,
} from "./capabilities";
import type { WllamaHandle } from "./companion/inference-web";
import type { EngineParams } from "./companion/lane";
import type { KokoroModelRef, OrtHandle, WebVoiceAudio } from "./voice/web";

/** The banned selection symbol, composed so this file never contains it raw. */
const NEEDLE = ["__TAURI", "__"].join("");

const LEGS = ["db", "inference", "voice", "keychain", "opener"] as const;

const PARAMS: EngineParams = {
  lane: "web",
  modelRef: "natally-models/chat-turboquant-Q4_K_M.gguf",
  quant: { weights: "Q4_K_M", kv: "q8_0" },
};

const CTX = {
  turnId: "turn-0001",
  systemPrompt: "persona law",
  messages: [{ role: "user" as const, content: "hi" }],
};

const TOKEN = "license-token" as LicenseToken;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly cmd: string;
  readonly args: unknown;
}

/** A recording native invoke that always answers `answer`. */
function recordingInvoke(answer: unknown): {
  readonly calls: RecordedCall[];
  invoke(cmd: string, args: unknown): Promise<unknown>;
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    invoke: (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve(answer);
    },
  };
}

/**
 * Runs `run` with a fake Tauri global installed as `globalThis.window`
 * (restored afterwards). `invoke` records every raw (cmd, args) call.
 */
async function withFakeTauri(
  invoke: (cmd: string, args: unknown) => Promise<unknown>,
  run: (calls: RecordedCall[]) => Promise<void>,
): Promise<void> {
  const holder = globalThis as { window?: unknown };
  const previous = holder.window;
  const calls: RecordedCall[] = [];
  holder.window = {
    [NEEDLE]: {
      core: {
        invoke: (cmd: string, args: unknown): Promise<unknown> => {
          calls.push({ cmd, args });
          return invoke(cmd, args);
        },
      },
    },
  };
  try {
    await run(calls);
  } finally {
    holder.window = previous;
  }
}

// ---------------------------------------------------------------------------
// Selection + freeze
// ---------------------------------------------------------------------------

describe("capabilities: single selection point; grep clean elsewhere", () => {
  afterEach(() => {
    // Restore the documented default binding state between tests.
    bindInferenceBus(undefined);
  });

  it("resolveCapabilities(true) selects every native leg", () => {
    const map = resolveCapabilities(true);
    for (const leg of LEGS) {
      expect(map[leg].leg, leg).toBe("native");
    }
  });

  it("resolveCapabilities(false) selects every web leg", () => {
    const map = resolveCapabilities(false);
    for (const leg of LEGS) {
      expect(map[leg].leg, leg).toBe("web");
    }
  });

  it("the runtime export resolves web legs outside a Tauri webview (node test env)", () => {
    for (const leg of LEGS) {
      expect(capabilities[leg].leg, leg).toBe("web");
    }
  });

  it("the resolved map and every capability are deep-frozen", () => {
    for (const isTauri of [true, false]) {
      const frozen = resolveCapabilities(isTauri);
      expect(Object.isFrozen(frozen)).toBe(true);
      for (const leg of LEGS) {
        expect(Object.isFrozen(frozen[leg]), leg).toBe(true);
      }
    }
    const map: CapabilityMap = resolveCapabilities(true);
    expect(() => {
      (map as { db: { leg: string } }).db.leg = "web";
    }).toThrow(TypeError);
  });

  // -------------------------------------------------------------------------
  // db
  // -------------------------------------------------------------------------

  it("db: native leg rides the lore_commands invoke shell (payload-wrapped, memoized); web leg binds honestly", async () => {
    // Unbound web leg: rejects with the bind instruction.
    const web = resolveCapabilities(false).db;
    await expect(web.loreStore()).rejects.toThrow(/bindDb/);

    // A failing open is passed through and never memoized (stays retryable).
    bindDb({ open: () => Promise.reject(new Error("probe open failure")) });
    const first = web.loreStore();
    await expect(first).rejects.toThrow(/probe open failure/);
    const second = web.loreStore();
    expect(second === first).toBe(false);
    await expect(second).rejects.toThrow(/probe open failure/);

    // Native leg: the lore shell wraps each command payload under the Tauri
    // command's single `payload` parameter; the store is memoized; the
    // missing embedder is the shell's honest default (thrown pre-invoke).
    const recorder = recordingInvoke({ ok: true });
    await withFakeTauri(recorder.invoke, async () => {
      const native = resolveCapabilities(true).db;
      const store = await native.loreStore();
      await store.upsertTurn(
        { id: "turn-1", sessionId: "session-1", role: "you", text: "hi", ts: 1 },
        [0.5, -0.5],
      );
      expect((await native.loreStore()) === store).toBe(true);
      await expect(store.query("person-1", "q", 4, 512)).rejects.toThrow(/embedder/);
    });
    expect(recorder.calls.length).toBe(1);
    expect(recorder.calls[0]?.cmd).toBe("lore_upsert_turn");
    expect(recorder.calls[0]?.args).toEqual({
      payload: {
        turn: { id: "turn-1", sessionId: "session-1", role: "you", text: "hi", ts: 1 },
        embedding: [0.5, -0.5],
      },
    });

    // Re-binding discards the memoized web store.
    bindDb({ open: () => Promise.reject(new Error("probe open failure 2")) });
    await expect(web.loreStore()).rejects.toThrow(/probe open failure 2/);
  });

  // -------------------------------------------------------------------------
  // inference
  // -------------------------------------------------------------------------

  it("inference: native engine invokes inference_complete with the camelCase payload and bridges bus tokens to onToken", async () => {
    // (a) Bus unbound — the documented default: exact payload, resolution,
    // and a silent onToken (tokens ride the Rust-emitted bus only).
    const silent: string[] = [];
    await withFakeTauri(
      async (cmd, args) => {
        expect(cmd).toBe("inference_complete");
        expect(args).toEqual({
          payload: {
            turnId: "turn-0001",
            systemPrompt: "persona law",
            messages: [{ role: "user", content: "hi" }],
            maxTokens: 32,
            modelRef: PARAMS.modelRef,
            quant: { weights: "Q4_K_M", kv: "q8_0" },
          },
        });
        return null;
      },
      async () => {
        const engine = resolveCapabilities(true).inference.engineFactory()({
          ...PARAMS,
          lane: "native",
          maxTokens: 32,
        });
        await engine.complete({ ...CTX, maxTokens: 32 }, (text) => silent.push(text));
      },
    );
    expect(silent).toEqual([]);

    // (b) Bus bound — same-turn token events stream to onToken in arrival
    // order; other turns and non-token events are filtered; the subscription
    // is torn down once the invoke returns.
    let busHandler: ((event: unknown) => void) | undefined;
    let unsubscribed = false;
    bindInferenceBus((onEvent) => {
      busHandler = onEvent;
      return () => {
        unsubscribed = true;
      };
    });
    await withFakeTauri(
      async () => null,
      async () => {
        const engine = resolveCapabilities(true).inference.engineFactory()({
          ...PARAMS,
          lane: "native",
        });
        const tokens: string[] = [];
        const pending = engine.complete({ ...CTX }, (text) => tokens.push(text));
        busHandler?.({ type: "token", turnId: "turn-0001", text: "Hel" });
        busHandler?.({ type: "token", turnId: "turn-0001", text: "Hey" });
        busHandler?.({ type: "token", turnId: "other-turn", text: "nope" });
        busHandler?.({ type: "envelope", rms: 0.5 });
        await pending;
        expect(tokens).toEqual(["Hel", "Hey"]);
      },
    );
    expect(unsubscribed).toBe(true);
  });

  it("inference: web engineFactory needs bindInference and streams via the wllama wrapper", async () => {
    const web = resolveCapabilities(false).inference;
    expect(() => web.engineFactory()).toThrow(/bindInference/);

    const handle: WllamaHandle = {
      loadModelUrl: () => Promise.resolve(undefined),
      createChatCompletion: async (_messages, options) => {
        options.onNewToken(0, new Uint8Array(), "Hel", {});
        options.onNewToken(1, new Uint8Array(), "Hello", {});
        return "Hello";
      },
      isModelLoaded: () => false,
      exit: () => Promise.resolve(),
    };
    bindInference(handle);
    const engine = web.engineFactory()(PARAMS);
    const tokens: string[] = [];
    await engine.complete(CTX, (text) => tokens.push(text));
    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("inference: native dispose invokes inference_dispose; web dispose is a no-op", async () => {
    await withFakeTauri(
      async (cmd) => {
        expect(cmd).toBe("inference_dispose");
        return null;
      },
      async () => {
        await resolveCapabilities(true).inference.dispose();
      },
    );
    await resolveCapabilities(false).inference.dispose();
  });

  // -------------------------------------------------------------------------
  // voice
  // -------------------------------------------------------------------------

  it("voice: native leg wires the mute commands and documents synthesis absence", async () => {
    const native = resolveCapabilities(true).voice;

    await withFakeTauri(
      async (cmd, args) => {
        expect(cmd).toBe("voice_set_mute");
        expect(args).toEqual({ muted: true });
        return { muted: true };
      },
      async () => {
        await native.setMuted(true);
      },
    );

    await withFakeTauri(
      async (cmd) => {
        expect(cmd).toBe("voice_mute_state");
        return { muted: false };
      },
      async () => {
        await expect(native.muteState()).resolves.toBe(false);
      },
    );

    await withFakeTauri(
      async () => ({ muted: "yes" }),
      async () => {
        await expect(native.muteState()).rejects.toThrow(/malformed mute state/);
      },
    );

    await expect(native.speak("hello")).rejects.toThrow(/documented typed absence/);
    expect(native.sampleRate).toBeNull();
    native.stop(); // safe no-op
  });

  it("voice: web leg needs bindVoice and speaks through createWebVoice", async () => {
    const web = resolveCapabilities(false).voice;
    await expect(web.speak("hello")).rejects.toThrow(/bindVoice/);

    const played: number[] = [];
    const events: unknown[] = [];
    const audio: WebVoiceAudio = {
      play: (pcm) => {
        played.push(pcm.length);
        return Promise.resolve();
      },
      stop: () => {},
    };
    const ort: OrtHandle = {
      createSession: () =>
        Promise.resolve({
          run: () =>
            Promise.resolve({
              waveform: { type: "float32", dims: [4], data: Float32Array.of(0.1, -0.1, 0.2, -0.2) },
            }),
        }),
    };
    const modelRef: KokoroModelRef = {
      source: "kokoro-v1.0.onnx",
      sampleRate: 24000,
      style: new Float32Array(256),
    };
    bindVoice({ ort, audio, modelRef, onEnvelope: (event) => events.push(event) });

    await web.speak("Hi there.");
    expect(played).toEqual([4]);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(CompanionEventSchema.safeParse(event).success).toBe(true);
    }
    await web.setMuted(true);
    await expect(web.muteState()).resolves.toBe(true);
    expect(web.sampleRate).toBe(24000);
    web.stop();
  });

  // -------------------------------------------------------------------------
  // keychain + opener
  // -------------------------------------------------------------------------

  it("keychain: native leg is a typed absence; web leg delegates to billing storage-web", async () => {
    const native = resolveCapabilities(true).keychain;
    await expect(native.save(TOKEN)).rejects.toThrow(/documented typed absence/);
    await expect(native.load()).rejects.toThrow(/documented typed absence/);
    await expect(native.clear()).rejects.toThrow(/documented typed absence/);

    // Delegation proof: the billing web storage is genuinely reached — its own
    // IndexedDB guard fires in this node env with the package's exact honest
    // error, not a capability-layer fabrication.
    const web = resolveCapabilities(false).keychain;
    await expect(web.load()).rejects.toThrow(/IndexedDB unavailable/);
    await expect(web.save(TOKEN)).rejects.toThrow(/IndexedDB unavailable/);
    await expect(web.clear()).rejects.toThrow(/IndexedDB unavailable/);
  });

  it("opener: native leg is a typed absence; web leg wraps window.open with noopener", async () => {
    const native = resolveCapabilities(true).opener;
    await expect(native.open("https://example.com")).rejects.toThrow(/documented typed absence/);

    const web = resolveCapabilities(false).opener;
    await expect(web.open("https://example.com")).rejects.toThrow(/browser window/);

    const holder = globalThis as { window?: unknown };
    const previous = holder.window;
    const opens: unknown[][] = [];
    holder.window = {
      open: (...callArgs: unknown[]) => {
        opens.push(callArgs);
        return null; // `noopener` makes null the spec-correct return
      },
    };
    try {
      await web.open("https://example.com/checkout");
      expect(opens).toEqual([["https://example.com/checkout", "_blank", "noopener,noreferrer"]]);
    } finally {
      holder.window = previous;
    }
  });

  // -------------------------------------------------------------------------
  // The integrator law grep (TR-9)
  // -------------------------------------------------------------------------

  it("the Tauri-global selection symbol appears in code ONLY in capabilities.ts (TR-9)", () => {
    const srcDir = fileURLToPath(new URL(".", import.meta.url));
    const capabilitiesFile = join(srcDir, "capabilities.ts");

    // Comments are prose, not selection: strip block comments and line
    // comments (the `[^:]` guard keeps `https://`-style strings intact) before
    // matching, so the ban targets code that selects on the symbol.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const scanned: string[] = [];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        scanned.push(full);
        if (full === capabilitiesFile) continue;
        if (stripComments(readFileSync(full, "utf8")).includes(NEEDLE)) offenders.push(full);
      }
    };
    walk(srcDir);

    // The walk itself must be real (this scanner file lives in src too), and
    // capabilities.ts must still carry the symbol — its one legal home.
    expect(scanned.length).toBeGreaterThan(5);
    expect(scanned).toContain(capabilitiesFile);
    expect(readFileSync(capabilitiesFile, "utf8").includes(NEEDLE)).toBe(true);
    expect(offenders).toEqual([]);
  });
});
