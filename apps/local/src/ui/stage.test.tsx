// @vitest-environment jsdom
// natally — U.9 tests: the Stage renders the 8 STATES.md states from real
// companion-bus events only (C.4 bus, real instance), the envelope rms drives
// the orb scale, and reduced-motion is honored. Accept line:
// "stage: 8 states map to bus events; envelope scales orb; reduced-motion honored".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BusEvent, type CompanionBus, createCompanionBus } from "../companion/bus";
import { Stage } from "./stage";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mountStage(
  bus: CompanionBus,
  props: { reducedMotion?: boolean; listening?: boolean } = {},
): void {
  act(() => {
    root.render(
      <Stage bus={bus} reducedMotion={props.reducedMotion} listening={props.listening} />,
    );
  });
}

function setListening(listening: boolean): void {
  const bus = currentBus;
  act(() => {
    root.render(<Stage bus={bus} listening={listening} />);
  });
}

function publish(bus: CompanionBus, event: BusEvent): void {
  act(() => {
    bus.publish(event);
  });
}

let currentBus: CompanionBus;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  currentBus = createCompanionBus();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

const q = (selector: string): Element | null => container.querySelector(selector);
const stageName = (): string | null => q(".natally-stage")?.getAttribute("data-stage") ?? null;
const figureSrc = (): string => q('[data-testid="stage-figure"]')?.getAttribute("src") ?? "";

