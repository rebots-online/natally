// @vitest-environment jsdom
// natally — U.3 verify (atlas screens). Accept line, printed by the describe
// below: "atlas: 3 views render; wheel cusp angles match fixtures ±0.5°".
// The cusp check parses the rendered SVG transforms back out of the DOM and
// compares them against angles recomputed here from the fixture longitudes
// (spoke transform A(λ) = (270 − λ) mod 360, wheel.tsx geometry header).

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchRoute, routeRegistry } from "../../ui/router";
import AtlasRoute from "./atlas-route";
import { AtlasScreen } from "./atlas-screen";
import { chartMomentIso } from "./chart-math";
import {
  CROSS_ASPECTS,
  CUSPS,
  cuspAt,
  OVERLAY_FACTS,
  PERSON_OVERLAY,
  PERSON_TIMED,
  PERSON_UNTIMED,
  SOLAR_FACTS,
  TIMED_FACTS,
} from "./fixtures";
// Importing the barrel is what registers the /atlas/:plate route (frozen set).
import "./index";

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

describe("atlas: 3 views render; wheel cusp angles match fixtures ±0.5°", () => {
  it("renders the natal, synastry and today views from computed facts", () => {
    // Each mount re-renders the same root, so views are re-queried live.
    const screen = () => q('[data-testid="atlas-screen"]');

    // — natal: wheel + Positions + Houses + Aspects + the 12-system picker.
    mount(
      <AtlasScreen
        params={{}}
        view="natal"
        person={PERSON_TIMED}
        facts={TIMED_FACTS}
        houseSystem="P"
      />,
    );
    expect(screen()?.getAttribute("data-atlas-view")).toBe("natal");
    expect(q('[data-testid="wheel"]')?.getAttribute("data-wheel-cusps")).toBe("present");

    const positions = qa('[data-testid="position-row"]');
    expect(positions).toHaveLength(4);
    const sun = positions.find((r) => r.getAttribute("data-body") === "sun");
    expect(sun?.getAttribute("data-sign")).toBe("aries"); // lon 10.5 = 10.50° Aries
    expect(sun?.getAttribute("data-degree")).toBe("10.50°");
    expect(sun?.getAttribute("data-house")).toBe("1");
    expect(sun?.getAttribute("data-speed")).toBe("+0.970°/d");
    const mars = positions.find((r) => r.getAttribute("data-body") === "mars");
    expect(mars?.getAttribute("data-house")).toBe("11");
    expect(mars?.getAttribute("data-speed")).toBe("-0.450°/d");
    expect(mars?.querySelectorAll("svg")).toHaveLength(1); // retrograde glyph

    const houses = qa('[data-testid="house-row"]');
    expect(houses).toHaveLength(12);
    expect(houses[0]?.getAttribute("data-house")).toBe("1");
    expect(houses[0]?.getAttribute("data-sign")).toBe("aries");
    expect(houses[9]?.getAttribute("data-house")).toBe("10");
    expect(houses[9]?.getAttribute("data-sign")).toBe("capricorn");

    expect(q('[data-testid="aspects-table"]')?.getAttribute("data-aspect-count")).toBe("2");
    expect(qa("[data-house-system]")).toHaveLength(12);

    // — synastry: two chips, bi-wheel, cross aspects, overlays both ways.
    mount(
      <AtlasScreen
        params={{}}
        view="synastry"
        person={PERSON_TIMED}
        facts={TIMED_FACTS}
        otherPerson={PERSON_OVERLAY}
        otherFacts={OVERLAY_FACTS}
        crossAspects={CROSS_ASPECTS}
      />,
    );
    expect(screen()?.getAttribute("data-atlas-view")).toBe("synastry");
    expect(qa('[data-testid="synastry-people"] [data-active="true"]')).toHaveLength(2);
    expect(q('[data-testid="wheel"]')?.getAttribute("data-wheel-overlay")).toBe("true");
    expect(qa('[data-testid="aspect-row"]')).toHaveLength(1);
    expect(qa('[data-testid="overlay-table"]')).toHaveLength(2);

    // — today: moment line, bi-wheel, hits.
    mount(
      <AtlasScreen
        params={{}}
        view="today"
        person={PERSON_TIMED}
        facts={TIMED_FACTS}
        todayFacts={OVERLAY_FACTS}
        hits={CROSS_ASPECTS}
      />,
    );
    expect(screen()?.getAttribute("data-atlas-view")).toBe("today");
    expect(q('[data-testid="today-moment"]')?.textContent).toBe(
      "2023-02-26T00:00:00.000Z · 51.50°N 0.12°W",
    );
    expect(q('[data-testid="wheel"]')?.getAttribute("data-wheel-overlay")).toBe("true");
    expect(q('[data-testid="aspects-table"]')?.getAttribute("data-aspect-count")).toBe("1");
  });

  it("wheel cusp angles match fixture ChartFacts within ±0.5° (transforms parsed from the DOM)", () => {
    mount(<AtlasScreen params={{}} view="natal" person={PERSON_TIMED} facts={TIMED_FACTS} />);
    const spokes = qa('[data-wheel-cusp][data-wheel-cusp-ring="inner"]');
    expect(spokes).toHaveLength(12);
    spokes.forEach((spoke, index) => {
      const cusp = cuspAt(CUSPS, index);
      const parsed = parseRotate(spoke);
      expect(arcError(parsed, expectedSpokeAngle(cusp))).toBeLessThanOrEqual(0.5);
      expect(arcError(norm360(270 - parsed), cusp)).toBeLessThanOrEqual(0.5);
    });
    const ac = q('[data-wheel-principal="AC"]');
    const mc = q('[data-wheel-principal="MC"]');
    expect(ac).not.toBeNull();
    expect(mc).not.toBeNull();
    const cusps = TIMED_FACTS.cusps;
    if (cusps === undefined) {
      throw new Error("fixture: timed facts must carry cusps");
    }
    expect(arcError(parseRotate(ac as Element), expectedSpokeAngle(cusps.asc))).toBeLessThanOrEqual(
      0.5,
    );
    expect(arcError(parseRotate(mc as Element), expectedSpokeAngle(cusps.mc))).toBeLessThanOrEqual(
      0.5,
    );
  });

  it("time unknown: solar chart hides cusps/AC/MC and the Houses table is honest absence (J1/J3)", () => {
    mount(<AtlasScreen params={{}} view="natal" person={PERSON_UNTIMED} facts={SOLAR_FACTS} />);
    expect(q('[data-testid="wheel"]')?.getAttribute("data-wheel-cusps")).toBe("absent");
    expect(qa("[data-wheel-cusp]")).toHaveLength(0);
    expect(qa("[data-wheel-principal]")).toHaveLength(0);
    expect(q('[data-testid="houses-table"]')).toBeNull();
    expect(q('[data-testid="houses-absence"]')?.textContent).toContain("no Ascendant, no MC");
    for (const row of qa('[data-testid="position-row"]')) {
      expect(row.getAttribute("data-house")).toBe("absent");
    }
  });

  it("synastry one-directional overlays: into the untimed person not computed, the other way still computed (J4)", () => {
    mount(
      <AtlasScreen
        params={{}}
        view="synastry"
        person={PERSON_TIMED}
        facts={TIMED_FACTS}
        otherPerson={PERSON_UNTIMED}
        otherFacts={SOLAR_FACTS}
        crossAspects={[]}
      />,
    );
    // Noon has no birth time: overlays INTO Noon's houses are absent…
    const absences = qa('[data-testid="overlay-absence"] [data-absence="overlay-time-unknown"]');
    expect(absences).toHaveLength(1);
    expect(absences[0]?.textContent).toContain("Noon");
    // …while Noon's planets in Robin's houses are still computed (all four of
    // Noon's bodies place into Robin's houses: sun → 1, moon → 4, mars → 11,
    // saturn → 7).
    const computed = qa('[data-testid="overlay-table"]');
    expect(computed).toHaveLength(1);
    const rows = computed[0]?.querySelectorAll('[data-testid="overlay-row"]');
    expect(rows?.length).toBe(4);
    const byBody = new Map(
      Array.from(rows ?? []).map((r) => [
        r.getAttribute("data-body"),
        r.getAttribute("data-house"),
      ]),
    );
    expect(byBody.get("sun")).toBe("1");
    expect(byBody.get("moon")).toBe("4");
    expect(byBody.get("mars")).toBe("11");
    expect(byBody.get("saturn")).toBe("7");
    // Empty cross-aspect table renders its honest absence, never a blank score row.
    expect(q('[data-absence="no-aspects"]')).not.toBeNull();
    expect(container.textContent ?? "").not.toMatch(/score|compatib|interpret/i);
  });

  it("today with no person: labelled absence and the People action (J5)", () => {
    const onOpenPeople = vi.fn();
    mount(<AtlasScreen params={{}} view="today" onOpenPeople={onOpenPeople} />);
    expect(q('[data-absence="no-person"]')).not.toBeNull();
    const action = q('[data-testid="atlas-people-action"]');
    expect(action).not.toBeNull();
    click(action as Element);
    expect(onOpenPeople).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="wheel"]')).toBeNull();
  });

  it("engine error: the ember reason line, no fabricated facts", () => {
    mount(<AtlasScreen params={{}} view="natal" person={PERSON_TIMED} error="sweph init failed" />);
    expect(q('[data-error-detail="sweph init failed"]')?.textContent).toContain(
      "The chart engine failed: sweph init failed",
    );
    expect(q('[data-testid="wheel"]')).toBeNull();
    expect(q('[data-testid="positions-table"]')).toBeNull();
  });

  it("registers /atlas/:plate; the route adapter mounts the natal view with the labelled absence (J9)", () => {
    const definition = routeRegistry().get("/atlas/:plate");
    expect(definition).toBeDefined();
    expect(matchRoute("#/atlas/chart-fixture-timed")).toEqual({
      path: "/atlas/:plate",
      params: { plate: "chart-fixture-timed" },
    });

    act(() => {
      root.render(<AtlasRoute params={{ plate: "chart-fixture-timed" }} />);
    });
    const screen = q('[data-testid="atlas-screen"]');
    expect(screen?.getAttribute("data-atlas-view")).toBe("natal");
    expect(screen?.getAttribute("data-plate")).toBe("chart-fixture-timed");
    // No chart data provider yet: honest absence, no fabricated chart (INC-19).
    expect(q('[data-absence="no-chart"]')?.textContent).toContain(
      "No chart is loaded for this plate yet.",
    );
    // The moment helper the today view uses stays exact for the fixture.
    expect(chartMomentIso(OVERLAY_FACTS)).toBe("2023-02-26T00:00:00.000Z");
  });
});
