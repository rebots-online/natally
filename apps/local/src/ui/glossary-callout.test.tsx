// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GLOSSARY_ENTRIES, GlossaryCallout, glossaryProvenance } from "./glossary-callout.js";

const entry = GLOSSARY_ENTRIES[0];

afterEach(cleanup);

describe("glossary-callout data", () => {
  it("loads exactly the five required authored entries", () => {
    expect([...GLOSSARY_ENTRIES.map((item) => item.term)]).toEqual([
      "Ascendant",
      "Placidus",
      "Synastry",
      "Retrograde",
      "Midheaven",
    ]);
    for (const item of GLOSSARY_ENTRIES) {
      expect(item.body.length).toBeGreaterThan(40);
      expect(item.glyph.length).toBeGreaterThan(0);
    }
  });

  it("carries the authored provenance kind for the rendered label", () => {
    expect(glossaryProvenance.kind).toBe("authored-static");
    expect(glossaryProvenance.label.length).toBeGreaterThan(0);
  });
});

describe("GlossaryCallout", () => {
  it("hides the body until hover and shows it with the authored label on hover", () => {
    render(<GlossaryCallout entry={entry} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Ascendant/ }));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain(glossaryProvenance.label);
    expect(tooltip.textContent).toContain(entry.body);
    fireEvent.mouseLeave(screen.getByRole("button", { name: /Ascendant/ }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on keyboard focus with aria-describedby wiring and closes on Escape", () => {
    render(<GlossaryCallout entry={entry} />);
    const trigger = screen.getByRole("button", { name: /Ascendant/ });
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.textContent).toContain(entry.body);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
  });

  it("closes on blur", () => {
    render(
      <>
        <GlossaryCallout entry={entry} />
        <button type="button">elsewhere</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: /Ascendant/ });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).not.toBeNull();
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
