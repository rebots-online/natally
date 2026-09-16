// @vitest-environment jsdom
// natally — U.4 verify, PeopleScreen. Real X.1 repositories over in-memory
// better-sqlite3 (the established pattern): list anatomy (name · Sun sign
// glyph · date · place · time-known marker) with the sign resolved through
// the REAL charts repo (the injected resolver reads its facts), the honest
// sign absence when no chart exists, add/edit seams (J3), and the
// remove-with-export-first nudge (J8 offer before real deletion).

import type { ZodiacSign } from "@natally/design-tokens";
import { ZODIAC } from "@natally/design-tokens";
import type { Person } from "@natally/lore/types";
import Database from "better-sqlite3";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppDb, openAppDb } from "../../data/db";
import { PeopleScreen } from "./people-screen";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const TIMED: Person = {
  id: "person-a",
  name: "Alice Example",
  birth: { date: "1990-05-02", time: "14:30", place: "Porto, PT", timeKnown: true },
};
const SOLAR: Person = {
  id: "person-b",
  name: "Bea Unknown",
  birth: { date: "1985-11-30", place: "Lisbon, PT", timeKnown: false },
};

const SIGN_NAMES: readonly ZodiacSign[] = Object.keys(ZODIAC) as readonly ZodiacSign[];

let container: HTMLDivElement;
let root: Root;
let app: AppDb;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  app = openAppDb(new Database(":memory:"));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const q = (selector: string): Element | null => container.querySelector(selector);
const all = (selector: string): Element[] => [...container.querySelectorAll(selector)];

function click(button: Element | null): void {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("test: expected a button");
  }
  act(() => {
    button.click();
  });
}

/**
 * The injected `sunSignOf` the wiring would provide: the person's chart facts
 * read from the REAL charts repo (facts land as engine-computed material);
 * a person without a chart row resolves to undefined — honest absence.
 */
function sunSignOf(personId: string): ZodiacSign | undefined {
  const record = app.charts.list().find((entry) => entry.inputs.personIds.includes(personId));
  const facts: unknown = record?.facts;
  if (typeof facts !== "object" || facts === null || !("positions" in facts)) {
    return undefined;
  }
  const positions = (facts as { positions?: readonly { body?: string; lon?: number }[] }).positions;
  const sun = positions?.find((position) => position.body === "sun");
  if (sun === undefined || typeof sun.lon !== "number") {
    return undefined;
  }
  return SIGN_NAMES[Math.floor(sun.lon / 30)];
}

function mount(jsx: ReactNode): void {
  act(() => {
    root.render(jsx);
  });
}

/**
 * A fresh mount surface: the screen snapshots the repo at mount, so tests
 * that seed rows between mounts recycle the root instead of re-rendering
 * against a stale snapshot.
 */
function recycle(): void {
  act(() => {
    root.unmount();
  });
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

function screen(props: {
  sunSign?: boolean;
  onAdd?: () => void;
  onEdit?: (personId: string) => void;
  exportAll?: () => Promise<void>;
}): ReactNode {
  return (
    <PeopleScreen
      peopleRepo={app.people}
      sunSignOf={props.sunSign === false ? undefined : sunSignOf}
      onAdd={props.onAdd}
      onEdit={props.onEdit}
      exportAll={props.exportAll}
    />
  );
}

describe("people: list anatomy, add/edit seams, remove-with-export-first nudge", () => {
  it("rows carry name, sun glyph, date·place line and the time-known marker", () => {
    app.people.create(TIMED);
    app.people.create(SOLAR);
    // Alice's computed chart facts (Sun at 41.7° ⇒ Taurus) through the charts repo.
    app.charts.put(
      {
        id: "chart-a",
        personIds: ["person-a"],
        ut: "1990-05-02T14:30:00Z",
        place: { lat: 41.15, lon: -8.61, label: "Porto" },
      },
      { positions: [{ body: "sun", lon: 41.7, lat: 0, speed: 0.97 }], aspects: [] },
    );

    mount(screen({ onEdit: () => undefined }));

    expect(q('[data-testid="people-screen"]')?.getAttribute("data-variant")).toBe("list");
    const rows = all('[data-testid="person-row"]');
    expect(rows).toHaveLength(2);

    const alice = rows.find((row) => row.getAttribute("data-person-id") === "person-a");
    expect(alice?.getAttribute("data-time-known")).toBe("true");
    expect(alice?.querySelector('[data-testid="person-name"]')?.textContent).toBe("Alice Example");
    expect(alice?.querySelector('[data-testid="person-line"]')?.textContent).toBe(
      "1990-05-02 · Porto, PT",
    );
    expect(alice?.querySelector('[data-testid="person-time-marker"]')?.textContent).toBe(
      "time known",
    );
    // The computed Sun glyph renders; no absence dash on a resolved row.
    expect(alice?.querySelector("svg")).not.toBeNull();
    expect(alice?.querySelector('[data-testid="person-sign-absent"]')).toBeNull();

    const bea = rows.find((row) => row.getAttribute("data-person-id") === "person-b");
    expect(bea?.getAttribute("data-time-known")).toBe("false");
    expect(bea?.querySelector('[data-testid="person-time-marker"]')?.textContent).toBe(
      "no birth time",
    );
    // No chart for Bea ⇒ the honest absence, never a guessed glyph.
    expect(bea?.querySelector('[data-testid="person-sign-absent"]')).not.toBeNull();
    expect(bea?.querySelector("svg")).toBeNull();
  });

  it("empty variant offers the J3 add seam; edit carries the person id", () => {
    const onAdd = vi.fn();
    const onEdit = vi.fn<(personId: string) => void>();
    mount(screen({ onAdd, onEdit }));

    expect(q('[data-testid="people-screen"]')?.getAttribute("data-variant")).toBe("empty");
    expect(q('[data-testid="people-empty"]')).not.toBeNull();
    click(q('[data-testid="people-add"]'));
    expect(onAdd).toHaveBeenCalledTimes(1);

    recycle();
    app.people.create(TIMED);
    mount(screen({ onAdd, onEdit }));
    click(q('[data-testid="person-edit-person-a"]'));
    expect(onEdit).toHaveBeenCalledWith("person-a");
  });

  it("remove shows the export-first nudge; export offer fires; then real deletion", async () => {
    app.people.create(TIMED);
    const exportAll = vi.fn<() => Promise<void>>(async () => undefined);
    mount(screen({ exportAll }));

    click(q('[data-testid="person-remove-person-a"]'));
    // The nudge stands between the press and deletion; the export offer is shown.
    const nudge = q('[data-testid="remove-nudge"]');
    expect(nudge).not.toBeNull();
    expect(q('[data-testid="remove-nudge-copy"]')?.textContent).toContain("Export");
    expect(q('[data-testid="remove-export"]')).not.toBeNull();
    expect(app.people.list()).toHaveLength(1);

    click(q('[data-testid="remove-export"]'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(exportAll).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="remove-exported"]')).not.toBeNull();

    click(q('[data-testid="remove-confirm"]'));
    expect(app.people.list()).toHaveLength(0);
    expect(q('[data-testid="remove-nudge"]')).toBeNull();
    expect(q('[data-testid="people-screen"]')?.getAttribute("data-variant")).toBe("empty");
  });
});
