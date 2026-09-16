// @vitest-environment jsdom
// natally — U.8 tests: the splash binds its progress ONLY to the injected
// engine mount-event seam (no fabricated progress), renders pct only when the
// source provides it, and routes exactly once on the terminal ready event by
// the injected people count. Accept line:
// "splash: progress binds to engine events; routes by people count".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./splash-screen";
import {
  createSilentEngineEvents,
  type SplashEngineEvent,
  type SplashEngineEvents,
  type SplashScreenProps,
} from "./types";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.location.hash = "";
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const q = (selector: string): Element | null => container.querySelector(selector);

/** Scriptable engine source: captures the subscriber for manual emits. */
function fakeEngineEvents(): {
  readonly source: SplashEngineEvents;
  readonly emit: (event: SplashEngineEvent) => void;
  readonly unsubscribed: () => boolean;
} {
  let sink: ((event: SplashEngineEvent) => void) | null = null;
  let gone = false;
  return {
    source: {
      subscribe(fn) {
        sink = fn;
        return () => {
          sink = null;
          gone = true;
        };
      },
    },
    emit: (event) => {
      sink?.(event);
    },
    unsubscribed: () => gone,
  };
}

function renderSplash(props: SplashScreenProps): void {
  act(() => {
    root.render(<SplashScreen {...props} />);
  });
}

function emit(engine: ReturnType<typeof fakeEngineEvents>, event: SplashEngineEvent): void {
  act(() => {
    engine.emit(event);
  });
}

describe("splash: progress binds to engine events; routes by people count", () => {
  it("progress binds to scripted engine events (mounting → mounted), pct only when provided", () => {
    const engine = fakeEngineEvents();
    renderSplash({ engineEvents: engine.source, onFirstLight: vi.fn(), onConversation: vi.fn() });

    // Before any event: honest absence — indeterminate bar, no pct text ever.
    expect(q('[data-absence="engine-silent"]')).not.toBeNull();
    expect(q('[data-testid="splash-progress"]')?.getAttribute("data-indeterminate")).toBe("true");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow")).toBeNull();
    expect(q('[data-testid="splash-pct"]')).toBeNull();

    // mounting with a real pct → determinate, pct text rendered.
    emit(engine, { stage: "mounting", table: "moons", pct: 25 });
    expect(q('[data-testid="splash-load"]')?.textContent).toBe("mounting · moons");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("data-indeterminate")).toBe("false");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow")).toBe("25");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("style")).toContain("width: 25%");
    expect(q('[data-testid="splash-pct"]')?.textContent).toBe("25%");

    // Next real event moves the bar — the bar follows the events, nothing else.
    emit(engine, { stage: "mounting", table: "sun", pct: 60 });
    expect(q('[data-testid="splash-load"]')?.textContent).toBe("mounting · sun");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow")).toBe("60");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("style")).toContain("width: 60%");
    expect(q('[data-testid="splash-pct"]')?.textContent).toBe("60%");

    // A mounting event WITHOUT pct → indeterminate again; pct text disappears.
    emit(engine, { stage: "mounting", table: "houses" });
    expect(q('[data-testid="splash-load"]')?.textContent).toBe("mounting · houses");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("data-indeterminate")).toBe("true");
    expect(q('[data-testid="splash-progress"]')?.getAttribute("aria-valuenow")).toBeNull();
    expect(q('[data-testid="splash-progress"]')?.getAttribute("style") ?? "").not.toContain(
      "width",
    );
    expect(q('[data-testid="splash-pct"]')).toBeNull();

    // mounted with pct → still event-bound.
    emit(engine, { stage: "mounted", table: "houses", pct: 100 });
    expect(q('[data-testid="splash-load"]')?.textContent).toBe("mounted · houses");
    expect(q('[data-testid="splash-pct"]')?.textContent).toBe("100%");

    // ready is terminal: phase flips, no table/pct claimed beyond the events.
    emit(engine, { stage: "ready" });
    expect(q('[data-screen="splash"]')?.getAttribute("data-phase")).toBe("ready");
    expect(q('[data-testid="splash-load"]')?.textContent).toBe("ready");
    expect(q('[data-testid="splash-pct"]')).toBeNull();
  });

  it("no engine events ⇒ no progress renders, no navigation ever fires", () => {
    const engine = createSilentEngineEvents();
    const onFirstLight = vi.fn();
    const onConversation = vi.fn();
    renderSplash({ engineEvents: engine, onFirstLight, onConversation });

    expect(q('[data-screen="splash"]')?.getAttribute("data-phase")).toBe("loading");
    expect(q('[data-absence="engine-silent"]')).not.toBeNull();
    expect(q('[data-testid="splash-progress"]')?.getAttribute("data-indeterminate")).toBe("true");
    expect(q('[data-testid="splash-pct"]')).toBeNull();
    expect(onFirstLight).not.toHaveBeenCalled();
    expect(onConversation).not.toHaveBeenCalled();
  });

  it("unsubscribe happens on unmount (no leaked subscription)", () => {
    const engine = fakeEngineEvents();
    renderSplash({ engineEvents: engine.source });
    expect(engine.unsubscribed()).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(engine.unsubscribed()).toBe(true);
  });

  it("ready with 0 people routes to first-light, exactly once", () => {
    const engine = fakeEngineEvents();
    const countPeople = vi.fn((): number => 0);
    const onFirstLight = vi.fn();
    const onConversation = vi.fn();
    renderSplash({ engineEvents: engine.source, countPeople, onFirstLight, onConversation });

    emit(engine, { stage: "mounting", table: "moons", pct: 40 });
    emit(engine, { stage: "ready" });
    expect(countPeople).toHaveBeenCalledTimes(1);
    expect(onFirstLight).toHaveBeenCalledTimes(1);
    expect(onConversation).not.toHaveBeenCalled();

    // A stray second ready never routes twice.
    emit(engine, { stage: "ready" });
    expect(onFirstLight).toHaveBeenCalledTimes(1);
  });

  it('ready with ≥1 person routes to conversation (default: hash to "/")', () => {
    const engine = fakeEngineEvents();
    const countPeople = vi.fn((): number => 2);
    const onFirstLight = vi.fn();
    renderSplash({ engineEvents: engine.source, countPeople, onFirstLight });

    emit(engine, { stage: "ready" });
    expect(countPeople).toHaveBeenCalledTimes(1);
    expect(onFirstLight).not.toHaveBeenCalled();
    // The injected conversation callback was absent, so the default used the
    // one navigation system: the hash router's home path.
    expect(window.location.hash).toBe("#/");

    emit(engine, { stage: "ready" });
    expect(window.location.hash).toBe("#/");
  });

  it("explicit onConversation wins over the default, and desktop variant renders", () => {
    const engine = fakeEngineEvents();
    const onFirstLight = vi.fn();
    const onConversation = vi.fn();
    renderSplash({
      engineEvents: engine.source,
      countPeople: (): number => 3,
      onFirstLight,
      onConversation,
      variant: "desktop",
    });

    expect(q('[data-screen="splash"]')?.getAttribute("data-variant")).toBe("desktop");
    emit(engine, { stage: "ready" });
    expect(onConversation).toHaveBeenCalledTimes(1);
    expect(onFirstLight).not.toHaveBeenCalled();

    // Default variant is mobile.
    const mobile = fakeEngineEvents();
    renderSplash({ engineEvents: mobile.source });
    expect(q('[data-screen="splash"]')?.getAttribute("data-variant")).toBe("mobile");
  });
});
