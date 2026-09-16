// @vitest-environment jsdom
// natally — U.4 verify. Accept line:
// "intake: 4-step flow yields Person + first computed fact; unknown-time branch".
//
// The 4-step conversational intake runs over REAL X.1 repositories (in-memory
// better-sqlite3, migrate on open — the established data.test.ts pattern); the
// P.4 compute seam is a deterministic fake behind the structural
// FirstLightCompute contract (the real buildFacts over the §6 engine is the
// wiring layer's binding). The known-time branch asserts the Person row and
// the rendered first computed fact; the unknown-time branch asserts
// timeKnown=false and the no-houses fact (J1 solar consequence).

import type { ChartFacts } from "@natally/ephemeris/types";
import type { Person } from "@natally/lore/types";
import Database from "better-sqlite3";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppDb, openAppDb } from "../../data/db";
import { FirstLightScreen } from "./first-light-screen";
import type { FirstLightCompute, IntakeStep } from "./types";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Deterministic fake compute (the structural FirstLightCompute contract)
// ---------------------------------------------------------------------------

const factLog: IntakeStep[] = [];
const chartRequests: Person[] = [];

const compute: FirstLightCompute = {
  instantFact(step, answers) {
    factLog.push(step);
    switch (step) {
      case "name":
        return {
          provenance: "absence",
          text: "A name alone computes nothing yet — the chart needs a birth date.",
        };
      case "date":
        return { provenance: "computed", glyph: "taurus", text: "Sun in Taurus" };
      case "place":
        return {
          provenance: "absence",
          text: "The place orients the sky — no new fact on its own.",
        };
      case "time":
        return answers.timeKnown === false
          ? {
              provenance: "absence",
              text: "No birth time — a solar chart: no rising sign, no houses; the planets stay exact.",
            }
          : { provenance: "computed", text: "Ascendant 14.30° Leo" };
    }
  },

  async chartFacts(person) {
    chartRequests.push(person);
    const solar = !person.birth.timeKnown;
    const facts: ChartFacts = {
      id: "sha256:test",
      inputs: {
        ut: [2447983.5],
        place: { lat: 41.15, lon: -8.61 },
        system: solar ? "W" : "P",
      },
      positions: [{ body: "sun", lon: 41.42, lat: 0, speed: 0.97 }],
      aspects: [],
      ...(solar
        ? {}
        : {
            cusps: {
              cusps: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
              asc: 134.3,
              mc: 44.3,
              armc: 43.9,
            },
          }),
    };
    return facts;
  },
};

// ---------------------------------------------------------------------------
// jsdom mount harness (the established stage.test.tsx pattern)
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;
let app: AppDb;
let idCounter: number;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  app = openAppDb(new Database(":memory:"));
  idCounter = 0;
  factLog.length = 0;
  chartRequests.length = 0;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const q = (selector: string): Element | null => container.querySelector(selector);

function mount(jsx: ReactNode): void {
  act(() => {
    root.render(jsx);
  });
}

