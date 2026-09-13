import type { CompanionEvent } from "../../../../packages/lore/src/types.js";

export type { CompanionEvent } from "../../../../packages/lore/src/types.js";

export type StageCapabilitySignal =
  | { type: "engine-load"; fraction: number }
  | { type: "model-presence"; present: boolean }
  | { type: "composer-focus"; focused: boolean };

export type StageSignal = CompanionEvent | StageCapabilitySignal;

// LIBS/UI/FIGMA/mascot/STATES.md defines all eight states. The ledger's five
// Stage variant IDs are a subset, not permission to drop the composed states.
export type StageState =
  | "Idle"
  | "Asleep"
  | "Waking"
  | "Listening"
  | "Thinking"
  | "Speaking"
  | "Delighted"
  | "Error";

export type StageSnapshot = Readonly<{
  state: StageState;
  modelPresent: boolean | null;
  engineLoad: number | null;
  composerFocused: boolean;
  awaitingToken: boolean;
  envelopeActive: boolean;
  envelopeLevel: number;
  error: string | null;
}>;

// Neutral until capabilities arrive; null does not assert an installed model.
export const INITIAL_STAGE_STATE: StageSnapshot = Object.freeze({
  state: "Idle",
  modelPresent: null,
  engineLoad: null,
  composerFocused: false,
  awaitingToken: false,
  envelopeActive: false,
  envelopeLevel: 0,
  error: null,
});

function assertFraction(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Stage fractions must be finite numbers in [0, 1]");
  }
}

function isUnavailable(snapshot: StageSnapshot): boolean {
  return (
    snapshot.error !== null ||
    snapshot.modelPresent === false ||
    (snapshot.engineLoad !== null && snapshot.engineLoad < 1)
  );
}

function selectState(snapshot: StageSnapshot, delighted: boolean): StageState {
  if (snapshot.error !== null) return "Error";
  if (snapshot.engineLoad !== null && snapshot.engineLoad < 1) return "Waking";
  if (snapshot.modelPresent === false) return "Asleep";
  if (snapshot.envelopeActive) return "Speaking";
  if (delighted) return "Delighted";
  if (snapshot.awaitingToken) return "Thinking";
  return snapshot.composerFocused ? "Listening" : "Idle";
}

/**
 * Pure, replayable reduction for U.9. A submitted `turn` with role `you` is
 * request-sent in the existing CompanionEvent vocabulary; tokens never imply
 * audio playback. The audio producer supplies 20 ms envelope windows and emits
 * envelope-end on stream close or 120 ms of measured silence. No bus timer
 * guesses playback, silence, a completed animation, or a missing capability.
 *
 * Unlock has no discriminator in the approved closed StageSignal set. Its
 * integration needs a parent-owned contract decision, not a fabricated chart.
 */
export function stageReducer(previous: StageSnapshot, signal: StageSignal): StageSnapshot {
  const next = { ...previous };

  switch (signal.type) {
    case "engine-load":
      assertFraction(signal.fraction);
      next.engineLoad = signal.fraction;
      next.error = null;
      if (signal.fraction === 1) next.modelPresent = true;
      else {
        next.awaitingToken = false;
        next.envelopeActive = false;
        next.envelopeLevel = 0;
      }
      break;
    case "model-presence":
      next.modelPresent = signal.present;
      if (!signal.present) {
        next.engineLoad = null;
        next.awaitingToken = false;
        next.envelopeActive = false;
        next.envelopeLevel = 0;
        next.error = null;
      }
      break;
    case "composer-focus":
      next.composerFocused = signal.focused;
      break;
    case "turn":
      if (!isUnavailable(next)) {
        if (signal.turn.role === "you") next.awaitingToken = true;
        else if (signal.turn.role === "her") next.awaitingToken = false;
      }
      break;
    case "token":
      next.awaitingToken = false;
      break;
    case "envelope-start":
      if (!isUnavailable(next) && !next.envelopeActive) {
        next.envelopeActive = true;
        next.envelopeLevel = 0;
        next.awaitingToken = false;
      }
      break;
    case "envelope-level":
      assertFraction(signal.level);
      if (next.envelopeActive) next.envelopeLevel = signal.level;
      break;
    case "envelope-end":
      next.envelopeActive = false;
      next.envelopeLevel = 0;
      break;
    case "chart-computed":
      break;
    case "error":
      next.error = signal.message;
      next.awaitingToken = false;
      next.envelopeActive = false;
      next.envelopeLevel = 0;
      break;
    default: {
      const unreachable: never = signal;
      throw new TypeError(`Unknown StageSignal: ${String(unreachable)}`);
    }
  }

  next.state = selectState(next, signal.type === "chart-computed");
  return Object.freeze(next);
}

