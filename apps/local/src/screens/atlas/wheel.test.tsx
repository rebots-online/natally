// @vitest-environment jsdom
// natally — U.3 verify: the wheel instrument (apps/local/src/ui/wheel.tsx)
// against fixture ChartFacts. Accept line: "atlas: 3 views render; wheel cusp
// angles match fixtures ±0.5°" (shared with atlas-screen.test.tsx; this file
// owns the component-level geometry half).
//
// The ±0.5° TR-1 rule is checked by parsing the rendered SVG transforms back
// out of the DOM and comparing them against angles recomputed here, from the
// fixture longitudes, with the documented formula (wheel.tsx geometry header):
//
//     spoke transform  A(λ) = (270 − λ) mod 360
//     inverse          λ(A) = (270 − A) mod 360
//
// Both directions are asserted so a bug in either the transform or the
// documented inverse cannot cancel out.

import { HOUSE_SYSTEMS } from "@natally/ephemeris/types";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AspectsTable, HouseSystemPicker, Wheel } from "../../ui/wheel";
import { CUSPS, cuspAt, OVERLAY_CUSPS, OVERLAY_FACTS, SOLAR_FACTS, TIMED_FACTS } from "./fixtures";

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

/** Normalize into [0, 360). */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The spoke rotate() degree the wheel must draw for longitude λ. */
function expectedSpokeAngle(lambda: number): number {
  return norm360(270 - lambda);
}

/** Shortest arc between two angles — the ±0.5° error measure (TR-1). */
function arcError(a: number, b: number): number {
  const d = Math.abs(norm360(a - b));
  return d > 180 ? 360 - d : d;
}