function type(input: Element | null, value: string): void {
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("test: expected the intake input");
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Fires the intake form's submit (the Continue affordance). */
function submit(): void {
  const form = q("form");
  if (form === null) {
    throw new Error("test: expected the intake form");
  }
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function clickAsync(button: Element | null): Promise<void> {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("test: expected a button");
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

function screen(): ReactNode {
  return (
    <FirstLightScreen
      peopleRepo={app.people}
      compute={compute}
      newPersonId={() => {
        idCounter += 1;
        return `person-test-${idCounter}`;
      }}
    />
  );
}

/** Walks name → date → place, leaving the time step current. */
function walkToTimeStep(): void {
  mount(screen());
  type(q('[data-testid="intake-input"]'), "Robin");
  submit();
  type(q('[data-testid="intake-input"]'), "1990-05-02");
  submit();
  type(q('[data-testid="intake-input"]'), "Porto, PT");
  submit();
}

// ---------------------------------------------------------------------------
// The Accept: 4-step flow yields Person + first computed fact; unknown time
// ---------------------------------------------------------------------------

describe("intake: 4-step flow yields Person + first computed fact; unknown-time branch", () => {
  it("known time: creates the Person row and renders the first computed fact", async () => {
    walkToTimeStep();

    // Instant facts appeared after each answer; the date answer yields the
    // computed Sun fact, the name answer only the honest absence note.
    expect(factLog).toEqual(["name", "date", "place"]);
    expect(q('[data-testid="fact-name"]')?.getAttribute("data-provenance")).toBe("absence");
    expect(q('[data-testid="fact-date"]')?.getAttribute("data-provenance")).toBe("computed");
    expect(q('[data-testid="fact-date"]')?.textContent).toContain("Sun in Taurus");
    // Privacy explainer: two authored lanes under each question.
    expect(q('[data-testid="privacy-name"]')?.getAttribute("data-provenance")).toBe("authored");
    expect(q('[data-testid="privacy-name"] [data-lane="local"]')).not.toBeNull();

    type(q('[data-testid="intake-input"]'), "14:30");
    submit(); // the known-time branch completes the intake
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Person row through the real X.1 repo — the caller-owned id was minted.
    const people = app.people.list();
    expect(people).toHaveLength(1);
    const person = people[0];
    expect(person?.id).toBe("person-test-1");
    expect(person?.name).toBe("Robin");
    expect(person?.birth).toEqual({
      date: "1990-05-02",
      time: "14:30",
      place: "Porto, PT",
      timeKnown: true,
    });

    // First ChartFacts went through the injected compute with that person.
    expect(chartRequests).toHaveLength(1);
    expect(chartRequests[0]?.id).toBe("person-test-1");

    // The first computed fact is rendered as computed material; a timed chart
    // has cusps, so no solar-absence note is shown.
    expect(q('[data-testid="intake-complete"]')?.getAttribute("data-person-id")).toBe(
      "person-test-1",
    );
    const firstFact = q('[data-testid="first-fact"]');
    expect(firstFact?.getAttribute("data-provenance")).toBe("computed");
    expect(firstFact?.textContent).toContain("Sun 11.42° Taurus");
    expect(q('[data-testid="no-houses"]')).toBeNull();
  });

  it("unknown time: timeKnown=false in the row and the no-houses fact", async () => {
    walkToTimeStep();
    await clickAsync(q('[data-testid="intake-time-unknown"]'));

    const person = app.people.list()[0];
    expect(person?.name).toBe("Robin");
    expect(person?.birth.timeKnown).toBe(false);
    expect(person?.birth.time).toBeUndefined();

    // J1 solar consequence: the absence fact under the time answer AND the
    // completion's no-houses line; the fake solar facts carry no cusps.
    expect(q('[data-testid="fact-time"]')?.getAttribute("data-provenance")).toBe("absence");
    expect(q('[data-testid="fact-time"]')?.textContent).toContain("no houses");
    expect(q('[data-testid="intake-complete"]')).not.toBeNull();
    expect(q('[data-testid="no-houses"]')?.getAttribute("data-provenance")).toBe("absence");
    expect(q('[data-testid="no-houses"]')?.textContent).toContain("no house cusps");
    expect(q('[data-testid="first-fact"]')?.textContent).toContain("Sun 11.42° Taurus");
  });

  it("edit: an initial person is prefilled and updated in place, id kept", async () => {
    const existing: Person = {
      id: "person-keep",
      name: "Robin",
      birth: { date: "1990-05-02", time: "14:30", place: "Porto, PT", timeKnown: true },
    };
    app.people.create(existing);
    mount(
      <FirstLightScreen
        peopleRepo={app.people}
        compute={compute}
        newPersonId={() => "never-minted"}
        mode="add-person"
        initial={existing}
      />,
    );
    type(q('[data-testid="intake-input"]'), "Robin Vidal");
    submit();
    type(q('[data-testid="intake-input"]'), "1990-05-02");
    submit();
    type(q('[data-testid="intake-input"]'), "Porto, PT");
    submit();
    type(q('[data-testid="intake-input"]'), "14:30");
    submit();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const people = app.people.list();
    expect(people).toHaveLength(1);
    expect(people[0]?.id).toBe("person-keep");
    expect(people[0]?.name).toBe("Robin Vidal");
  });
});