export type Unsubscribe = () => void;
type EventType = CompanionEvent["type"];
type EventOf<Type extends EventType> = Extract<CompanionEvent, { type: Type }>;

export interface StageStateStream {
  /** Replays the latest state synchronously, then emits state changes only. */
  subscribe(listener: (state: StageState) => void): Unsubscribe;
  getSnapshot(): StageState;
}

export interface CompanionBus {
  subscribe<Type extends EventType>(
    type: Type,
    listener: (event: EventOf<Type>) => void,
  ): Unsubscribe;
  emit(event: CompanionEvent): void;
  /** Capability observations affect the Stage without becoming bus events. */
  signal(signal: StageCapabilitySignal): void;
  getSnapshot(): StageSnapshot;
  readonly stageState$: StageStateStream;
}

function isEventType<Type extends EventType>(
  event: CompanionEvent,
  type: Type,
): event is EventOf<Type> {
  return event.type === type;
}

function isCompanionEvent(signal: StageSignal): signal is CompanionEvent {
  return (
    signal.type !== "engine-load" &&
    signal.type !== "model-presence" &&
    signal.type !== "composer-focus"
  );
}

/** Independent instances let tests and disposed sessions avoid global listeners. */
export function createCompanionBus(): CompanionBus {
  let snapshot = INITIAL_STAGE_STATE;
  const eventListeners = new Set<(event: CompanionEvent) => void>();
  const stateListeners = new Set<(state: StageState) => void>();
  const pending: StageSignal[] = [];
  let dispatching = false;

  function dispatch(signal: StageSignal): void {
    pending.push(signal);
    if (dispatching) return;
    dispatching = true;
    const failures: unknown[] = [];

    function notify<Value>(listeners: Set<(value: Value) => void>, value: Value): void {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try {
          listener(value);
        } catch (error) {
          failures.push(error);
        }
      }
    }

    try {
      // Queue nested emissions so every listener observes the same event order.
      for (const current of pending) {
        const previousState = snapshot.state;
        try {
          snapshot = stageReducer(snapshot, current);
        } catch (error) {
          failures.push(error);
          continue;
        }
        if (snapshot.state !== previousState) notify(stateListeners, snapshot.state);
        if (isCompanionEvent(current)) notify(eventListeners, current);
      }
    } finally {
      pending.length = 0;
      dispatching = false;
    }

    // One failed observer must not suppress delivery to the other observers.
    if (failures.length > 0) throw new AggregateError(failures, "Companion bus dispatch failed");
  }

  return {
    subscribe(type, listener) {
      const subscription = (event: CompanionEvent) => {
        if (isEventType(event, type)) listener(event);
      };
      eventListeners.add(subscription);
      return () => {
        eventListeners.delete(subscription);
      };
    },
    emit: dispatch,
    signal: dispatch,
    getSnapshot: () => snapshot,
    stageState$: {
      getSnapshot: () => snapshot.state,
      subscribe(listener) {
        const subscription = (state: StageState) => listener(state);
        stateListeners.add(subscription);
        try {
          subscription(snapshot.state);
        } catch (error) {
          stateListeners.delete(subscription);
          throw error;
        }
        return () => {
          stateListeners.delete(subscription);
        };
      },
    },
  };
}

export const companionBus = createCompanionBus();
export const { subscribe, emit, signal, stageState$ } = companionBus;