/** Parse the leading `rotate(A …)` degrees out of a rendered transform. */
function parseRotate(el: Element): number {
  const match = /rotate\((-?[\d.]+)/.exec(el.getAttribute("transform") ?? "");
  if (match === null || match[1] === undefined) {
    throw new Error(`no rotate() in transform: ${String(el.getAttribute("transform"))}`);
  }
  return Number(match[1]);
}

const q = (selector: string): Element | null => container.querySelector(selector);
const qa = (selector: string): Element[] => Array.from(container.querySelectorAll(selector));

describe("wheel: 272px structure; cusp transforms match fixtures ±0.5°; aspects exact; 12 house systems", () => {
  it("draws the zodiac ramp and 12 inner cusp spokes at the fixture angles ±0.5° (TR-1)", () => {
    mount(<Wheel facts={TIMED_FACTS} />);
    const svg = q('[data-testid="wheel"]');
    expect(svg?.getAttribute("width")).toBe("272");
    expect(svg?.getAttribute("height")).toBe("272");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 272 272");
    expect(svg?.getAttribute("data-wheel-cusps")).toBe("present");
    expect(svg?.getAttribute("data-wheel-overlay")).toBe("false");

    // Zodiac ramp: 12 sign segments in the frozen token ramp, no raw hex.
    const segments = qa("[data-wheel-sign]");
    expect(segments.map((s) => s.getAttribute("data-wheel-sign"))).toEqual([
      "aries",
      "taurus",
      "gemini",
      "cancer",
      "leo",
      "virgo",
      "libra",
      "scorpio",
      "sagittarius",
      "capricorn",
      "aquarius",
      "pisces",
    ]);
    for (const segment of segments) {
      const fill = segment.getAttribute("fill") ?? "";
      expect(fill).toMatch(/^var\(--color-z-[a-z]+\)$/);
    }

    // Cusp spokes: parsed rotate() ↔ fixture cusps, both directions, ±0.5°.
    const spokes = qa('[data-wheel-cusp][data-wheel-cusp-ring="inner"]');
    expect(spokes).toHaveLength(12);
    spokes.forEach((spoke, index) => {
      const cusp = cuspAt(CUSPS, index);
      const parsed = parseRotate(spoke);
      expect(arcError(parsed, expectedSpokeAngle(cusp))).toBeLessThanOrEqual(0.5);
      // The documented inverse recovers the fixture longitude itself.
      expect(arcError(norm360(270 - parsed), cusp)).toBeLessThanOrEqual(0.5);
      expect(spoke.getAttribute("data-wheel-cusp")).toBe(String(index + 1));
      expect(Number(spoke.getAttribute("data-wheel-cusp-angle"))).toBeCloseTo(parsed, 6);
    });

    // AC / MC labels sit on the primary chart's 1st / 10th cusp longitudes.
    const principal = TIMED_FACTS.cusps;
    if (principal === undefined) {
      throw new Error("fixture: timed facts must carry cusps");
    }
    const ac = q('[data-wheel-principal="AC"]');
    const mc = q('[data-wheel-principal="MC"]');
    expect(ac).not.toBeNull();
    expect(mc).not.toBeNull();
    expect(
      arcError(parseRotate(ac as Element), expectedSpokeAngle(principal.asc)),
    ).toBeLessThanOrEqual(0.5);
    expect(
      arcError(parseRotate(mc as Element), expectedSpokeAngle(principal.mc)),
    ).toBeLessThanOrEqual(0.5);
  });

  it("bi-wheel: the outer ring speaks the overlay chart's cusps ±0.5°", () => {
    mount(<Wheel facts={TIMED_FACTS} overlay={OVERLAY_FACTS} />);
    const svg = q('[data-testid="wheel"]');
    expect(svg?.getAttribute("data-wheel-overlay")).toBe("true");

    const inner = qa('[data-wheel-cusp][data-wheel-cusp-ring="inner"]');
    const outer = qa('[data-wheel-cusp][data-wheel-cusp-ring="outer"]');
    expect(inner).toHaveLength(12);
    expect(outer).toHaveLength(12);
    outer.forEach((spoke, index) => {
      const cusp = cuspAt(OVERLAY_CUSPS, index);
      expect(arcError(parseRotate(spoke), expectedSpokeAngle(cusp))).toBeLessThanOrEqual(0.5);
    });
    // The primary chart's spokes stay put underneath the overlay band.
    inner.forEach((spoke, index) => {
      const cusp = cuspAt(CUSPS, index);
      expect(arcError(parseRotate(spoke), expectedSpokeAngle(cusp))).toBeLessThanOrEqual(0.5);
    });
  });

  it("solar chart (time unknown): ring only — no cusps, no AC/MC, honest absence", () => {
    mount(<Wheel facts={SOLAR_FACTS} />);
    const svg = q('[data-testid="wheel"]');
    expect(svg?.getAttribute("data-wheel-cusps")).toBe("absent");
    expect(qa("[data-wheel-cusp]")).toHaveLength(0);
    expect(qa("[data-wheel-principal]")).toHaveLength(0);
    // The zodiac ramp itself is still the full 12-sign structure.
    expect(qa("[data-wheel-sign]")).toHaveLength(12);
  });

  it("aspects table rows carry exactly the computed fields — no score, no label (INC-19)", () => {
    mount(<AspectsTable aspects={TIMED_FACTS.aspects} heading="Aspects" />);
    const table = q('[data-testid="aspects-table"]');
    expect(table?.getAttribute("data-aspect-count")).toBe("2");

    const expectedAttributes = [
      "class",
      "data-testid",
      "data-aspect-a",
      "data-aspect-b",
      "data-aspect-type",
      "data-orb",
      "data-direction",
    ].sort();
    const rows = qa('[data-testid="aspect-row"]');
    expect(rows).toHaveLength(2);

    const [first, second] = rows;
    expect(first?.getAttribute("data-aspect-a")).toBe("sun");
    expect(first?.getAttribute("data-aspect-b")).toBe("moon");
    expect(first?.getAttribute("data-aspect-type")).toBe("square");
    expect(first?.getAttribute("data-orb")).toBe("0.25");
    expect(first?.getAttribute("data-direction")).toBe("applying");
    expect(second?.getAttribute("data-aspect-a")).toBe("sun");
    expect(second?.getAttribute("data-aspect-b")).toBe("saturn");
    expect(second?.getAttribute("data-aspect-type")).toBe("opposition");
    expect(second?.getAttribute("data-direction")).toBe("separating");
    for (const row of rows) {
      expect(
        Array.from(row.attributes)
          .map((a) => a.name)
          .sort(),
      ).toEqual(expectedAttributes);
    }

    // Cell text: orb in degrees, direction word, pair as three glyphs.
    expect(first?.textContent).toContain("0.25°");
    expect(first?.textContent).toContain("applying");
    expect(second?.textContent).toContain("separating");
    expect(first?.querySelectorAll("svg")).toHaveLength(3);

    // INC-19: no score, no compatibility/interpretation label anywhere.
    expect(table?.textContent ?? "").not.toMatch(/score|compatib|interpret/i);
  });

  it("aspects table with no rows renders the honest-absence note", () => {
    mount(
      <AspectsTable
        aspects={[]}
        heading="Cross aspects"
        emptyNote="No cross aspects within orb."
      />,
    );
    const table = q('[data-testid="aspects-table"]');
    expect(table?.getAttribute("data-aspect-count")).toBe("0");
    expect(q('[data-absence="no-aspects"]')?.textContent).toContain("No cross aspects within orb.");
    expect(qa('[data-testid="aspect-row"]')).toHaveLength(0);
  });

  it("house-system picker: exactly the 12 engine systems; selection reports back", () => {
    const onSelect = vi.fn();
    mount(<HouseSystemPicker value="W" onSelect={onSelect} />);
    const picker = q('[data-testid="house-system-picker"]');
    // fieldset carries the group role implicitly (semantic group element).
    expect(picker?.tagName).toBe("FIELDSET");

    const chips = qa("[data-house-system]");
    expect(chips).toHaveLength(12);
    expect(new Set(chips.map((c) => c.getAttribute("data-house-system")))).toEqual(
      new Set<string>(HOUSE_SYSTEMS),
    );
    const placidus = chips.find((c) => c.getAttribute("data-house-system") === "P");
    expect(placidus?.textContent).toContain("Placidus");

    // aria-pressed marks exactly the selected system.
    for (const chip of chips) {
      const selected = chip.getAttribute("data-house-system") === "W";
      expect(chip.getAttribute("aria-pressed")).toBe(selected ? "true" : "false");
    }

    // Selecting the Koch chip reports "K" through the callback.
    const koch = chips.find((c) => c.getAttribute("data-house-system") === "K");
    expect(koch).toBeDefined();
    act(() => {
      (koch as Element).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("K");
  });
});
