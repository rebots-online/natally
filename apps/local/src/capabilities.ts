// natally — I.3: the capability layer (ARCHITECTURE §3 normative law): ONE map
// `{ db, inference, voice, keychain, opener } → { native, web }`, ONE selection
// point. On the PWA leg every capability has a browser counterpart, selected
// here — never by `if (platform)` scattered through components.
//
// # Integrator law (this file, and ONLY this file)
//
// Selection is by the presence of the Tauri global (`window.__TAURI__`, set by
// the withGlobalTauri build of the shell — build config, not this file). The
// ONLY `__TAURI__` reference in repo `src/` lives HERE; `capabilities.test.ts`
// enforces the ban over the rest of `apps/local/src/**` (TR-9: selection by
// that symbol must not appear anywhere else, in code). `resolveCapabilities` is
// pure (takes the boolean; tests drive it); the runtime export `capabilities`
// resolves once at module load through `isTauriRuntime()` — the single probe.
//
// # The five pairs (each wired to a landed seam)
//
// - db      — native: `createNativeLoreStore` over the Tauri invoke shell
//             (`lore_upsert_turn`, `lore_query`, `lore_export`,
//             `lore_delete_all`, `lore_stats` in `src-tauri/src/lore_commands.rs`;
//             single `payload` arg). Web: `createWebLoreStore` over an injected
//             wa-sqlite handle — `bindDb(handle)` supplies it at wiring.
// - inference — native: a lane.ts `StreamingEngine` over `inference_complete` /
//             `inference_dispose` (single `payload` arg; Rust streams `token`
//             events on the §4 bus `companion:event`). Web:
//             `createWebEngineFactory` over an injected wllama handle —
//             `bindInference(handle)`. Token→onToken delivery on native needs
//             the bus subscription — `bindInferenceBus(subscribe)`; documented
//             default while unbound: `complete()` invokes and resolves, tokens
//             ride the Rust-emitted bus only (onToken stays silent).
// - voice   — native: the mute seam `voice_set_mute` / `voice_mute_state`
//             (named `muted` arg). Synthesis is a documented typed absence: the
//             Kokoro synth + playback compile only under the `voice-kokoro`
//             cargo feature (V.1 ruling) and no synthesis command exists in
//             this build. Web: `createWebVoice` — `bindVoice(options)` builds it
//             at wiring (ORT handle + audio sink + Kokoro model ref + envelope
//             sink are wiring-time dependencies).
// - keychain — native: documented typed absence — B.3's `native.rs` is a
//             comment-only design stub; the OS-keychain commands are neither
//             compiled nor registered (§9.3). Web: `packages/billing`
//             `storage-web` (save/load/clearLicenseToken, IndexedDB + AES-GCM).
// - opener  — native: documented typed absence — no shell/open plugin is
//             compiled into this build. Web: a `window.open` wrapper.
//
// Every native command error surfaces as a rejected promise with the Rust
// side's message (house pattern: Rust reports, TS holds the schema law). Where
// a leg needs a wiring-time handle that this module cannot construct, the bind
// fn records it and unbound use rejects (or throws, for the sync factory) with
// a message naming the bind fn — honest absence, never a silent fallback.

import type { LicenseToken } from "@natally/billing";
import {
  clearLicenseToken,
  loadLicenseToken,
  saveLicenseToken,
} from "@natally/billing/token/storage-web";
import type { LoreStore } from "@natally/lore/store";
import { createNativeLoreStore } from "@natally/lore/store/native";
import {
  createWebLoreStore,
  type WaSqlite3Like,
  type WebLoreStoreOptions,
} from "@natally/lore/store/web";
import { createWebEngineFactory, type WllamaHandle } from "./companion/inference-web";
import type {
  EngineFactory,
  EngineParams,
  InferenceContext,
  StreamingEngine,
} from "./companion/lane";
import { createWebVoice, type WebVoice, type WebVoiceOptions } from "./voice/web";

// ---------------------------------------------------------------------------
// The single selection point
// ---------------------------------------------------------------------------

/** Which leg a resolved capability implements. */
export type Leg = "native" | "web";

/**
 * The one runtime probe. TRUE only when the Tauri global is present — i.e.
 * inside the withGlobalTauri build of the native shell. Everywhere else
 * (browser, PWA, node tests) this is FALSE and the web legs resolve.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/** Structural view of the withGlobalTauri surface the native legs consume. */
interface TauriGlobal {
  readonly core?: {
    invoke(cmd: string, args?: unknown): Promise<unknown>;
  };
}

/**
 * The raw invoke shell over the Tauri global. Lazy: the global is read per
 * call, so a late-injected shell works and an absent one rejects honestly.
 * Callers pass Tauri ARGS (the object whose keys name the command's
 * parameters — `payload` for the lore/inference commands, `muted` for the
 * voice mute commands).
 */
