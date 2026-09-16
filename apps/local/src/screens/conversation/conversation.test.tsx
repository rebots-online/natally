// @vitest-environment jsdom
// natally — U.2 tests: the nine frozen screen-conversation variants render
// against scripted real bus events (C.4 bus, real instance) + B.1 gate shapes
// (§9.2), with the transcript grammar (SCREEN.md), composer gating and the
// injected seams asserted in the rendered DOM. Accept line:
// "conversation: 9 variants render against event scripts".

import type { Turn } from "@natally/lore/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BusEvent, type CompanionBus, createCompanionBus } from "../../companion/bus";
import { resetRoutes, routeRegistry } from "../../ui/router";
import { ConversationScreen, type ConversationScreenProps } from "./ConversationScreen";
import type { ConversationPlate, PersonRef, TranscriptSink, TrialGateResult } from "./types";
import { deriveVariant } from "./variant";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let turnSeq = 0;

function makeTurn(role: Turn["role"], text: string, id?: string): Turn {
  turnSeq += 1;
  return {
    id: id ?? `turn-${turnSeq}`,
    sessionId: "session-test",
    role,
    text,
    ts: 1_789_000_000_000 + turnSeq,
    ...(role === "tool"
      ? { toolOps: [{ selector: "#moon-phase", op: "text" as const, value: "waxing gibbous" }] }
      : {}),
  };
}

const ROBIN: PersonRef = { id: "person-robin", name: "Robin" };
const SAM: PersonRef = { id: "person-sam", name: "Sam" };

