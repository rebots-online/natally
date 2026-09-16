// @vitest-environment jsdom
// natally — U.7 tests: the About screen renders the computed version block
// (verbatim from version.json, U.1's pattern), the license line
// AGPL-3.0-or-later (the D9 amended law — the frozen SCREEN.md's
// "proprietary" wording is documented drift, fixed here), the ephemeris and
// Kokoro provenance lines, and the D9 note. Accept line:
// "about+glossary: license line AGPL; 35 glyph entries open".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import versionJson from "../../../../../version.json";
import { NATALLY_VERSION } from "../../ui/version";
import { AboutScreen } from "./AboutScreen";

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

function renderAbout(): void {
  act(() => {
    root.render(<AboutScreen params={{}} />);
  });
}

const text = (testId: string): string =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

describe("about+glossary: license line AGPL; 35 glyph entries open", () => {
  it("about renders the product name and the computed version block from version.json", () => {
    renderAbout();
    expect(text("about-screen")).toContain(versionJson.productName);
    expect(text("about-version")).toContain(NATALLY_VERSION);
    expect(text("about-version")).toContain(String(versionJson.versionCode));
    expect(text("about-version")).toContain(versionJson.buildDate);
    expect(
      container.querySelector('[data-testid="about-version"]')?.getAttribute("data-provenance"),
    ).toBe("computed");
    expect(text("about-copyright")).toContain("© 2026 Robin");
  });

  it("about renders the license line AGPL-3.0-or-later — the D9 amended law, not the proprietary drift", () => {
    renderAbout();
    expect(text("about-license-line")).toBe("AGPL-3.0-or-later");
    // The frozen spec's "proprietary" wording must not reach the reader.
    expect(container.textContent).not.toContain("proprietary");
  });

  it("about renders ephemeris + Kokoro provenance and the D9 successor note, authored-labelled", () => {
    renderAbout();
    expect(text("about-provenance-ephemeris")).toContain("Swiss Ephemeris via sweph-wasm");
    expect(text("about-provenance-voice")).toContain("Kokoro");
    expect(text("about-provenance-mirror")).toContain("RobinsAIWorld/natally-models");
    expect(text("about-d9-note")).toContain("in-house ephemeris successor");
    expect(text("about-d9-note")).toContain("(D9)");
    const labels = container.querySelectorAll('[data-provenance="authored"]');
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});