describe("stage: 8 states map to bus events; envelope scales orb; reduced-motion honored", () => {
  it("renders all 8 STATES.md states from bus events only", () => {
    const bus = currentBus;
    mountStage(bus);
    expect(stageName()).toBe("idle");
    expect(figureSrc()).toContain("natally-idle-400.webp");

    const seen = new Set<string>();

    // asleep — model-load asleep (no model downloaded).
    publish(bus, { type: "model-load", phase: "asleep" });
    expect(stageName()).toBe("asleep");
    seen.add(stageName() ?? "");
    expect(q('[data-testid="stage-lids"]')).not.toBeNull();
    expect(figureSrc()).toContain("natally-still-400.png");
    const asleepPlate = q('[data-testid="stage-plate"]');
    expect(asleepPlate?.getAttribute("style")).toContain("saturate(0.4)");
    expect(asleepPlate?.getAttribute("style")).toContain("brightness(0.55)");

    // waking — model-load waking with the real progress fraction.
    publish(bus, { type: "model-load", phase: "waking", progress: 0.42 });
    expect(stageName()).toBe("waking");
    seen.add(stageName() ?? "");
    expect(figureSrc()).toContain("natally-still-mid-400.png");
    expect(q('[data-testid="stage-plate"]')?.getAttribute("style")).toContain("brightness(0.739)");

    // ready — back to the real idle loop.
    publish(bus, { type: "model-load", phase: "ready" });
    expect(stageName()).toBe("idle");
    expect(figureSrc()).toContain("natally-idle-400.webp");

    // listening — host-entered (composer focus is not a bus event, bus.ts).
    setListening(true);
    expect(stageName()).toBe("listening");
    seen.add(stageName() ?? "");
    const listenPlate = q('[data-testid="stage-plate"]');
    expect(listenPlate?.getAttribute("style")).toContain("rotate(2deg)");
    expect(listenPlate?.getAttribute("style")).toContain("hue-rotate(8deg)");

    // thinking — first streamed token; a real inference state masks listening.
    publish(bus, { type: "token", turnId: "t1", text: "He" });
    expect(stageName()).toBe("thinking");
    seen.add(stageName() ?? "");
    expect(q('[data-testid="stage-swirl"]')).not.toBeNull();

    // speaking — envelope rms > 0.
    publish(bus, { type: "envelope", rms: 0.5 });
    expect(stageName()).toBe("speaking");
    seen.add(stageName() ?? "");
    expect(q('[data-testid="stage-orb"]')?.getAttribute("style")).toContain("scale(1.075)");
    expect(q('[data-testid="stage-mouth"]')?.getAttribute("style")).toContain("scaleY(0.550)");

    // envelope end — sustained rms 0 returns to idle (bus reducer contract);
    // the composer is still focused, so the host honestly keeps listening.
    publish(bus, { type: "envelope", rms: 0 });
    publish(bus, { type: "envelope", rms: 0 });
    publish(bus, { type: "envelope", rms: 0 });
    expect(stageName()).toBe("listening");
    setListening(false);
    expect(stageName()).toBe("idle");

    // delighted — chart computed; the bus host schedules the return to idle.
    publish(bus, { type: "chart-computed", chartId: "c1" });
    expect(stageName()).toBe("delighted");
    seen.add(stageName() ?? "");
    expect(q('[data-testid="stage-ring"]')).not.toBeNull();
    publish(bus, { type: "stage-idle" });
    expect(stageName()).toBe("idle");

    // error — engine failure, with the failing event's message.
    publish(bus, { type: "error", message: "engine failure" });
    expect(stageName()).toBe("error");
    seen.add(stageName() ?? "");
    expect(q('[data-testid="stage-crack"]')).not.toBeNull();
    expect(q('[data-error-detail="engine failure"]')).not.toBeNull();
    publish(bus, { type: "stage-idle" });
    expect(stageName()).toBe("idle");

    expect([...seen].sort()).toEqual([
      "asleep",
      "delighted",
      "error",
      "listening",
      "speaking",
      "thinking",
      "waking",
    ]);
  });

  it("envelope rms changes update the orb scale and mouth open-height", () => {
    const bus = currentBus;
    mountStage(bus);
    publish(bus, { type: "token", turnId: "t1", text: "He" });
    publish(bus, { type: "envelope", rms: 0.25 });
    expect(q('[data-testid="stage-orb"]')?.getAttribute("style")).toContain("scale(1.038)");
    expect(q('[data-testid="stage-mouth"]')?.getAttribute("style")).toContain("scaleY(0.325)");
    publish(bus, { type: "envelope", rms: 0.8 });
    expect(q('[data-testid="stage-orb"]')?.getAttribute("style")).toContain("scale(1.120)");
    expect(q('[data-testid="stage-mouth"]')?.getAttribute("style")).toContain("scaleY(0.820)");
  });

  it("reduced-motion swaps the loop for frame 0, drops decorative motion, keeps the envelope", () => {
    const bus = currentBus;
    mountStage(bus, { reducedMotion: true, listening: true });
    // frame 0 still replaces the animated webp; no transition class; no tilt.
    expect(figureSrc()).toContain("natally-still-400.png");
    expect(q(".natally-stage")?.className).not.toContain("stage-motion");
    // hue-rotate is a color filter (not motion); the 2° tilt transform is motion.
    expect(q('[data-testid="stage-plate"]')?.getAttribute("style") ?? "").not.toContain(
      "transform",
    );

    // thinking: still frame, swirl present but not animated.
    publish(bus, { type: "token", turnId: "t1", text: "He" });
    expect(figureSrc()).toContain("natally-still-400.png");
    expect(q('[data-testid="stage-swirl"]')?.className).not.toContain("stage-anim");

    // delighted: ring present, no one-shot animation.
    publish(bus, { type: "chart-computed", chartId: "c1" });
    expect(q('[data-testid="stage-ring"]')?.className).not.toContain("stage-anim");

    // speaking: envelope-driven scale is real data, still honored.
    publish(bus, { type: "stage-idle" });
    publish(bus, { type: "envelope", rms: 0.9 });
    expect(stageName()).toBe("speaking");
    expect(q('[data-testid="stage-orb"]')?.getAttribute("style")).toContain("scale(1.135)");
  });

  it("fabricates nothing: only bus events move the Stage (delight returns via the bus host)", () => {
    vi.useFakeTimers();
    const bus = currentBus;
    mountStage(bus);
    // Five seconds of nothing changes nothing.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(stageName()).toBe("idle");

    // Delighted only on its real event…
    publish(bus, { type: "chart-computed", chartId: "c1" });
    expect(stageName()).toBe("delighted");
    // …and the bus host's scheduled stage-idle ends it at the 600 ms marker.
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(stageName()).toBe("delighted");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(stageName()).toBe("idle");
    // No error state ever appeared without an error event.
    expect(stageName()).not.toBe("error");
  });
});