function tauriInvoke(cmd: string, args: unknown): Promise<unknown> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error(
        "natally capabilities: no native invoke shell — there is no window in this runtime",
      ),
    );
  }
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (invoke === undefined) {
    return Promise.reject(
      new Error(
        "natally capabilities: no native invoke shell — the __TAURI__ global (withGlobalTauri) is missing in this runtime",
      ),
    );
  }
  return invoke(cmd, args);
}

// ---------------------------------------------------------------------------
// db — §8 LoreStore (native invoke shell / web wa-sqlite)
// ---------------------------------------------------------------------------

export interface DbCapability {
  readonly leg: Leg;
  /**
   * The §8.4 `LoreStore` for this leg. Memoized after first success; a failed
   * open is never memoized (the next call retries). Native: the invoke shell
   * over `lore_commands.rs`, constructed without an embedder — `query()` throws
   * the shell's honest "no embedder configured" until the M-phase lore pipeline
   * supplies one. Web: needs `bindDb` first.
   */
  loreStore(): Promise<LoreStore>;
}

let boundDb:
  | { readonly sqlite3: WaSqlite3Like; readonly options: Omit<WebLoreStoreOptions, "sqlite3"> }
  | undefined;
let webStorePromise: Promise<LoreStore> | undefined;

/**
 * Wiring-time binding for the web db leg: the already-initialized wa-sqlite
 * module handle (plus optional vec extension / embedder / path — anything
 * `createWebLoreStore` accepts besides the handle). Rebinding discards any
 * memoized store.
 */
export function bindDb(
  sqlite3: WaSqlite3Like,
  options: Omit<WebLoreStoreOptions, "sqlite3"> = {},
): void {
  boundDb = { sqlite3, options };
  webStorePromise = undefined;
}

function nativeDb(): DbCapability {
  let store: LoreStore | undefined;
  return {
    leg: "native",
    loreStore() {
      // The shell hands each command its payload object; the Tauri command
      // parameter is named `payload`, so the args wrap it once, here.
      store ??= createNativeLoreStore((cmd, payload) => tauriInvoke(cmd, { payload }));
      return Promise.resolve(store);
    },
  };
}

function webDb(): DbCapability {
  return {
    leg: "web",
    loreStore() {
      const bound = boundDb;
      if (bound === undefined) {
        return Promise.reject(
          new Error(
            "natally capabilities: the web db leg is unbound — call bindDb(waSqlite3, options) at wiring (§8.1) before loreStore()",
          ),
        );
      }
      webStorePromise ??= createWebLoreStore({ ...bound.options, sqlite3: bound.sqlite3 });
      const opened = webStorePromise;
      // Never memoize a rejection: a failed open stays retryable.
      void opened.catch(() => {
        if (webStorePromise === opened) webStorePromise = undefined;
      });
      return opened;
    },
  };
}

// ---------------------------------------------------------------------------
// inference — §7.1 turboquant lane (native invoke / web wllama)
// ---------------------------------------------------------------------------

/**
 * Subscribes to the §4 companion bus (`companion:event`); returns the
 * unsubscribe fn. Wiring-time: the natural implementation wraps the Tauri
 * event API. Events arrive untyped and are filtered structurally.
 */
export type BusSubscribe = (onEvent: (event: unknown) => void) => () => void;

export interface InferenceCapability {
  readonly leg: Leg;
  /**
   * The lane.ts `EngineFactory` for this leg (engines build per completion;
   * the model loads lazily on first use on both lanes). Web: needs
   * `bindInference` first (throws, being sync).
   */
  engineFactory(): EngineFactory;
  /**
   * Free the resident turboquant model. Native: `inference_dispose`. Web: a
   * no-op — the wllama handle owns the model cache and survives completions;
   * its teardown is the wiring's (`WllamaHandle.exit`), not the wrapper's.
   */
  dispose(): Promise<void>;
}

let boundWllama: WllamaHandle | undefined;
let boundBusSubscribe: BusSubscribe | undefined;

/** Wiring-time binding for the web inference leg: the wllama handle. */
export function bindInference(handle: WllamaHandle): void {
  boundWllama = handle;
}

/**
 * Wiring-time binding for native token streaming: subscribe to the §4 bus so
 * the native engine can forward `token` events to the caller's `onToken`.
 * Passing `undefined` restores the documented default (unbound: tokens ride
 * the Rust-emitted bus only, `onToken` stays silent).
 */
export function bindInferenceBus(subscribe: BusSubscribe | undefined): void {
  boundBusSubscribe = subscribe;
}

