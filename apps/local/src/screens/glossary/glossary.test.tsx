// @vitest-environment jsdom
// natally — U.7 tests: the glossary callout opens every entry of G.1's
// bundled glossary (exactly the 35 frozen glyph ids of glyph-ids.txt), each
// with its glyph, name, authored-labelled "What it is" body, "In synastry"
// exactly where the entry carries a synastryNote, and an "Ask natally about
// this" control that hands the term to the injected askNatally seam. Accept
// line: "about+glossary: license line AGPL; 35 glyph entries open".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGlossary } from "../../content";
import { GLYPH_NAMES, hasGlyphBody } from "../../ui/glyphs";
import { GlossaryScreen } from "./GlossaryScreen";

const GLOSSARY = loadGlossary();

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = undefined;
});

afterEach(() => {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container.remove();
});

// A fresh root per render: the 35-entry sweeps mount and unmount in a loop,
// and a React root must never render again after unmount.
function renderCallout(glyphId: string, askNatally?: (term: string) => void): void {
  root = createRoot(container);
  act(() => {
    root?.render(<GlossaryScreen glyphId={glyphId} askNatally={askNatally} />);
  });
}

function unmountCallout(): void {
  act(() => {
    root?.unmount();
  });
  root = undefined;
}

const q = <T extends Element = Element>(selector: string): T | null =>
  container.querySelector<T>(selector);
const text = (testId: string): string =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

describe("about+glossary: license line AGPL; 35 glyph entries open", () => {
  it("the bundled glossary is exactly the 35 frozen glyph ids, 1:1 with glyph-ids.txt", () => {
    expect(GLOSSARY).toHaveLength(35);
    const frozen = new Set(GLYPH_NAMES.map((name) => `g-${name}`));
    const bundled = new Set(GLOSSARY.map((entry) => entry.glyphId));
    expect(bundled).toEqual(frozen);
  });

  it("opens each of the 35 entries: glyph, name, authored-labelled What it is", () => {
    for (const entry of GLOSSARY) {
      renderCallout(entry.glyphId);
      expect(q('[data-testid="glossary-callout"]')?.getAttribute("data-glyph-id")).toBe(
        entry.glyphId,
      );
      expect(text("glossary-term")).toBe(entry.term);
      // The frozen glyph renders as inline SVG from U.1's set, never unicode.
      expect(q("svg")).not.toBeNull();
      expect(hasGlyphBody(entry.glyphId.slice("g-".length))).toBe(true);
      expect(text("glossary-what")).toContain(entry.whatItIs);
      // The authored label treatment is present on the body (INC-19).
      expect(q('[data-testid="glossary-what"] [data-provenance="authored"]')).not.toBeNull();
      unmountCallout();
    }
  });

  it("shows In synastry exactly on the entries that carry a synastryNote", () => {
    for (const entry of GLOSSARY) {
      renderCallout(entry.glyphId);
      const section = q('[data-testid="glossary-synastry"]');
      if (entry.synastryNote === undefined) {
        expect(section).toBeNull();
      } else {
        expect(section).not.toBeNull();
        expect(text("glossary-synastry")).toContain(entry.synastryNote);
      }
      unmountCallout();
    }
  });

  it("Ask natally about this hands the term to the injected askNatally seam", () => {
    for (const entry of GLOSSARY) {
      const askNatally = vi.fn();
      renderCallout(entry.glyphId, askNatally);
      const button = q<HTMLButtonElement>('[data-testid="glossary-ask"]');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(false);
      act(() => {
        button?.click();
      });
      expect(askNatally).toHaveBeenCalledTimes(1);
      expect(askNatally).toHaveBeenCalledWith(entry.term);
      unmountCallout();
    }
  });

  it("without the seam the ask control renders disabled — an inert control never pretends", () => {
    renderCallout("g-sun");
    expect(q<HTMLButtonElement>('[data-testid="glossary-ask"]')?.disabled).toBe(true);
    unmountCallout();
  });

  it("an unknown glyphId renders the labelled absence, never invented content", () => {
    renderCallout("g-not-a-thing");
    expect(q('[data-testid="glossary-absence"]')?.getAttribute("data-absence")).toBe(
      "g-not-a-thing",
    );
    expect(q('[data-testid="glossary-callout"]')).toBeNull();
    expect(q('[data-testid="glossary-ask"]')).toBeNull();
  });
});