const NATAL_PLATE: ConversationPlate = {
  id: "plate-natal-robin",
  kind: "natal",
  chartId: "chart-robin-1",
  title: "Natal · Robin",
  provenance: "Placidus · 1990-05-02 14:32 · Malmö",
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Seams {
  readonly onSend: (text: string) => void;
  readonly presentPlate: (plateId: string) => void;
  readonly onUnlock: () => void;
  readonly onEnterCode: () => void;
  readonly onDownloadModel: () => void;
  readonly onRetry: () => void;
}

function makeSeams(): Seams {
  return {
    onSend: vi.fn<(text: string) => void>(),
    presentPlate: vi.fn<(plateId: string) => void>(),
    onUnlock: vi.fn<() => void>(),
    onEnterCode: vi.fn<() => void>(),
    onDownloadModel: vi.fn<() => void>(),
    onRetry: vi.fn<() => void>(),
  };
}

function mountScreen(
  seams: Seams,
  overrides: {
    readonly bus?: CompanionBus;
    readonly gate?: TrialGateResult;
    readonly initialTurns?: readonly Turn[];
    readonly person?: PersonRef;
    readonly people?: readonly PersonRef[];
    readonly plates?: readonly ConversationPlate[];
    readonly modelId?: string;
    readonly desktop?: boolean;
    readonly reducedMotion?: boolean;
  } = {},
): CompanionBus {
  const bus = overrides.bus ?? createCompanionBus();
  const sink: TranscriptSink = { list: () => overrides.initialTurns ?? [] };
  const props: ConversationScreenProps = {
    bus,
    gate: { state: "licensed" },
    sink,
    onSend: seams.onSend,
    presentPlate: seams.presentPlate,
    onUnlock: seams.onUnlock,
    onEnterCode: seams.onEnterCode,
    onDownloadModel: seams.onDownloadModel,
    onRetry: seams.onRetry,
    ...(overrides.gate === undefined ? {} : { gate: overrides.gate }),
    ...(overrides.person === undefined ? {} : { person: overrides.person }),
    ...(overrides.people === undefined ? {} : { people: overrides.people }),
    ...(overrides.plates === undefined ? {} : { plates: overrides.plates }),
    ...(overrides.modelId === undefined ? {} : { modelId: overrides.modelId }),
    ...(overrides.desktop === undefined ? {} : { desktop: overrides.desktop }),
    ...(overrides.reducedMotion === undefined ? {} : { reducedMotion: overrides.reducedMotion }),
  };
  act(() => {
    root.render(<ConversationScreen {...props} />);
  });
  return bus;
}

function publish(bus: CompanionBus, event: BusEvent): void {
  act(() => {
    bus.publish(event);
  });
}

function composerInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Message natally"]');
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitComposer(): void {
  const form = container.querySelector("form");
  if (form === null) {
    throw new Error("no composer form rendered");
  }
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function clickButton(selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (button === null) {
    throw new Error(`no element for ${selector}`);
  }
  act(() => {
    button.click();
  });
}

function textOf(selector: string): string {
  const element = container.querySelector(selector);
  if (element === null) {
    throw new Error(`no element for ${selector}`);
  }
  return element.textContent ?? "";
}

// ---------------------------------------------------------------------------
// The nine variants (SCREEN.md screen-conversation; LEDGER 13:2, 13:193,
// 13:215, 13:332, 13:448, 51:613, 51:727, 51:846, 26:430)
// ---------------------------------------------------------------------------

describe("conversation: 9 variants render against event scripts", () => {
  it("Idle — transcript grammar (her gilt-margin page text with computed mono, your orbglow hairline, tool mono) and a live composer", () => {
    const seams = makeSeams();
    const youTurn = makeTurn("you", "What does my chart say about mornings?");
    const bus = mountScreen(seams, {
      initialTurns: [youTurn],
      person: ROBIN,
    });
    publish(bus, { type: "turn", turn: makeTurn("her", "Venus rises at `12°` in the fourth.") });
    publish(bus, { type: "turn", turn: makeTurn("tool", "text #moon-phase → waxing gibbous") });

    const screen = container.querySelector('[data-screen="conversation"]');
    expect(screen?.getAttribute("data-variant")).toBe("idle");
    expect(container.querySelector('[data-stage="idle"]')).not.toBeNull();

    // Context chip: licensed → the person chip, never a trial chip.
    expect(container.querySelector('[data-testid="trial-chip"]')).toBeNull();
    expect(textOf('[data-testid="person-chip"]')).toBe("Robin");

    // Transcript order and roles: hydrated you turn, then the bus-fed her + tool.
    const roles = [...container.querySelectorAll("[data-turn]")].map((element) =>
      element.getAttribute("data-turn"),
    );
    expect(roles).toEqual(["you", "her", "tool"]);

    // Her turn: gilt glyph margin + Fraunces name, prose in her voice, the
    // computed fact inline as labelled Plex Mono (INC-19).
    const her = container.querySelector('[data-turn="her"]');
    expect(her?.querySelector("svg")).not.toBeNull(); // the gilt margin glyph
    expect(her?.textContent).toContain("Venus rises at");
    const computed = her?.querySelector('[data-provenance="computed"]');
    expect(computed?.textContent).toBe("12°");
    expect(computed?.className).toContain("IBM_Plex_Mono");

    // Your turn: right-aligned orbglow hairline (never gilt).
    const you = container.querySelector('[data-turn="you"]');
    expect(you?.textContent).toContain("mornings?");
    expect(you?.className).toContain("--color-orbglow");

    // Tool turn: quiet mono system line, labelled computed (§7.3).
    const tool = container.querySelector('[data-turn="tool"]');
    expect(tool?.getAttribute("data-provenance")).toBe("computed");
    expect(tool?.className).toContain("IBM_Plex_Mono");

    // Composer live: enter sends through the seam and clears the field.
    const input = composerInput();
    if (input === null) {
      throw new Error("composer input missing");
    }
    expect(input.disabled).toBe(false);
    typeInto(input, "What does my chart say about mornings?");
    submitComposer();
    expect(seams.onSend).toHaveBeenCalledTimes(1);
    expect(seams.onSend).toHaveBeenCalledWith("What does my chart say about mornings?");
    expect(composerInput()?.value).toBe("");
  });

  it("Thinking — first token flips the Stage, nothing shown until produced, composer inert", () => {
    const seams = makeSeams();
    const bus = mountScreen(seams);

    publish(bus, { type: "token", turnId: "turn-thinking", text: "" });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("thinking");
    expect(container.querySelector('[data-stage="thinking"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="streaming-indicator"]')?.textContent).toBe(
      "natally is writing",
    );
    expect(container.querySelector('[data-testid="streaming-turn"]')).toBeNull();
    expect(composerInput()?.disabled).toBe(true);

    // Production begins: the streamed draft renders her voice with the
    // computed span already in mono.
    publish(bus, { type: "token", turnId: "turn-thinking", text: "The Moon sits " });
    publish(bus, { type: "token", turnId: "turn-thinking", text: "`4°` from Pluto." });
    expect(container.querySelector('[data-testid="streaming-indicator"]')).toBeNull();
    const draft = container.querySelector('[data-testid="streaming-turn"]');
    expect(draft?.getAttribute("data-turn-id")).toBe("turn-thinking");
    expect(draft?.querySelector('[data-provenance="computed"]')?.textContent).toBe("4°");

    // The completed turn finalises the draft; a `turn` event never moves the
    // Stage (bus law) — still thinking until the pipeline says otherwise.
    publish(bus, {
      type: "turn",
      turn: makeTurn("her", "The Moon sits `4°` from Pluto.", "turn-thinking"),
    });
    expect(container.querySelector('[data-testid="streaming-turn"]')).toBeNull();
    const finalised = container.querySelector('[data-turn="her"]');
    expect(finalised?.querySelector('[data-provenance="computed"]')?.textContent).toBe("4°");
    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("thinking");
  });

  it("Speaking — envelope events drive the Stage ring state and mark the spoken line", () => {
    const seams = makeSeams();
    const bus = mountScreen(seams);
    publish(bus, {
      type: "turn",
      turn: makeTurn("her", "Your Moon rises tonight.", "turn-spoken"),
    });
    publish(bus, { type: "envelope", rms: 0.6 });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("speaking");
    expect(container.querySelector('[data-stage="speaking"]')).not.toBeNull();
    // The spoken line is her latest turn, marked speaking in the transcript.
    const spoken = container.querySelector('[data-speaking="true"]');
    expect(spoken?.querySelector('[data-turn="her"]')).not.toBeNull();
    expect(spoken?.textContent).toContain("Your Moon rises tonight.");
    // The envelope gates nothing about the composer (only asleep/error/think).
    expect(composerInput()?.disabled).toBe(false);
  });

  it("Asleep — model-load asleep renders the wake plate with the model row and Download, composer inert", () => {
    const seams = makeSeams();
    const bus = mountScreen(seams, { modelId: "natally-trial-q4f16" });
    publish(bus, { type: "model-load", phase: "asleep" });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("asleep");
    expect(container.querySelector('[data-stage="asleep"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wake-plate"]')).not.toBeNull();
    expect(textOf('[data-absence="asleep"]')).toBe(
      "natally wakes once her model is on this device.",
    );
    // The model row is a computed fact (the real designated id), Plex Mono.
    const modelRow = textOf('[data-testid="model-row"]');
    expect(modelRow).toContain("natally-trial-q4f16");
    expect(
      container.querySelector('[data-testid="model-row"] [data-provenance="computed"]'),
    ).not.toBeNull();
    clickButton('[data-testid="download-model"]');
    expect(seams.onDownloadModel).toHaveBeenCalledTimes(1);
    expect(composerInput()?.disabled).toBe(true);
  });

  it("Error — the engine's real reason lands in the ember-stroked plate, Try again through the seam", () => {
    const seams = makeSeams();
    const bus = mountScreen(seams);
    publish(bus, { type: "error", message: "engine: wasm trap — memory grow failed" });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("error");
    const plate = container.querySelector('[data-testid="error-plate"]');
    expect(plate).not.toBeNull();
    expect(plate?.className).toContain("--color-ember"); // ember-stroked
    expect(textOf('[data-testid="error-reason"]')).toBe("engine: wasm trap — memory grow failed");
    clickButton('[data-testid="try-again"]');
    expect(seams.onRetry).toHaveBeenCalledTimes(1);
    expect(composerInput()?.disabled).toBe(true);
  });

  it("TrialIdle — the chip reads the B.1 remaining count and the composer stays live", () => {
    const seams = makeSeams();
    const gate: TrialGateResult = { state: "trial-active", remaining: 2 };
    mountScreen(seams, { gate });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("trial-idle");
    const chip = container.querySelector('[data-testid="trial-chip"]');
    expect(chip?.getAttribute("data-gate")).toBe("trial-active");
    expect(chip?.textContent).toBe("Trial · 2");
    // The composer is live in TrialIdle: the gate is on readings, not on her.
    const input = composerInput();
    expect(input?.disabled).toBe(false);
    if (input === null) {
      throw new Error("composer input missing");
    }
    typeInto(input, "One more reading?");
    submitComposer();
    expect(seams.onSend).toHaveBeenCalledWith("One more reading?");
  });

  it("TrialExhausted — the composer is replaced by her aside, gilt Unlock, quiet code entry", () => {
    const seams = makeSeams();
    const gate: TrialGateResult = { state: "trial-exhausted" };
    mountScreen(seams, { gate });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("trial-exhausted");
    // Replacement block: no composer anywhere.
    expect(container.querySelector("form")).toBeNull();
    expect(composerInput()).toBeNull();
    expect(textOf('[data-absence="trial-exhausted"]')).toBe("Your three trial readings are used.");
    expect(textOf('[data-testid="unlock"]')).toBe("Unlock natally");
    expect(textOf('[data-testid="enter-code"]')).toBe("or enter a code");
    expect(container.querySelector('[data-testid="unlock"]')?.className).toContain("--color-gilt");
    clickButton('[data-testid="unlock"]');
    clickButton('[data-testid="enter-code"]');
    expect(seams.onUnlock).toHaveBeenCalledTimes(1);
    expect(seams.onEnterCode).toHaveBeenCalledTimes(1);
  });

  it("RateLimited — her aside names the computed next instant; the composer stays", () => {
    const seams = makeSeams();
    const nextReadingAt = new Date(2026, 8, 20, 9, 30).getTime();
    const gate: TrialGateResult = { state: "rate-limited", nextReadingAt };
    mountScreen(seams, { gate });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("rate-limited");
    const chip = container.querySelector('[data-testid="trial-chip"]');
    expect(chip?.getAttribute("data-gate")).toBe("rate-limited");
    expect(chip?.textContent).toBe("Trial");
    // Next-reading aside: date + runtime as a computed Plex Mono fact.
    const aside = container.querySelector('[data-testid="rate-limit-aside"]');
    expect(aside?.textContent).toContain("your next reading unlocks");
    const instant = aside?.querySelector('[data-provenance="computed"]');
    expect(instant?.textContent).toBe("2026-09-20 · 09:30");
    expect(instant?.className).toContain("IBM_Plex_Mono");
    // The gate is on readings, not on her: composer present and live.
    const input = composerInput();
    expect(input?.disabled).toBe(false);
    if (input === null) {
      throw new Error("composer input missing");
    }
    typeInto(input, "Hello again");
    submitComposer();
    expect(seams.onSend).toHaveBeenCalledWith("Hello again");
  });

  it("Desktop — fixed 430 Stage, Robin + Sam chips, plates laid on the page with Open", () => {
    const seams = makeSeams();
    mountScreen(seams, {
      desktop: true,
      people: [ROBIN, SAM],
      plates: [NATAL_PLATE],
    });

    expect(
      container.querySelector('[data-screen="conversation"]')?.getAttribute("data-variant"),
    ).toBe("desktop");
    const stageMount = container.querySelector('[data-testid="stage-mount"]');
    expect(stageMount?.className).toContain("w-[430px]");
    expect(stageMount?.className).toContain("self-center");
    const chips = [...container.querySelectorAll('[data-testid="person-chip"]')];
    expect(chips.map((chip) => chip.textContent)).toEqual(["Robin", "Sam"]);
    // Plates: midnight/2 cards with a computed provenance foot and Open.
    const plate = container.querySelector("article[data-ledger]");
    expect(plate?.textContent).toContain("Natal · Robin");
    expect(textOf("article footer [data-provenance='computed']")).toBe(
      "Placidus · 1990-05-02 14:32 · Malmö",
    );
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Open",
    );
    if (open === undefined) {
      throw new Error("plate Open button missing");
    }
    act(() => {
      open.click();
    });
    expect(seams.presentPlate).toHaveBeenCalledWith("plate-natal-robin");
  });
});

// ---------------------------------------------------------------------------
// Variant derivation law (variant.ts): real event states outrank gate states
// in both directions; Desktop is the resting licensed composition only.
// ---------------------------------------------------------------------------

describe("conversation: variant derivation precedence", () => {
  const licensed: TrialGateResult = { state: "licensed" };
  const exhausted: TrialGateResult = { state: "trial-exhausted" };

  it("an engine state is never masked by a billing state", () => {
    expect(deriveVariant({ stage: "error", gate: exhausted })).toBe("error");
    expect(deriveVariant({ stage: "thinking", gate: exhausted })).toBe("thinking");
    expect(deriveVariant({ stage: "asleep", gate: licensed })).toBe("asleep");
  });

  it("a trial state never claims the Stage and never outranks an event", () => {
    expect(deriveVariant({ stage: "idle", gate: exhausted })).toBe("trial-exhausted");
    expect(
      deriveVariant({ stage: "idle", gate: { state: "rate-limited", nextReadingAt: 1 } }),
    ).toBe("rate-limited");
    expect(deriveVariant({ stage: "idle", gate: { state: "trial-active", remaining: 3 } })).toBe(
      "trial-idle",
    );
  });

  it("Desktop is the resting licensed composition only", () => {
    expect(deriveVariant({ stage: "idle", gate: licensed, desktop: true })).toBe("desktop");
    expect(deriveVariant({ stage: "asleep", gate: licensed, desktop: true })).toBe("asleep");
    expect(deriveVariant({ stage: "idle", gate: exhausted, desktop: true })).toBe(
      "trial-exhausted",
    );
  });
});

// ---------------------------------------------------------------------------
// Route module contract (index.ts): "/" registers with the lazy loader and
// the documented conservative defaults.
// ---------------------------------------------------------------------------

describe("conversation: route module", () => {
  it("registers / with a lazy load contract and conservative defaults", async () => {
    resetRoutes();
    const routeModule = await import("./index");
    const registered = routeRegistry().get("/");
    if (registered === undefined) {
      throw new Error("route / was not registered by the screen module");
    }
    const loaded = await registered.load();
    expect(typeof loaded.default).toBe("function");
    // Default gate: trial-active with no fabricated count (never licensed).
    expect(routeModule.defaultGate).toEqual({ state: "trial-active" });
    expect(routeModule.defaultSink.list()).toEqual([]);
  });
});
