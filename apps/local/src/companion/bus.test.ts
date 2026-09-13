import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type CompanionBus,
  type CompanionEvent,
  companionBus,
  createCompanionBus,
  emit,
  INITIAL_STAGE_STATE,
  type StageSignal,
  type StageSnapshot,
  type StageState,
  signal,
  stageReducer,
  stageState$,
  subscribe,
} from "./bus.js";

function turn(role: "you" | "her" | "tool" = "you"): CompanionEvent {
  return {
    type: "turn",
    turn: { id: `turn-${role}`, sessionId: "session-1", role, text: "Chart request", ts: 1 },
  };
}

function reduce(...signals: StageSignal[]): StageSnapshot {
  return signals.reduce(stageReducer, INITIAL_STAGE_STATE);
}

afterEach(() => vi.useRealTimers());

describe("stageReducer", () => {
  it("bus: StageSignal→stage reducer sequence request-sent→Thinking→Speaking→Idle exact", () => {
    const signals: StageSignal[] = [turn(), { type: "envelope-start" }, { type: "envelope-end" }];
    let snapshot = INITIAL_STAGE_STATE;
    const states: StageState[] = [];
    for (const event of signals) {
      snapshot = stageReducer(snapshot, event);
      states.push(snapshot.state);
    }
    expect(states).toEqual(["Thinking", "Speaking", "Idle"]);
  });

  it("stops Thinking at the first token without inventing playback", () => {
    expect(reduce(turn(), { type: "token", token: "Your" })).toMatchObject({
      state: "Idle",
      awaitingToken: false,
      envelopeActive: false,
      envelopeLevel: 0,
    });
    expect(reduce(turn(), turn("her")).state).toBe("Idle");
    expect(reduce(turn(), turn("tool")).state).toBe("Thinking");
  });

  it("keeps Speaking from envelope-start through tokens, turns, charts, focus and levels", () => {
    let snapshot = reduce(turn(), { type: "envelope-start" });
    for (const event of [
      { type: "token", token: "chart" },
      turn("her"),
      { type: "chart-computed", chartId: "chart-1" },
      { type: "composer-focus", focused: true },
      { type: "model-presence", present: true },
      { type: "engine-load", fraction: 1 },
      { type: "envelope-level", level: 0.7 },
      { type: "envelope-level", level: 0 },
    ] satisfies StageSignal[]) {
      snapshot = stageReducer(snapshot, event);
      expect(snapshot.state).toBe("Speaking");
    }
    expect(stageReducer(snapshot, { type: "envelope-end" })).toMatchObject({
      state: "Listening",
      envelopeActive: false,
      envelopeLevel: 0,
    });
  });

  it("ignores orphan levels and makes duplicate starts and ends harmless", () => {
    expect(reduce({ type: "envelope-level", level: 1 })).toEqual(INITIAL_STAGE_STATE);
    const speaking = reduce({ type: "envelope-start" }, { type: "envelope-level", level: 0.4 });
    expect(speaking.envelopeLevel).toBe(0.4);
    expect(stageReducer(speaking, { type: "envelope-start" })).toEqual(speaking);
    expect(
      reduce({ type: "envelope-start" }, { type: "envelope-end" }, { type: "envelope-end" }),
    ).toEqual(INITIAL_STAGE_STATE);
  });

  it("derives Asleep, Waking and Listening from capabilities and retains real progress", () => {
    let snapshot = reduce({ type: "model-presence", present: false });
    expect(snapshot.state).toBe("Asleep");
    snapshot = stageReducer(snapshot, { type: "composer-focus", focused: true });
    expect(snapshot.state).toBe("Asleep");
    for (const fraction of [0, 0.35, 0.99]) {
      snapshot = stageReducer(snapshot, { type: "engine-load", fraction });
      expect(snapshot).toMatchObject({ state: "Waking", engineLoad: fraction });
    }
    snapshot = stageReducer(snapshot, { type: "model-presence", present: true });
    expect(snapshot.state).toBe("Waking");
    snapshot = stageReducer(snapshot, { type: "engine-load", fraction: 1 });
    expect(snapshot.state).toBe("Listening");
    expect(stageReducer(snapshot, { type: "composer-focus", focused: false }).state).toBe("Idle");
  });

  it("does not let focus or stale playback wake an absent or loading model", () => {
    for (const unavailable of [
      { type: "model-presence", present: false },
      { type: "engine-load", fraction: 0.4 },
    ] satisfies StageSignal[]) {
      const snapshot = reduce(
        unavailable,
        turn(),
        { type: "envelope-start" },
        { type: "envelope-level", level: 0.7 },
        { type: "composer-focus", focused: true },
      );
      expect(snapshot).toMatchObject({
        awaitingToken: false,
        envelopeActive: false,
        envelopeLevel: 0,
      });
      expect(snapshot.state).toBe(unavailable.type === "engine-load" ? "Waking" : "Asleep");
    }
  });

  it("does not let repeated ready capabilities cancel a pending request", () => {
    expect(
      reduce(
        { type: "engine-load", fraction: 1 },
        turn(),
        { type: "model-presence", present: true },
        { type: "engine-load", fraction: 1 },
      ).state,
    ).toBe("Thinking");
  });

  it("clears interrupted speech and pending work on model removal", () => {
    const absent = reduce(
      turn(),
      { type: "envelope-start" },
      { type: "envelope-level", level: 0.5 },
      { type: "model-presence", present: false },
    );
    expect(absent).toMatchObject({ state: "Asleep", envelopeActive: false, envelopeLevel: 0 });
    expect(stageReducer(absent, { type: "model-presence", present: true }).state).toBe("Idle");
  });

  it("enters Delighted for an actual chart and returns on the next real signal", () => {
    const delighted = reduce({ type: "chart-computed", chartId: "computed-chart" });
    expect(delighted.state).toBe("Delighted");
    expect(stageReducer(delighted, turn()).state).toBe("Thinking");
    expect(stageReducer(delighted, { type: "composer-focus", focused: true }).state).toBe(
      "Listening",
    );
  });

  it("holds Error across unrelated events until a real capability recovery", () => {
    const failed = reduce(
      { type: "envelope-start" },
      { type: "error", message: "Model failed to load" },
      { type: "envelope-end" },
      { type: "composer-focus", focused: true },
      { type: "token", token: "late" },
      { type: "envelope-start" },
      { type: "chart-computed", chartId: "late-chart" },
    );
    expect(failed).toMatchObject({
      state: "Error",
      error: "Model failed to load",
      envelopeActive: false,
      envelopeLevel: 0,
    });
    expect(stageReducer(failed, { type: "engine-load", fraction: 0 }).state).toBe("Waking");
    expect(stageReducer(failed, { type: "engine-load", fraction: 1 }).state).toBe("Listening");
    expect(reduce({ type: "error", message: "" }).state).toBe("Error");
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid progress and envelope fractions: %s",
    (value) => {
      expect(() => reduce({ type: "engine-load", fraction: value })).toThrow(RangeError);
      expect(() => reduce({ type: "envelope-level", level: value })).toThrow(RangeError);
    },
  );

  it("is deterministic, does not mutate inputs and preserves the closed sets", () => {
    const event = Object.freeze({ type: "envelope-start" } as const);
    const previous = Object.freeze(reduce(turn()));
    const first = stageReducer(previous, event);
    expect(first).toEqual(stageReducer(previous, event));
    expect(previous.state).toBe("Thinking");
    expect(Object.isFrozen(first)).toBe(true);
    expectTypeOf<StageSignal["type"]>().toEqualTypeOf<
      | "token"
      | "turn"
      | "chart-computed"
      | "envelope-start"
      | "envelope-level"
      | "envelope-end"
      | "error"
      | "engine-load"
      | "model-presence"
      | "composer-focus"
    >();
    expectTypeOf<StageState>().toEqualTypeOf<
      "Idle" | "Asleep" | "Waking" | "Listening" | "Thinking" | "Speaking" | "Delighted" | "Error"
    >();
  });
});

describe("companion bus", () => {
  it("publishes the exact accepted request and audio sequence", () => {
    const bus = createCompanionBus();
    const states: StageState[] = [];
    bus.stageState$.subscribe((state) => states.push(state));
    bus.emit(turn());
    bus.emit({ type: "envelope-start" });
    bus.emit({ type: "envelope-level", level: 0.25 });
    bus.emit({ type: "envelope-level", level: 1 });
    bus.emit({ type: "envelope-end" });
    expect(states).toEqual(["Idle", "Thinking", "Speaking", "Idle"]);
  });

  it("delivers each exact discriminator with a narrowed payload", () => {
    const bus = createCompanionBus();
    const events: CompanionEvent[] = [
      { type: "token", token: "Hello" },
      turn(),
      { type: "chart-computed", chartId: "chart-1" },
      { type: "envelope-start" },
      { type: "envelope-level", level: 0.5 },
      { type: "envelope-end" },
      { type: "error", message: "Engine unavailable" },
    ];
    const seen = new Map<string, CompanionEvent[]>();
    for (const event of events) {
      bus.subscribe(event.type, (received) => {
        const values = seen.get(received.type) ?? [];
        values.push(received);
        seen.set(received.type, values);
      });
    }
    bus.subscribe("token", (event) => expectTypeOf(event.token).toEqualTypeOf<string>());
    bus.subscribe("envelope-level", (event) => expectTypeOf(event.level).toEqualTypeOf<number>());
    for (const event of events) bus.emit(event);
    for (const event of events) expect(seen.get(event.type)).toEqual([event]);
    expectTypeOf<Parameters<CompanionBus["emit"]>[0]>().toEqualTypeOf<CompanionEvent>();
    expectTypeOf<Parameters<CompanionBus["signal"]>[0]>().toEqualTypeOf<
      Exclude<StageSignal, CompanionEvent>
    >();
  });

  it("replays only the latest stage while raw bus events are not replayed", () => {
    const bus = createCompanionBus();
    bus.emit(turn());
    bus.emit({ type: "envelope-start" });
    const states: StageState[] = [];
    const unsubscribe = bus.stageState$.subscribe((state) => states.push(state));
    const lateEvent = vi.fn();
    bus.subscribe("envelope-start", lateEvent);
    expect(states).toEqual(["Speaking"]);
    expect(lateEvent).not.toHaveBeenCalled();
    bus.emit({ type: "envelope-level", level: 0.8 });
    bus.emit({ type: "envelope-end" });
    expect(states).toEqual(["Speaking", "Idle"]);
    expect(bus.stageState$.getSnapshot()).toBe("Idle");
    unsubscribe();
    unsubscribe();
    bus.emit(turn());
    expect(states).toEqual(["Speaking", "Idle"]);
    const remounted = vi.fn();
    bus.stageState$.subscribe(remounted);
    expect(remounted).toHaveBeenCalledExactlyOnceWith("Thinking");
  });

  it("updates eagerly without subscribers and isolates bus instances", () => {
    const bus = createCompanionBus();
    bus.signal({ type: "engine-load", fraction: 0.3 });
    const state = vi.fn();
    bus.stageState$.subscribe(state);
    expect(state).toHaveBeenCalledExactlyOnceWith("Waking");
    expect(bus.getSnapshot().engineLoad).toBe(0.3);
    expect(createCompanionBus().getSnapshot()).toEqual(INITIAL_STAGE_STATE);
  });

  it("supports independent duplicate subscriptions and idempotent unsubscribe", () => {
    const bus = createCompanionBus();
    const listener = vi.fn();
    const first = bus.subscribe("token", listener);
    const second = bus.subscribe("token", listener);
    first();
    first();
    bus.emit({ type: "token", token: "one subscription" });
    expect(listener).toHaveBeenCalledTimes(1);
    second();
    bus.emit({ type: "token", token: "no subscriptions" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps state and event delivery ordered during nested emissions", () => {
    const bus = createCompanionBus();
    const observed: string[] = [];
    bus.stageState$.subscribe((state) => {
      if (state === "Thinking") bus.emit({ type: "envelope-start" });
    });
    bus.stageState$.subscribe((state) => observed.push(state));
    bus.subscribe("turn", () => observed.push("turn"));
    bus.subscribe("envelope-start", () => observed.push("envelope-start"));
    bus.emit(turn());
    expect(observed).toEqual(["Idle", "Thinking", "turn", "Speaking", "envelope-start"]);
  });

  it("honors unsubscribe during dispatch and defers newly added event observers", () => {
    const bus = createCompanionBus();
    const removed = vi.fn();
    const added = vi.fn();
    bus.subscribe("token", () => {
      unsubscribe();
      bus.subscribe("token", added);
    });
    const unsubscribe = bus.subscribe("token", removed);
    bus.emit({ type: "token", token: "first" });
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    bus.emit({ type: "token", token: "second" });
    expect(added).toHaveBeenCalledTimes(1);
  });

  it("reports observer failures after delivering to the remaining listeners", () => {
    const bus = createCompanionBus();
    const bad = bus.subscribe("turn", () => {
      throw new Error("observer failure");
    });
    const healthy = vi.fn();
    bus.subscribe("turn", healthy);
    expect(() => bus.emit(turn())).toThrow(AggregateError);
    expect(healthy).toHaveBeenCalledExactlyOnceWith(turn());
    expect(bus.stageState$.getSnapshot()).toBe("Thinking");
    bad();
    expect(() => bus.emit(turn())).not.toThrow();
  });

  it("does not leak a state subscriber whose initial replay throws", () => {
    const bus = createCompanionBus();
    const listener = vi.fn(() => {
      throw new Error("failed mount");
    });
    expect(() => bus.stageState$.subscribe(listener)).toThrow("failed mount");
    expect(() => bus.emit(turn())).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid signals without publishing or corrupting the replay buffer", () => {
    const bus = createCompanionBus();
    bus.emit({ type: "envelope-start" });
    const previous = bus.getSnapshot();
    const level = vi.fn();
    bus.subscribe("envelope-level", level);
    expect(() => bus.emit({ type: "envelope-level", level: Number.NaN })).toThrow(AggregateError);
    expect(bus.getSnapshot()).toBe(previous);
    expect(level).not.toHaveBeenCalled();
    bus.emit({ type: "envelope-end" });
    expect(bus.stageState$.getSnapshot()).toBe("Idle");
  });

  it("uses measured envelope events, never elapsed time, to infer playback", () => {
    vi.useFakeTimers();
    const bus = createCompanionBus();
    bus.emit(turn());
    vi.advanceTimersByTime(60_000);
    expect(bus.stageState$.getSnapshot()).toBe("Thinking");
    bus.emit({ type: "token", token: "text without audio" });
    vi.advanceTimersByTime(60_000);
    expect(bus.stageState$.getSnapshot()).toBe("Idle");
    bus.emit({ type: "envelope-start" });
    for (let window = 0; window < 6; window += 1) {
      bus.emit({ type: "envelope-level", level: 0 });
      vi.advanceTimersByTime(20);
      expect(bus.stageState$.getSnapshot()).toBe("Speaking");
    }
    // The actual audio producer closes the envelope after its 120 ms silence.
    bus.emit({ type: "envelope-end" });
    expect(bus.stageState$.getSnapshot()).toBe("Idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exposes the shared instance without a second reducer or playback source", () => {
    expect(emit).toBe(companionBus.emit);
    expect(subscribe).toBe(companionBus.subscribe);
    expect(signal).toBe(companionBus.signal);
    expect(stageState$).toBe(companionBus.stageState$);
  });
});
