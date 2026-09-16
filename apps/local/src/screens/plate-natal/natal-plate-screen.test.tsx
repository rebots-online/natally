// @vitest-environment jsdom
// natally — U.3 verify (the natal plate as laid in the transcript, SCREEN.md
// screen-plate-natal). Accept line (shared with the atlas suite): "atlas: 3
// views render; wheel cusp angles match fixtures ±0.5°" — this file owns the
// plate-card variants (withHouses · timeUnknown), the provenance foot and the
// Open action.

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSON_TIMED, PERSON_UNTIMED, SOLAR_FACTS, TIMED_FACTS } from "../atlas/fixtures";
import { NatalPlateScreen, natalPlateProvenance } from "./natal-plate-screen";

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

function mount(ui: ReactElement): void {
  act(() => {
    root.render(ui);
  });
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const q = (selector: string): Element | null => container.querySelector(selector);
const qa = (selector: string): Element[] => Array.from(container.querySelectorAll(selector));

/** Parse the leading `rotate(A …)` degrees out of a rendered transform. */
function parseRotate(el: Element): number {
  const match = /rotate\((-?[\d.]+)/.exec(el.getAttribute("transform") ?? "");
  if (match === null || match[1] === undefined) {
    throw new Error(`no rotate() in transform: ${String(el.getAttribute("transform"))}`);
  }
  return Number(match[1]);
}

describe("plate-natal: withHouses and timeUnknown variants render", () => {
  it("withHouses: wheel with cusps and AC/MC, computed provenance foot, Open action", () => {
    const onOpen = vi.fn();
    mount(<NatalPlateScreen person={PERSON_TIMED} facts={TIMED_FACTS} onOpen={onOpen} />);

    const plate = q('[data-testid="natal-plate"]');
    expect(plate?.getAttribute("data-variant")).toBe("withHouses");
    expect(q("h3")?.textContent).toBe("Robin");
    expect(q('[data-provenance="computed"]')?.textContent).toBe(
      "Placidus · 1990-05-02 · 14:32 · Malmö",
    );

    // The wheel structure: cusps at the fixture angles, principal labels on.
    const wheel = q('[data-testid="wheel"]');
    expect(wheel?.getAttribute("width")).toBe("272");
    expect(wheel?.getAttribute("data-wheel-cusps")).toBe("present");
    const spokes = qa('[data-wheel-cusp][data-wheel-cusp-ring="inner"]');
    expect(spokes).toHaveLength(12);
    const first = parseRotate(spokes[0] as Element); // cusp 1 = 0° ⇒ rotate 270°
    expect(Math.abs(first - 270)).toBeLessThanOrEqual(0.5);
    expect(q('[data-wheel-principal="AC"]')).not.toBeNull();
    expect(q('[data-wheel-principal="MC"]')).not.toBeNull();

    // Open slides the plate into the Atlas (J2).
    const open = qa("button").find((b) => b.textContent === "Open");
    expect(open).toBeDefined();
    click(open as Element);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // INC-19: a plate carries computed facts and provenance, never a verdict.
    expect(container.textContent ?? "").not.toMatch(/score|compatib|interpret/i);
  });

  it("timeUnknown: ring-only wheel, solar-chart provenance foot, honest absence", () => {
    mount(<NatalPlateScreen person={PERSON_UNTIMED} facts={SOLAR_FACTS} onOpen={vi.fn()} />);
    expect(q('[data-testid="natal-plate"]')?.getAttribute("data-variant")).toBe("timeUnknown");
    expect(q('[data-provenance="computed"]')?.textContent).toBe(
      "time unknown · solar chart · 1985-11-20 · Leeds",
    );
    expect(q('[data-testid="wheel"]')?.getAttribute("data-wheel-cusps")).toBe("absent");
    expect(qa("[data-wheel-cusp]")).toHaveLength(0);
    expect(qa("[data-wheel-principal]")).toHaveLength(0);
    // The zodiac ramp itself is still the full structure.
    expect(qa("[data-wheel-sign]")).toHaveLength(12);
  });

  it("natalPlateProvenance emits exactly the computed inputs it was cast from", () => {
    expect(natalPlateProvenance(PERSON_TIMED, TIMED_FACTS)).toBe(
      "Placidus · 1990-05-02 · 14:32 · Malmö",
    );
    expect(natalPlateProvenance(PERSON_UNTIMED, SOLAR_FACTS)).toBe(
      "time unknown · solar chart · 1985-11-20 · Leeds",
    );
  });
});
