// natally — inference host: lane selection + turboquant parameter mapping
// (task C.1, ARCHITECTURE §7.1).
//
// Turboquant law (§7.1): atomic chat-turboquant = quantized weights (Q4_K_M
// default catalogue tier) AND KV-cache compression (q8_0 KV default; q4r8
// recursor tier when the device allows), streamed token by token. The params
// are mapped in exactly ONE place — `mapEngineParams` below — and handed to the
// injected engine factory identically on both lanes, so native and web can
// never drift.
//
// Engine plumbing is injected: this module owns the CONTRACT, not the model.
// `complete()` lazily builds a `StreamingEngine` through the injected factory
// (first `complete`, never before), forwards every streamed token to the
// caller's `onToken` AND publishes it as a `CompanionEvent` token through the
// injected `emit` fn (the bus wiring itself is I.3's). The underlying model
// cache lives BELOW the engine wrapper (the wllama handle / the native llama.cpp
// session in `src-tauri/src/inference/`), so building + disposing a wrapper per
// completion is cheap and never reloads weights.
//
// Fence seam (C.2): `FenceContext` does not exist yet — C.2 owns it. This file
// defines the LOCAL minimal structural input the inference API needs,
// `InferenceContext`; C.2's `FenceContext` maps onto it one-to-one at the call
// site (`turnId`, `systemPrompt`, `messages`, `maxTokens`). Never import from
// fence.ts here.

import type { CompanionEvent } from "@natally/lore/types";

/** Which runtime runs the weights (I.3 wires the `the Tauri runtime probe (I.3 capabilities)` detection; this
 * module takes the resolved boolean in `selectLane`). */
export type Lane = "native" | "web";

/** Chat role of one fence message. Tool results (§7.3) are collapsed into the
 * live turn by the fence before the call — the inference API only ever sees
 * user/assistant turns. */
export type ChatRole = "user" | "assistant";

export interface InferenceMessage {
  role: ChatRole;
  content: string;
}

/**
 * Local minimal structural input for one completion (the C.2 `FenceContext`
 * seam — see the file header). `turnId` is required because every streamed
 * token is published as a `CompanionEvent` token (`TokenEvent.turnId`,
 * `@natally/lore/types`); `maxTokens` is optional and defaults per engine
 * (256 on both lanes — the shared catalogue constant until C.2 fixes the
 * budget law).
 */
export interface InferenceContext {
  turnId: string;
  systemPrompt: string;
  messages: ReadonlyArray<InferenceMessage>;
  maxTokens?: number;
}

/**
 * Chat-turboquant tiers (§7.1). `weights` selects the catalogue artifact
 * (`modelRef` must point at the Q4_K_M quant from the frozen
 * `RobinsAIWorld/natally-models` mirror); `kv` is the default KV-cache
 * compression; `recursor` upgrades the KV tier to q4r8 when the device allows
 * it (optional flag).
 */
export interface TurboQuantParams {
  weights: "Q4_K_M";
  kv: "q8_0";
  recursor?: "q4r8";
}

/**
 * The exact parameter object handed to the injected engine factory. Identical
 * on both lanes (the `lane` field is the only deliberate difference — the
 * factory dispatches on it).
 */
export interface EngineParams {
  lane: Lane;
  modelRef: string;
  quant: TurboQuantParams;
  maxTokens?: number;
}

/** A streaming completion engine built by an `EngineFactory`. */
export interface StreamingEngine {
  complete(ctx: InferenceContext, onToken: (text: string) => void): Promise<void>;
  dispose(): void;
}

/** Builds the engine for one completion. Injected; never called before the
 * first `complete` (lazy load law). */
export type EngineFactory = (params: EngineParams) => StreamingEngine;

/** Publishes a `CompanionEvent` on the §4 bus. Injected; wiring is I.3's. */
export type EmitFn = (event: CompanionEvent) => void;

export interface CompleteOptions {
  lane: Lane;
  engineFactory: EngineFactory;
  /** M.1 storage path/URL of the turboquant artifact (lazy-loaded by the
   * engine on first use — never at injection time). */
  modelRef: string;
  quant: TurboQuantParams;
  /** Optional token-event publisher; when absent tokens still reach
   * `onToken` but ride no bus. */
  emit?: EmitFn;
}

/** Lane resolution from the injected capability flag (I.3 wires the real
 * `the Tauri runtime probe (I.3 capabilities)` detection; here it is a plain boolean). */
export function selectLane(nativeAvailable: boolean): Lane {
  return nativeAvailable ? "native" : "web";
}

/**
 * The effective KV-cache tier: the q4r8 recursor tier overrides the q8_0
 * default when set (§7.1). Single derivation point — both lane engines call
 * this, so the KV tier cannot diverge between native and web.
 */
export function kvCacheType(quant: TurboQuantParams): "q8_0" | "q4r8" {
  return quant.recursor ?? quant.kv;
}

/**
 * The single turboquant mapping point: builds the exact `EngineParams` handed
 * to the engine factory. Called by `complete` on every lane, so the recorded
 * params are byte-identical across lanes by construction (asserted in
 * `inference.test.ts`). `quant` is structurally copied, never aliased.
 */
export function mapEngineParams(
  lane: Lane,
  modelRef: string,
  quant: TurboQuantParams,
  maxTokens?: number,
): EngineParams {
  const mappedQuant: TurboQuantParams =
    quant.recursor === undefined
      ? { weights: quant.weights, kv: quant.kv }
      : { weights: quant.weights, kv: quant.kv, recursor: quant.recursor };
  return {
    lane,
    modelRef,
    quant: mappedQuant,
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

/**
 * Runs one streaming completion on the chosen lane: lazily builds the engine
 * through the injected factory (first call only — never before), forwards
 * each token to `onToken` and (when injected) publishes it as a
 * `CompanionEvent` token in stream order, then disposes the engine wrapper
 * (the model cache below it survives — see the file header).
 *
 * Throws (before any engine is built) when the context violates the
 * `CompanionEvent` contract (non-empty `turnId`, `systemPrompt`), so an
 * invalid request can never emit a malformed token event.
 */
export async function complete(
  ctx: InferenceContext,
  onToken: (text: string) => void,
  options: CompleteOptions,
): Promise<void> {
  if (ctx.turnId.trim() === "") {
    throw new Error("natally inference: turnId is required for CompanionEvent tokens");
  }
  if (ctx.systemPrompt.trim() === "") {
    throw new Error("natally inference: systemPrompt is required (the persona law, D13)");
  }
  if (ctx.messages.length === 0) {
    throw new Error(
      "natally inference: at least one message is required (the live turn, §7.2 tier 3)",
    );
  }

  const params = mapEngineParams(options.lane, options.modelRef, options.quant, ctx.maxTokens);
  const engine = options.engineFactory(params);
  const emit = options.emit;
  try {
    await engine.complete(ctx, (text) => {
      onToken(text);
      if (emit !== undefined) {
        emit({ type: "token", turnId: ctx.turnId, text });
      }
    });
  } finally {
    engine.dispose();
  }
}