/** The camelCase mirror of `InferencePayload` in `src-tauri/src/inference/mod.rs`. */
function nativeInferencePayload(
  ctx: InferenceContext,
  params: EngineParams,
): Record<string, unknown> {
  return {
    turnId: ctx.turnId,
    systemPrompt: ctx.systemPrompt,
    messages: ctx.messages.map((message) => ({ role: message.role, content: message.content })),
    ...(ctx.maxTokens === undefined ? {} : { maxTokens: ctx.maxTokens }),
    modelRef: params.modelRef,
    quant: params.quant,
  };
}

/** A bus `token` event (`{ type, turnId, text }`) for this turn, else null. */
function tokenTextOf(event: unknown, turnId: string): string | null {
  if (typeof event !== "object" || event === null) return null;
  const candidate = event as { type?: unknown; turnId?: unknown; text?: unknown };
  if (candidate.type !== "token") return null;
  if (candidate.turnId !== turnId) return null;
  return typeof candidate.text === "string" ? candidate.text : null;
}

/** Native lane engine: one `inference_complete` invoke, optionally bridging
 * §4-bus `token` events to `onToken` in arrival order. */
class NativeInvokeEngine implements StreamingEngine {
  constructor(private readonly params: EngineParams) {}

  async complete(ctx: InferenceContext, onToken: (text: string) => void): Promise<void> {
    const subscribe = boundBusSubscribe;
    const unsubscribe = subscribe?.((event: unknown) => {
      const text = tokenTextOf(event, ctx.turnId);
      if (text !== null) onToken(text);
    });
    try {
      await tauriInvoke("inference_complete", {
        payload: nativeInferencePayload(ctx, this.params),
      });
    } finally {
      unsubscribe?.();
    }
  }

  dispose(): void {}
}

function nativeInference(): InferenceCapability {
  return {
    leg: "native",
    engineFactory: () => (params: EngineParams) => new NativeInvokeEngine(params),
    dispose: () => tauriInvoke("inference_dispose", {}).then(() => undefined),
  };
}

function webInference(): InferenceCapability {
  return {
    leg: "web",
    engineFactory() {
      if (boundWllama === undefined) {
        throw new Error(
          "natally capabilities: the web inference leg is unbound — call bindInference(wllamaHandle) at wiring (§7.1) before engineFactory()",
        );
      }
      return createWebEngineFactory(boundWllama);
    },
    dispose: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// voice — §10 (native mute seam, synthesis absent / web createWebVoice)
// ---------------------------------------------------------------------------

export interface VoiceCapability {
  readonly leg: Leg;
  setMuted(muted: boolean): Promise<void>;
  muteState(): Promise<boolean>;
  /** Enqueue `text` for speech. Native leg: documented typed absence. */
  speak(text: string): Promise<void>;
  /** Abort playback and drop the queue now. Unbound/absent: a safe no-op. */
  stop(): void;
  /** Synthesis sample rate; `null` where synthesis is absent or unbound. */
  readonly sampleRate: number | null;
}

/** Validates the `MuteStateDto` wire response of the voice mute commands. */
function muteStateOf(raw: unknown, cmd: string): boolean {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`natally capabilities: ${cmd} returned a non-object response`);
  }
  const muted = (raw as { muted?: unknown }).muted;
  if (typeof muted !== "boolean") {
    throw new Error(`natally capabilities: ${cmd} returned a malformed mute state`);
  }
  return muted;
}

function nativeVoice(): VoiceCapability {
  return {
    leg: "native",
    async setMuted(muted) {
      muteStateOf(await tauriInvoke("voice_set_mute", { muted }), "voice_set_mute");
    },
    async muteState() {
      return muteStateOf(await tauriInvoke("voice_mute_state", {}), "voice_mute_state");
    },
    speak() {
      return Promise.reject(
        new Error(
          "natally capabilities: the native voice synthesis leg is a documented typed absence — Kokoro synth + playback compile only under the voice-kokoro cargo feature (V.1 ruling); only voice_set_mute/voice_mute_state exist in this build",
        ),
      );
    },
    stop() {},
    sampleRate: null,
  };
}

let boundWebVoice: WebVoice | undefined;

/**
 * Wiring-time binding for the web voice leg: builds the `WebVoice` from the
 * injected ORT handle, audio sink, Kokoro model ref and envelope sink. The
 * ONNX session itself still lazy-loads on the first spoken chunk.
 */
export function bindVoice(options: WebVoiceOptions): void {
  boundWebVoice = createWebVoice(options);
}

