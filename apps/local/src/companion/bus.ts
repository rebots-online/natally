// natally — C.4: the companion event bus (ARCHITECTURE §4: `companion:event →
// stage(mascot) + transcript + voice`). Typed pub/sub over the lore
// CompanionEvent union (packages/lore, discriminated on `type`) plus the
// documented bus-level extensions this module owns:
//
//  - `{ type: "model-load", phase: "asleep" | "waking" | "ready", progress? }`
//    — the M.1 model-load channel. STATES.md: asleep = no model downloaded,
//    waking = engine or model loading (real progress fraction), ready = engine
//    idle. U.9 binds this extension.
//  - `{ type: "unlock" }` — license unlock success from the licensing seam
//    (§9/§10: Delighted on chart computed / unlock success).
//  - `{ type: "stage-idle" }` — explicit return-to-idle control event; also how
//    the bus host translates the delighted `until` marker (see reduceStage).
//
// Stage mapping follows LIBS/UI/FIGMA/mascot/STATES.md (normative) for the
// subset this bus can emit: first token ⇒ thinking; envelope rms > 0 ⇒
// speaking; envelope end (rms 0 sustained) ⇒ idle; chart-computed or unlock ⇒
// delighted; error ⇒ error; model-load asleep/waking/ready ⇒ asleep/waking/
// idle. A `turn` event (and therefore a turn start with no token yet) does NOT
// move the Stage — the transcript turn is recorded material; only streamed
// tokens and the voice envelope drive Thinking/Speaking. States NOT derivable
// here: `listening` (composer focus is a UI-composer event, not a bus event) —
// the Stage host may enter it directly; this module never emits it.
//
// Purity contract: `reduceStage` is pure and exported for U.9 — it never reads
// a clock or mutates its inputs. Delight is a state carrying a `delightUntil`
// marker; the bus host (createCompanionBus) injects the clock and translates
// the marker into a delayed explicit `stage-idle` event. When an event does not
// change the stage the reducer returns the SAME reference, which the host uses
// as change detection for stageState$ notifications. Returned states are
// frozen; treat them as immutable.
//
// Delivery contract: `publish` reduces the stage first, then notifies typed
// subscribers for the event's `type`, then `subscribeAll` subscribers, each in
// insertion order. A throwing subscriber is isolated so one consumer cannot
// break the transcript/voice pipeline (deliberately not logged — house rule
// bans console in src). Event subscriptions are live-only: no event history is
// replayed; ONLY the derived stageState$ is replay-buffered (a new stage
// subscriber receives the current state immediately, per stage-subscription
// replay buffer).

import type { CompanionEvent } from "@natally/lore/types";

// ---------------------------------------------------------------------------
// Bus event union (CompanionEvent + documented extensions)
// ---------------------------------------------------------------------------

/** M.1 model-load channel (STATES.md asleep/waking/ready; U.9 binds this). */
export interface ModelLoadEvent {
  readonly type: "model-load";
  readonly phase: "asleep" | "waking" | "ready";
  /** Waking progress fraction 0–1 (STATES.md: orb brightness follows it). */
  readonly progress?: number;
}

/** License unlock success from the licensing seam (§9; §10 Delighted). */
export interface UnlockEvent {
  readonly type: "unlock";
}

/** Explicit return-to-idle control event (also the host's delight translation). */
export interface StageIdleEvent {
  readonly type: "stage-idle";
}

/** Everything the companion bus carries: the lore union + extensions above. */
export type BusEvent = CompanionEvent | ModelLoadEvent | UnlockEvent | StageIdleEvent;

export type BusEventType = BusEvent["type"];

// ---------------------------------------------------------------------------
// Stage state (STATES.md subset this bus can emit) and the pure reducer
// ---------------------------------------------------------------------------

export type StageName =
  | "idle"
  | "asleep"
  | "waking"
  | "thinking"
  | "speaking"
  | "delighted"
  | "error";

