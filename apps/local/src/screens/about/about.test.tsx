// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { glossaryProvenance } from "../../ui/glossary-callout.js";
import { AboutScreen } from "./AboutScreen.js";

afterEach(cleanup);

describe("AboutScreen", () => {
  it("renders the §6 AGPL posture line verbatim", () => {
    render(<AboutScreen />);
    const license = screen.getByLabelText("License");
    expect(license.textContent).toContain("AGPL-3.0-or-later");
    expect(license.textContent).toContain("Its source is available on written request.");
  });

  it("links the §11.1(a) legal documents at their exact hrefs", () => {
    render(<AboutScreen />);
    const privacy = screen.getByRole("link", { name: "privacy policy" });
    const terms = screen.getByRole("link", { name: "terms of use" });
    expect(privacy.getAttribute("href")).toBe("/legal/privacy.html");
    expect(terms.getAttribute("href")).toBe("/legal/terms.html");
  });

  it("renders the provenance legend as labelled authored sections with all four treatments", () => {
    const { container } = render(<AboutScreen />);
    const authored = container.querySelectorAll('section[data-provenance="authored-static"]');
    expect(authored.length).toBe(3);
    // Authored sections carry the INC-19 authored label.
    const labels = screen.getAllByText(glossaryProvenance.label);
    expect(labels.length).toBe(authored.length);
    const legend = screen.getByLabelText("Provenance legend");
    for (const treatment of ["computed", "generated", "authored-static", "absence"]) {
      expect(legend.querySelector(`[data-provenance="${treatment}"]`)).not.toBeNull();
    }
  });

  it("shows the version stamp", () => {
    render(<AboutScreen />);
    const stamp = screen.getByRole("note");
    expect(stamp.textContent).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("consumes the glossary callout for every bundled entry", () => {
    render(<AboutScreen />);
    for (const term of ["Ascendant", "Placidus", "Synastry", "Retrograde", "Midheaven"]) {
      const trigger = screen.getByRole("button", { name: new RegExp(term) });
      fireEvent.mouseEnter(trigger);
      expect(screen.getByRole("tooltip").textContent).toContain(glossaryProvenance.label);
      expect(screen.getByRole("tooltip").textContent.length).toBeGreaterThan(40);
      fireEvent.mouseLeave(trigger);
      expect(screen.queryByRole("tooltip")).toBeNull();
    }
  });
});
