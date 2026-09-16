// natally — C.4 verify.
// Accept: `bus: event→stage reducer sequence Thinking→Speaking→Idle exact`.
//
// The headline describe asserts the pure reducer sequence stepwise (token→
// thinking, envelope→speaking, envelope-end→idle, chart-computed→delighted,
// idle→idle). The remaining describes cover the bus contract: per-type
// filtering, unsubscribe, subscribeAll, the replay-buffered stageState$, the
// delight `until` → stage-idle translation performed by the bus host, and the
// documented model-load channel extension (U.9 binds it).

import { describe, expect, test, vi } from "vitest";
import {
  createCompanionBus,
  DELIGHT_MS,
  INITIAL_STAGE_STATE,
  QUIET_FRAMES_TO_IDLE,
  reduceStage,
  type StageName,
  type StageState,
} from "./bus";

// ---------------------------------------------------------------------------
// Accept-line sequence (pure reducer, stepwise)
// ---------------------------------------------------------------------------

describe("bus: event→stage reducer sequence Thinking→Speaking→Idle exact", () => {
  test("token→thinking, envelope→speaking, envelope-end→idle, chart-computed→delighted, idle→idle", () => {
    let state: StageState = INITIAL_STAGE_STATE;

    state = reduceStage(state, { type: "token", turnId: "t1", text: "He" });
    expect(state.stage).toBe("thinking");

    state = reduceStage(state, { type: "envelope", rms: 0.5 });
    expect(state.stage).toBe("speaking");

    // Envelope end = rms 0 sustained: silent frames accumulate, then idle.
    state = reduceStage(state, { type: "envelope", rms: 0 });
    expect(state.stage).toBe("speaking"); // silent frame 1 of QUIET_FRAMES_TO_IDLE
    state = reduceStage(state, { type: "envelope", rms: 0 });
    expect(state.stage).toBe("speaking"); // silent frame 2 of QUIET_FRAMES_TO_IDLE
    expect(QUIET_FRAMES_TO_IDLE).toBe(3);
    state = reduceStage(state, { type: "envelope", rms: 0 });
    expect(state.stage).toBe("idle"); // sustained silence: envelope end

    state = reduceStage(
      state,
      { type: "chart-computed", chartId: "c1" },
      {
        now: 1_000,
        delightMs: DELIGHT_MS,
      },
    );
    expect(state.stage).toBe("delighted");
    expect(state.delightUntil).toBe(1_000 + DELIGHT_MS); // pure marker, no clock read

    state = reduceStage(state, { type: "stage-idle" });
    expect(state.stage).toBe("idle");

    state = reduceStage(state, { type: "stage-idle" });
    expect(state.stage).toBe("idle"); // idle→idle stays idle
  });
});

// ---------------------------------------------------------------------------
// Reducer corner cases the header documents
// ---------------------------------------------------------------------------

describe("reducer documented behaviors", () => {
  test("turn start with no token yet stays the previous state", () => {
    const turn = {
      type: "turn",
      turn: {
        id: "turn-1",
        sessionId: "s1",
        role: "her",
        text: "…",
        ts: 1,
      },
    } as const;
    expect(reduceStage(INITIAL_STAGE_STATE, turn).stage).toBe("idle");
    const thinking = reduceStage(INITIAL_STAGE_STATE, { type: "token", turnId: "t1", text: "a" });
    expect(reduceStage(thinking, turn).stage).toBe("thinking");
  });

  test("a late token during playback does not regress Speaking", () => {
    let state = reduceStage(INITIAL_STAGE_STATE, { type: "envelope", rms: 0.7 });
    expect(state.stage).toBe("speaking");
    state = reduceStage(state, { type: "token", turnId: "t1", text: "more" });
    expect(state.stage).toBe("speaking");
  });

  test("error carries the failing message as detail; unchanged events return the same reference", () => {
    const errored = reduceStage(INITIAL_STAGE_STATE, { type: "error", message: "engine died" });
    expect(errored).toEqual({ stage: "error", detail: "engine died" });
    expect(reduceStage(errored, { type: "envelope", rms: 0 }).stage).toBe("error");
    expect(reduceStage(errored, { type: "envelope", rms: 0 })).toBe(errored);
  });

  test("model-load channel extension: asleep / waking(+progress) / ready", () => {
    const states: StageState[] = [];
    states.push(reduceStage(INITIAL_STAGE_STATE, { type: "model-load", phase: "asleep" }));
    states.push(
      reduceStage(states[0] as StageState, { type: "model-load", phase: "waking", progress: 0.4 }),
    );
    states.push(
      reduceStage(states[1] as StageState, { type: "model-load", phase: "waking", progress: 1.7 }),
    );
    states.push(reduceStage(states[2] as StageState, { type: "model-load", phase: "ready" }));
    expect(states.map((s) => s.stage)).toEqual(["asleep", "waking", "waking", "idle"]);
    expect(states[1]?.progress).toBe(0.4);
    expect(states[2]?.progress).toBe(1); // clamped into 0–1
  });
});

// ---------------------------------------------------------------------------
// Bus contract
// ---------------------------------------------------------------------------

