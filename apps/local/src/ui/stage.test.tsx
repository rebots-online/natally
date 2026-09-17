// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CompanionBus,
  companionBus,
  createCompanionBus,
  type StageSignal,
} from "../companion/bus.js";
import { Stage } from "./stage.js";

let reducedMotion: boolean;
let mediaListeners: Set<() => void>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let observeVisibility: (visible: boolean) => void;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reducedMotion = false;
  mediaListeners = new Set();
  frames = new Map();
  nextFrame = 0;
  disconnect = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return reducedMotion;
      },
      addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    })),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        observeVisibility = (visible) =>
          this.callback(
            [{ target, isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        observeVisibility(true);
      }
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function send(bus: CompanionBus, signal: StageSignal) {
  act(() => {
    if (
      signal.type === "model-presence" ||
      signal.type === "engine-load" ||
      signal.type === "composer-focus"
    ) {
      bus.signal(signal);
    } else bus.emit(signal);
  });
}

function runFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(16);
  });
}

const request: StageSignal = {
  type: "turn",
  turn: { id: "turn-u9", sessionId: "session-u9", role: "you", text: "Read my chart", ts: 1 },
};
const states = [
  ["Idle", { type: "engine-load", fraction: 1 }],
  ["Asleep", { type: "model-presence", present: false }],
  ["Waking", { type: "engine-load", fraction: 0.25 }],
  ["Listening", { type: "composer-focus", focused: true }],
  ["Thinking", request],
  ["Speaking", { type: "envelope-start" }],
  ["Delighted", { type: "chart-computed", chartId: "actual-chart" }],
  ["Error", { type: "error", message: "Engine failed" }],
] satisfies [string, StageSignal][];

function element(container: HTMLElement, selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector);
  expect(found, selector).not.toBeNull();
  return found as HTMLElement;
}