export interface StageState {
  readonly stage: StageName;
  /** Epoch ms after which the bus host returns the Stage to idle; delighted only. */
  readonly delightUntil?: number;
  /** Waking progress fraction 0–1; waking only. */
  readonly progress?: number;
  /** The failing event's message; error only. */
  readonly detail?: string;
  /** Reducer-internal: consecutive silent (rms 0) envelope frames while speaking. */
  readonly quietFrames?: number;
}

/** STATES.md delighted one-shot is 600 ms (scale 1.0 → 1.04 → 1.0 + gilt ring). */
export const DELIGHT_MS = 600;

/** Consecutive silent (rms 0) envelope frames that count as envelope end. */
export const QUIET_FRAMES_TO_IDLE = 3;

export const INITIAL_STAGE_STATE: StageState = Object.freeze({ stage: "idle" });

export interface ReduceOptions {
  /** Injected clock (epoch ms). Defaults to 0 — pure reducer calls stay deterministic. */
  readonly now?: number;
  /** Delight duration in ms; the host injects `Date.now()`-based values. Default DELIGHT_MS. */
  readonly delightMs?: number;
  /** Silent envelope frames that end speaking. Default QUIET_FRAMES_TO_IDLE. */
  readonly quietFrames?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Pure event→stage reducer (STATES.md law, documented subset). Returns the SAME
 * reference when the event does not change the stage; otherwise a new frozen
 * state. `now` / `delightMs` are injected so the delight `delightUntil` marker
 * is computed without reading any clock here — the bus host translates the
 * marker into a delayed explicit `stage-idle` event.
 */
export function reduceStage(
  state: StageState,
  event: BusEvent,
  options: ReduceOptions = {},
): StageState {
  switch (event.type) {
    case "token":
      // First token ⇒ Thinking (§10). Further tokens while already Thinking
      // change nothing (same reference); a late token while audio plays must
      // not regress the Stage out of Speaking — the RMS envelope is the
      // stronger real signal for "speaking".
      return state.stage === "speaking" || state.stage === "thinking"
        ? state
        : Object.freeze({ stage: "thinking" });
    case "turn":
      // Transcript material only; a turn (and a turn start with no token yet)
      // keeps the previous state (documented above).
      return state;
    case "envelope": {
      if (event.rms > 0) {
        return Object.freeze({ stage: "speaking" });
      }
      if (state.stage !== "speaking") {
        return state; // a stray silent frame outside playback moves nothing
      }
      const streak = (state.quietFrames ?? 0) + 1;
      if (streak >= (options.quietFrames ?? QUIET_FRAMES_TO_IDLE)) {
        return Object.freeze({ stage: "idle" }); // envelope end: rms 0 sustained
      }
      return Object.freeze({ ...state, quietFrames: streak });
    }
    case "chart-computed":
    case "unlock":
      // Delighted is a state with an `until` marker; the host schedules the
      // return to idle (pure reducer — no timers here).
      return Object.freeze({
        stage: "delighted",
        delightUntil: (options.now ?? 0) + (options.delightMs ?? DELIGHT_MS),
      });
    case "error":
      return Object.freeze({ stage: "error", detail: event.message });
    case "model-load":
      switch (event.phase) {
        case "asleep":
          return Object.freeze({ stage: "asleep" });
        case "waking":
          return Object.freeze({
            stage: "waking",
            ...(event.progress === undefined ? {} : { progress: clamp01(event.progress) }),
          });
        case "ready":
          return Object.freeze({ stage: "idle" });
      }
      return state;
    case "stage-idle":
      return Object.freeze({ stage: "idle" });
  }
}

// ---------------------------------------------------------------------------
// The bus
// ---------------------------------------------------------------------------

export interface StageObservable {
  /** Receives the current state immediately (replay), then every change. */
  subscribe(fn: (state: StageState) => void): () => void;
  current(): StageState;
}

export interface CompanionBus {
  /** Reduces the event into the stage, then delivers it to subscribers. */
  publish(event: BusEvent): void;
  /** Typed subscription: `fn` receives only events of `type`. Returns the unsubscribe handle. */
  subscribe<K extends BusEventType>(
    type: K,
    fn: (event: Extract<BusEvent, { type: K }>) => void,
  ): () => void;
  /** Receives every event. Returns the unsubscribe handle. */
  subscribeAll(fn: (event: BusEvent) => void): () => void;
  /** Replay-buffered derived stage state (one new subscriber ⇒ current state immediately). */
  readonly stageState$: StageObservable;
}

export interface CompanionBusOptions {
  /** Delight duration in ms; default DELIGHT_MS. */
  readonly delightMs?: number;
  /** Silent envelope frames that end speaking; default QUIET_FRAMES_TO_IDLE. */
  readonly quietFrames?: number;
  /** Clock injection for tests; default Date.now. */
  readonly now?: () => number;
}

type AnyHandler = (event: BusEvent) => void;

function deliver(handlers: Iterable<AnyHandler>, event: BusEvent): void {
  for (const fn of handlers) {
    try {
      fn(event);
    } catch {
      // Subscriber isolation: one broken consumer must not break the
      // transcript/voice pipeline (deliberately silent — no console in src).
    }
  }
}

export function createCompanionBus(options: CompanionBusOptions = {}): CompanionBus {
  const delightMs = options.delightMs ?? DELIGHT_MS;
  const quietFrames = options.quietFrames ?? QUIET_FRAMES_TO_IDLE;
  const now = options.now ?? Date.now;

  const typed = new Map<BusEventType, Set<AnyHandler>>();
  const all = new Set<AnyHandler>();

  let stage = INITIAL_STAGE_STATE;
  const stageSubs = new Set<(state: StageState) => void>();
  let delightTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelDelightTimer(): void {
    if (delightTimer !== undefined) {
      clearTimeout(delightTimer);
      delightTimer = undefined;
    }
  }

  function stageChanged(next: StageState): void {
    if (next === stage) {
      return; // reducer returned the same reference: nothing changed
    }
    stage = next;
    for (const fn of stageSubs) {
      try {
        fn(stage);
      } catch {
        // Same isolation policy as event delivery.
      }
    }
    // Delight translation: schedule the explicit idle event at the marker,
    // re-arming from scratch whenever the state moves.
    cancelDelightTimer();
    if (stage.stage === "delighted" && stage.delightUntil !== undefined) {
      const until = stage.delightUntil;
      delightTimer = setTimeout(
        () => {
          delightTimer = undefined;
          if (stage.stage === "delighted" && stage.delightUntil === until) {
            publish({ type: "stage-idle" });
          }
        },
        Math.max(0, until - now()),
      );
    }
  }

  function publish(event: BusEvent): void {
    stageChanged(reduceStage(stage, event, { now: now(), delightMs, quietFrames }));
    const handlers = typed.get(event.type);
    if (handlers !== undefined) {
      deliver(handlers, event);
    }
    deliver(all, event);
  }

  return {
    publish,
    subscribe(type, fn) {
      let handlers = typed.get(type);
      if (handlers === undefined) {
        handlers = new Set<AnyHandler>();
        typed.set(type, handlers);
      }
      // Sound: this set only ever receives events whose `type` matches.
      const handler = fn as AnyHandler;
      handlers.add(handler);
      let active = true;
      return () => {
        if (!active) {
          return; // idempotent unsubscribe
        }
        active = false;
        handlers?.delete(handler);
        if (handlers?.size === 0) {
          typed.delete(type);
        }
      };
    },
    subscribeAll(fn) {
      all.add(fn);
      return () => {
        all.delete(fn);
      };
    },
    stageState$: {
      subscribe(fn) {
        stageSubs.add(fn);
        try {
          fn(stage); // replay buffer: current state on subscribe
        } catch {
          // Same isolation policy as event delivery.
        }
        return () => {
          stageSubs.delete(fn);
        };
      },
      current: () => stage,
    },
  };
}