describe("companion bus", () => {
  test("subscription filtering per type delivers only matching events", () => {
    const bus = createCompanionBus();
    const seen: string[] = [];
    bus.subscribe("token", (event) => {
      seen.push(`token:${event.text}`);
    });
    bus.subscribe("error", (event) => {
      seen.push(`error:${event.message}`);
    });
    bus.publish({ type: "token", turnId: "t1", text: "hello" });
    bus.publish({ type: "error", message: "boom" });
    bus.publish({ type: "envelope", rms: 0.4 }); // no subscriber for this type
    expect(seen).toEqual(["token:hello", "error:boom"]);
  });

  test("unsubscribe stops delivery and is idempotent", () => {
    const bus = createCompanionBus();
    const seen: string[] = [];
    const off = bus.subscribe("token", (event) => {
      seen.push(event.text);
    });
    bus.publish({ type: "token", turnId: "t1", text: "a" });
    off();
    off(); // second call is a no-op
    bus.publish({ type: "token", turnId: "t1", text: "b" });
    expect(seen).toEqual(["a"]);
  });

  test("subscribeAll receives every event in publish order", () => {
    const bus = createCompanionBus();
    const kinds: string[] = [];
    const off = bus.subscribeAll((event) => {
      kinds.push(event.type);
    });
    bus.publish({ type: "token", turnId: "t1", text: "x" });
    bus.publish({ type: "unlock" });
    bus.publish({ type: "model-load", phase: "ready" });
    bus.publish({ type: "stage-idle" });
    off();
    bus.publish({ type: "error", message: "gone" });
    expect(kinds).toEqual(["token", "unlock", "model-load", "stage-idle"]);
  });

  test("replay-on-subscribe: a new stageState$ subscriber gets the current state immediately", () => {
    const bus = createCompanionBus();
    const first: StageState[] = [];
    const offA = bus.stageState$.subscribe((state) => {
      first.push(state);
    });
    expect(first).toEqual([INITIAL_STAGE_STATE]); // replay buffer: current on subscribe
    bus.publish({ type: "token", turnId: "t1", text: "x" });
    expect(first).toEqual([INITIAL_STAGE_STATE, { stage: "thinking" }]);
    offA();
    bus.publish({ type: "envelope", rms: 1 });
    expect(first).toHaveLength(2); // unsubscribed: delivery stopped
    expect(bus.stageState$.current().stage).toBe("speaking");

    const late: StageState[] = [];
    bus.stageState$.subscribe((state) => {
      late.push(state);
    });
    expect(late).toEqual([{ stage: "speaking" }]); // replays CURRENT state, not history
  });

  test("stageState$ notifies only on real changes (same-reference reduction is silent)", () => {
    const bus = createCompanionBus();
    const stages: StageName[] = [];
    const off = bus.stageState$.subscribe((state) => {
      stages.push(state.stage);
    });
    stages.length = 0; // drop the replay entry
    bus.publish({ type: "token", turnId: "t1", text: "x" }); // idle → thinking
    bus.publish({ type: "token", turnId: "t1", text: "y" }); // thinking → thinking (no change)
    bus.publish({ type: "envelope", rms: 0 }); // silent frame outside playback (no change)
    expect(stages).toEqual(["thinking"]);
    off();
  });

  test("a throwing subscriber is isolated; other subscribers still receive the event", () => {
    const bus = createCompanionBus();
    const seen: string[] = [];
    bus.subscribe("token", () => {
      throw new Error("broken consumer");
    });
    bus.subscribe("token", (event) => {
      seen.push(event.text);
    });
    expect(() => bus.publish({ type: "token", turnId: "t1", text: "still" })).not.toThrow();
    expect(seen).toEqual(["still"]);
    expect(bus.stageState$.current().stage).toBe("thinking"); // pipeline unaffected
  });
});

// ---------------------------------------------------------------------------
// Host translation of the delight `until` marker
// ---------------------------------------------------------------------------

describe("delight until marker → host translation", () => {
  test("auto-returns to idle after delightMs; an earlier real event cancels the return", () => {
    vi.useFakeTimers();
    try {
      const bus = createCompanionBus();
      const stages: StageName[] = [];
      bus.stageState$.subscribe((state) => {
        stages.push(state.stage);
      });
      stages.length = 0; // drop the replay entry

      bus.publish({ type: "chart-computed", chartId: "c1" });
      expect(bus.stageState$.current().stage).toBe("delighted");
      vi.advanceTimersByTime(DELIGHT_MS - 1);
      expect(bus.stageState$.current().stage).toBe("delighted");
      vi.advanceTimersByTime(1);
      expect(bus.stageState$.current().stage).toBe("idle");
      expect(stages).toEqual(["delighted", "idle"]); // explicit stage-idle translation

      // A real event before the deadline cancels the pending return.
      bus.publish({ type: "chart-computed", chartId: "c2" });
      bus.publish({ type: "token", turnId: "t2", text: "back" });
      vi.advanceTimersByTime(DELIGHT_MS * 2);
      expect(bus.stageState$.current().stage).toBe("thinking");
    } finally {
      vi.useRealTimers();
    }
  });
});