function webVoice(): VoiceCapability {
  return {
    leg: "web",
    setMuted(muted) {
      if (boundWebVoice === undefined) {
        return Promise.reject(
          new Error(
            "natally capabilities: the web voice leg is unbound — call bindVoice(options) at wiring (§10)",
          ),
        );
      }
      boundWebVoice.setMuted(muted);
      return Promise.resolve();
    },
    async muteState() {
      if (boundWebVoice === undefined) {
        throw new Error(
          "natally capabilities: the web voice leg is unbound — call bindVoice(options) at wiring (§10)",
        );
      }
      return boundWebVoice.isMuted();
    },
    speak(text) {
      if (boundWebVoice === undefined) {
        return Promise.reject(
          new Error(
            "natally capabilities: the web voice leg is unbound — call bindVoice(options) at wiring (§10)",
          ),
        );
      }
      return boundWebVoice.speak(text);
    },
    stop() {
      boundWebVoice?.stop();
    },
    get sampleRate() {
      return boundWebVoice === undefined ? null : boundWebVoice.sampleRate;
    },
  };
}

// ---------------------------------------------------------------------------
// keychain — §9.3 license token (native typed absence / web IndexedDB envelope)
// ---------------------------------------------------------------------------

export interface KeychainCapability {
  readonly leg: Leg;
  /** Encrypt-and-persist (web) / store (native, when the leg lands). */
  save(token: LicenseToken): Promise<void>;
  /** `null` = nothing stored or undecryptable — honest absence (§9.3). */
  load(): Promise<LicenseToken | null>;
  /** Remove token AND wrap key: a fresh install state (§9.3). */
  clear(): Promise<void>;
}

function nativeKeychain(): KeychainCapability {
  const absence = new Error(
    "natally capabilities: the native keychain leg is a documented typed absence — the OS-keychain commands (packages/billing/src/token/native.rs design) are not compiled/registered in this build (§9.3)",
  );
  return {
    leg: "native",
    save: () => Promise.reject(absence),
    load: () => Promise.reject(absence),
    clear: () => Promise.reject(absence),
  };
}

function webKeychain(): KeychainCapability {
  return {
    leg: "web",
    save: (token) => saveLicenseToken(token),
    load: () => loadLicenseToken(),
    clear: () => clearLicenseToken(),
  };
}

// ---------------------------------------------------------------------------
// opener — external URLs (native typed absence / web window.open)
// ---------------------------------------------------------------------------

export interface OpenerCapability {
  readonly leg: Leg;
  /** Open an external URL (checkout, docs). Never navigates the app window. */
  open(url: string): Promise<void>;
}

function nativeOpener(): OpenerCapability {
  return {
    leg: "native",
    open: () =>
      Promise.reject(
        new Error(
          "natally capabilities: the native opener leg is a documented typed absence — no shell/open plugin is compiled into this build",
        ),
      ),
  };
}

function webOpener(): OpenerCapability {
  return {
    leg: "web",
    open(url) {
      if (typeof window === "undefined") {
        return Promise.reject(
          new Error(
            "natally capabilities: the web opener leg needs a browser window (none in this runtime)",
          ),
        );
      }
      // `noopener` means the return value is null per spec — a null here is
      // NOT "blocked", so it is not treated as an error.
      window.open(url, "_blank", "noopener,noreferrer");
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// The map — resolution + the frozen runtime export
// ---------------------------------------------------------------------------

/** The five-capability map (one resolved leg per capability). */
export interface CapabilityMap {
  readonly db: DbCapability;
  readonly inference: InferenceCapability;
  readonly voice: VoiceCapability;
  readonly keychain: KeychainCapability;
  readonly opener: OpenerCapability;
}

/** Recursively freezes a plain object graph (functions are left as-is). */
function deepFreeze<T>(root: T): T {
  const freeze = (value: unknown): void => {
    if (typeof value === "object" && value !== null) {
      for (const key of Object.keys(value)) {
        freeze((value as Record<string, unknown>)[key]);
      }
      Object.freeze(value);
    }
  };
  freeze(root);
  return root;
}

/**
 * Pure resolution: `isTauri` TRUE picks every native leg, FALSE every web leg.
 * No global is read — tests drive both sides; the runtime export below feeds
 * the single probe.
 */
export function resolveCapabilities(isTauri: boolean): CapabilityMap {
  return deepFreeze({
    db: isTauri ? nativeDb() : webDb(),
    inference: isTauri ? nativeInference() : webInference(),
    voice: isTauri ? nativeVoice() : webVoice(),
    keychain: isTauri ? nativeKeychain() : webKeychain(),
    opener: isTauri ? nativeOpener() : webOpener(),
  });
}

/** The frozen runtime resolution — resolved ONCE, here, through the one probe. */
export const capabilities: CapabilityMap = resolveCapabilities(isTauriRuntime());