describe("Stage U.9", () => {
  it.each(states)("renders %s only from the real C.4 signal", (state, signal) => {
    const bus = createCompanionBus();
    const { container } = render(<Stage bus={bus} />);
    send(bus, signal);
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe(state);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(state);
    expect(screen.getByRole("status").textContent).toContain(state);
    expect(bus.getSnapshot().state).toBe(state);
    if (["Asleep", "Waking", "Error"].includes(state)) {
      expect(container.querySelector("img")?.getAttribute("src")).toContain(
        "natally-still-400.png",
      );
    } else if (state === "Thinking") {
      expect(container.querySelector("video")?.getAttribute("src")).toContain(
        "natally-source-loop.mp4",
      );
      expect(container.querySelector("video")?.playbackRate).toBe(0.8);
      expect(element(container, ".natally-stage__swirl").style.animation).toContain("6s");
    } else {
      expect(container.querySelector("img")?.getAttribute("src")).toContain(
        "natally-idle-400.webp",
      );
    }
    if (state !== "Idle" && state !== "Thinking") {
      expect(container.querySelector(`[data-stage-overlay="${state}"]`)).not.toBeNull();
    }
  });

  it("scales the orb 1→1.12 and three mouth frames from successive RMS events, retaining silent Speaking", () => {
    const bus = createCompanionBus();
    const { container } = render(<Stage bus={bus} />);
    send(bus, request);
    send(bus, { type: "token", token: "Hello" });
    expect(bus.getSnapshot().state).toBe("Idle");
    send(bus, { type: "envelope-level", level: 1 });
    expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1)");
    send(bus, { type: "envelope-start" });
    for (const [level, scale, mouthFrame] of [
      [0, 1, 0],
      [0.25, 1.03, 1],
      [1, 1.12, 2],
      [0, 1, 0],
    ]) {
      send(bus, { type: "envelope-level", level });
      expect(element(container, "[data-stage-orb]").style.transform).toBe(`scale(${scale})`);
      expect(element(container, "[data-mouth-frame]").getAttribute("data-mouth-frame")).toBe(
        String(mouthFrame),
      );
      expect(element(container, "[data-mouth-frame]").style.transform).toBe(`scaleY(${1 + level})`);
      expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Speaking");
    }
    send(bus, { type: "envelope-end" });
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Idle");
    expect(container.querySelector("[data-mouth-frame]")).toBeNull();
    expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1)");
  });

  it("replays the current bus snapshot when mounting during speech", () => {
    const bus = createCompanionBus();
    bus.emit({ type: "envelope-start" });
    bus.emit({ type: "envelope-level", level: 1 });
    const { container } = render(<Stage bus={bus} />);
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Speaking");
    expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1.12)");
  });

  it("follows actual Waking progress even when C.4 publishes no state transition", () => {
    const bus = createCompanionBus();
    const { container, unmount } = render(<Stage bus={bus} />);
    const changes = vi.fn();
    const unsubscribe = bus.stageState$.subscribe(changes);
    send(bus, { type: "engine-load", fraction: 0 });
    expect(element(container, "[data-stage-orb]").style.backdropFilter).toContain(
      "brightness(0.55)",
    );
    send(bus, { type: "engine-load", fraction: 0.8 });
    runFrame();
    expect(changes.mock.calls.map(([state]) => state)).toEqual(["Idle", "Waking"]);
    const filter = element(container, "[data-stage-orb]").style.backdropFilter;
    expect(Number(filter.match(/brightness\(([^)]+)\)/)?.[1])).toBeCloseTo(0.91);
    expect(
      container.querySelector("[data-stage-overlay=Waking]")?.getAttribute("stroke-dasharray"),
    ).toBe("0.8 1");
    runFrame();
    expect(bus.getSnapshot().engineLoad).toBe(0.8);
    send(bus, { type: "engine-load", fraction: 1 });
    expect(element(container, "[data-stage-orb]").style.backdropFilter).toContain("brightness(1)");
    expect(frames.size).toBe(0);
    send(bus, { type: "engine-load", fraction: 0 });
    unmount();
    expect(frames.size).toBe(0);
    unsubscribe();
  });

  it("keeps no-model Asleep despite focus, and Listening means actual composer focus", () => {
    const bus = createCompanionBus();
    const { container } = render(<Stage bus={bus} />);
    send(bus, { type: "model-presence", present: false });
    send(bus, { type: "composer-focus", focused: true });
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Asleep");
    expect(element(container, "[data-stage-orb]").style.backdropFilter).toContain("saturate(0.4)");
    send(bus, { type: "model-presence", present: true });
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Listening");
    expect(element(container, ".natally-stage__pose").style.transform).toBe("rotate(2deg)");
    expect(element(container, "[data-stage-orb]").style.backdropFilter).toContain(
      "hue-rotate(8deg)",
    );
    send(bus, { type: "composer-focus", focused: false });
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Idle");
  });

  it.each(states)(
    "freezes frame zero and disables plate/mascot motion in reduced-motion %s",
    (_state, signal) => {
      reducedMotion = true;
      const bus = createCompanionBus();
      const { container } = render(<Stage bus={bus} plate={<article>Computed plate</article>} />);
      send(bus, signal);
      if (signal.type === "envelope-start") send(bus, { type: "envelope-level", level: 1 });
      expect(container.querySelector("img")?.getAttribute("src")).toContain(
        "natally-still-400.png",
      );
      expect(container.querySelector("video")).toBeNull();
      expect(element(container, "[data-stage-plate]").style.animation).toBe("none");
      expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1)");
      expect(element(container, ".natally-stage__pose").style.transform).toBe("none");
      for (const node of container.querySelectorAll<HTMLElement>("[style]")) {
        expect(node.style.animation === "" || node.style.animation === "none").toBe(true);
      }
      expect(element(container, "[data-stage-state]").dataset.stageState).toBe(
        bus.getSnapshot().state,
      );
    },
  );

  it("responds to motion preference changes during speech and removes its media listener", () => {
    const bus = createCompanionBus();
    const { container, unmount } = render(<Stage bus={bus} plate="Plate" />);
    send(bus, { type: "envelope-start" });
    send(bus, { type: "envelope-level", level: 1 });
    expect(element(container, "[data-stage-plate]").style.animation).toContain(
      "natally-stage-slide",
    );
    act(() => {
      reducedMotion = true;
      for (const listener of mediaListeners) listener();
    });
    expect(container.querySelector("img")?.getAttribute("src")).toContain("natally-still-400.png");
    expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1)");
    expect(element(container, "[data-stage-plate]").style.animation).toBe("none");
    act(() => {
      reducedMotion = false;
      for (const listener of mediaListeners) listener();
    });
    expect(element(container, "[data-stage-orb]").style.transform).toBe("scale(1.12)");
    unmount();
    expect(mediaListeners.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("plays footage only while on screen and the document is visible", () => {
    const bus = createCompanionBus();
    const { container } = render(<Stage bus={bus} />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("natally-idle-400.webp");
    act(() => observeVisibility(false));
    expect(container.querySelector("img")?.getAttribute("src")).toContain("natally-still-400.png");
    send(bus, request);
    expect(container.querySelector("video")).toBeNull();
    act(() => observeVisibility(true));
    expect(container.querySelector("video")?.playbackRate).toBe(0.8);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("natally-still-400.png");
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("flashes once per actual chart, including consecutive charts, without inventing an Idle transition", () => {
    vi.useFakeTimers();
    const bus = createCompanionBus();
    const { container } = render(<Stage bus={bus} />);
    send(bus, { type: "chart-computed", chartId: "one" });
    const firstFlash = element(container, "[data-stage-overlay=Delighted]");
    expect(firstFlash.style.animation).toBe("natally-stage-flash 600ms ease-out 1");
    act(() => vi.advanceTimersByTime(60_000));
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Delighted");
    send(bus, { type: "chart-computed", chartId: "two" });
    expect(element(container, "[data-stage-overlay=Delighted]")).not.toBe(firstFlash);
    send(bus, { type: "error", message: "Engine failed" });
    send(bus, { type: "chart-computed", chartId: "late" });
    expect(container.querySelector("[data-stage-overlay=Delighted]")).toBeNull();
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Error");
  });

  it("uses the shared bus by default and releases listeners when switching instances or unmounting", () => {
    const sharedSubscribe = vi.spyOn(companionBus.stageState$, "subscribe");
    const { container, rerender, unmount } = render(
      <Stage className="screen-stage" style={{ maxWidth: 600 }} />,
    );
    expect(sharedSubscribe).toHaveBeenCalled();
    expect(element(container, ".screen-stage").style.maxWidth).toBe("600px");
    const first = createCompanionBus();
    const second = createCompanionBus();
    const readFirst = vi.spyOn(first, "getSnapshot");
    rerender(<Stage bus={first} />);
    send(first, { type: "engine-load", fraction: 0.2 });
    expect(frames.size).toBe(1);
    rerender(<Stage bus={second} />);
    expect(frames.size).toBe(0);
    readFirst.mockClear();
    send(first, { type: "envelope-level", level: 1 });
    send(first, { type: "chart-computed", chartId: "old-bus" });
    expect(readFirst).not.toHaveBeenCalled();
    expect(element(container, "[data-stage-state]").dataset.stageState).toBe("Idle");
    const readSecond = vi.spyOn(second, "getSnapshot");
    unmount();
    readSecond.mockClear();
    send(second, { type: "chart-computed", chartId: "unmounted" });
    expect(readSecond).not.toHaveBeenCalled();
  });

  it("ships the actual frozen files, with unchanged bytes and recorded provenance", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const hashes = {
      "natally-idle-400.webp": "a40780bad977525afdd6c7f92ed47a4b0ba090b1453921a0ad4248208301f873",
      "natally-still-400.png": "11868146604c5f0237f1af3f37e2252f7d3394ff8304d5d570f16a4cae392b66",
      "natally-source-loop.mp4": "1364c68499a3caccfc8c4de8b0759c31c4db941b8721c3bacdf544df0d334afa",
      "STATES.md": "10432e3a0638c973e06c2792f092eba850940b2d1886beb05e7cf29cd04aa451",
    };
    for (const [name, hash] of Object.entries(hashes)) {
      const copied = readFileSync(resolve(import.meta.dirname, "../assets/mascot", name));
      expect(copied.equals(readFileSync(resolve(root, "LIBS/UI/FIGMA/mascot", name)))).toBe(true);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(hash);
    }
  });
});
