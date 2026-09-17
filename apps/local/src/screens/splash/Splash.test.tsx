// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CompanionBus,
  createCompanionBus,
  type StageSignal,
} from "../../companion/bus.js";
import { Splash } from "./Splash.js";

const TITLE = "natally"; // 7 characters — the default D21 display line.

let reducedMotion: boolean;
let mediaListeners: Set<() => void>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  reducedMotion = false;
  mediaListeners = new Set();
  frames = new Map();
  nextFrame = 0;
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
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function send(bus: CompanionBus, signal: StageSignal) {
  act(() => {
    if (
      signal.type === "model-presence" ||
      signal.type === "engine-load" ||
      signal.type === "composer-focus"
    ) {
      bus.signal(signal);
    } else {
      bus.emit(signal);
    }
  });
}

/** Run every queued animation frame; each callback may queue the next. */
function pump(maxFrames = 200) {
  let guard = 0;
  while (frames.size > 0 && guard < maxFrames) {
    const [id, callback] = [...frames.entries()][0];
    frames.delete(id);
    callback(0);
    guard += 1;
  }
}

const typedText = () => {
  const element = document.querySelector(".splash__typed");
  if (!element) throw new Error("missing .splash__typed");
  return element.textContent ?? "";
};

describe("Splash typewriter (D21, event-paced)", () => {
  it("advances characters only when a real capability signal arrives", () => {
    const bus = createCompanionBus();
    render(<Splash bus={bus} />);
    expect(typedText()).toBe("");

    send(bus, { type: "engine-load", fraction: 0.5 });
    act(() => pump());
    expect(typedText()).toBe(title(3));

    send(bus, { type: "engine-load", fraction: 0.75 });
    act(() => pump());
    expect(typedText()).toBe(title(5));

    send(bus, { type: "engine-load", fraction: 1 });
    act(() => pump());
    expect(typedText()).toBe(TITLE);
  });

  it("holds the type honestly when the load stalls — no event, no advance", () => {
    const bus = createCompanionBus();
    render(<Splash bus={bus} />);
    send(bus, { type: "engine-load", fraction: 0.4 });
    act(() => pump());
    expect(typedText()).toBe(title(2));

    // Many frames later — a stalled fraction is still the same real fraction.
    act(() => pump(500));
    expect(typedText()).toBe(title(2));
    expect(screen.getByRole("status").textContent).toContain("40%");
  });

  it("does not fabricate any characters before any signal arrives", () => {
    const bus = createCompanionBus();
    const onComplete = vi.fn();
    render(<Splash bus={bus} onComplete={onComplete} />);
    act(() => pump(500));
    expect(typedText()).toBe("");
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).not.toBe("");
  });

  it("renders the full text statically under reduced motion, still gated on real signals", () => {
    reducedMotion = true;
    const bus = createCompanionBus();
    const onComplete = vi.fn();
    render(<Splash bus={bus} onComplete={onComplete} />);
    act(() => pump());
    expect(typedText()).toBe(TITLE);

    // Static text is not an unearned completion: nothing routes until the
    // device actually reports a ready capability.
    expect(onComplete).not.toHaveBeenCalled();
    send(bus, { type: "engine-load", fraction: 1 });
    act(() => pump());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("routes forward exactly once when the text is complete and the capability is ready", () => {
    const bus = createCompanionBus();
    const onComplete = vi.fn();
    render(<Splash bus={bus} onComplete={onComplete} />);

    send(bus, { type: "engine-load", fraction: 1 });
    act(() => pump());
    expect(typedText()).toBe(TITLE);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Repeat-ready signals never fire a second completion.
    send(bus, { type: "engine-load", fraction: 1 });
    act(() => pump());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("completes on an observed model presence without a load stream", () => {
    const bus = createCompanionBus();
    const onComplete = vi.fn();
    render(<Splash bus={bus} onComplete={onComplete} />);

    send(bus, { type: "model-presence", present: true });
    act(() => pump());
    expect(typedText()).toBe(TITLE);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

function title(count: number) {
  return TITLE.slice(0, count);
}
