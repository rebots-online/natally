// natally — G.1 content tests. The acceptance contract: one glossary entry
// per frozen glyph (1:1 against LIBS/UI/FIGMA/glyphs/glyph-ids.txt), every
// entry carrying its required fields, and a gazetteer of at least 100 names
// that loads as a case-insensitive Set.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ContentValidationError,
  type GlossaryEntry,
  loadGazetteer,
  loadGlossary,
  parseGazetteer,
  parseGlossary,
} from "./index";

const GLYPH_IDS_URL = new URL("../../../../LIBS/UI/FIGMA/glyphs/glyph-ids.txt", import.meta.url);

const frozenGlyphIds: string[] = readFileSync(GLYPH_IDS_URL, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

// Content contract per screen-glossary-callout: the "In synastry" note
// belongs to planet/point/aspect entries (planet/angle entries); signs and
// motion terms carry none, so no canned sun-sign compatibility reading
// appears anywhere in the glossary.
const SYNASTRY_GLYPH_IDS: ReadonlySet<string> = new Set([
  "g-sun",
  "g-moon",
  "g-mercury",
  "g-venus",
  "g-mars",
  "g-jupiter",
  "g-saturn",
  "g-uranus",
  "g-neptune",
  "g-pluto",
  "g-chiron",
  "g-north-node",
  "g-south-node",
  "g-conjunction",
  "g-opposition",
  "g-trine",
  "g-square",
  "g-sextile",
  "g-quincunx",
  "g-semisextile",
]);

const glossary: GlossaryEntry[] = loadGlossary();
const gazetteer: ReadonlySet<string> = loadGazetteer();

describe(`content: ${glossary.length} entries, all four fields present, gazetteer loads`, () => {
  it("covers the frozen glyph set 1:1", () => {
    expect(frozenGlyphIds.length).toBeGreaterThan(0);
    expect(glossary).toHaveLength(frozenGlyphIds.length);
    expect(new Set(glossary.map((entry) => entry.glyphId))).toEqual(new Set(frozenGlyphIds));
  });

  it("gives every entry a term, glyphId and whatItIs", () => {
    const terms = new Set<string>();
    for (const entry of glossary) {
      expect(entry.term.trim().length).toBeGreaterThan(0);
      expect(entry.glyphId.trim().length).toBeGreaterThan(0);
      expect(entry.whatItIs.trim().length).toBeGreaterThan(0);
      terms.add(entry.term);
    }
    expect(terms.size).toBe(glossary.length);
  });

  it("carries synastry notes on planet/point/aspect entries only", () => {
    for (const entry of glossary) {
      const expected = SYNASTRY_GLYPH_IDS.has(entry.glyphId);
      expect(entry.synastryNote !== undefined, entry.glyphId).toBe(expected);
      if (entry.synastryNote !== undefined) {
        expect(entry.synastryNote.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("loads the gazetteer as a case-insensitive Set of at least 100 names", () => {
    expect(gazetteer.size).toBeGreaterThanOrEqual(100);
    expect(gazetteer.has("munich")).toBe(true);
    expect(gazetteer.has("münchen")).toBe(true);
    expect(gazetteer.has("tokyo")).toBe(true);
    expect(gazetteer.has("nowhere-at-all")).toBe(false);
  });

  it("rejects a corrupted glossary fixture", () => {
    const first = glossary[0];
    if (first === undefined) throw new Error("glossary must not be empty");

    // wrong type for a required field
    expect(() => parseGlossary([{ ...first, whatItIs: 42 }])).toThrow(ContentValidationError);

    // missing a required field
    const missing: Record<string, unknown> = { ...first };
    delete missing.whatItIs;
    expect(() => parseGlossary([missing])).toThrow(ContentValidationError);

    // duplicate glyphId
    expect(() => parseGlossary([first, first])).toThrow(ContentValidationError);

    // unexpected key (INC-19: no prediction-shaped content may ride along)
    expect(() => parseGlossary([{ ...first, prediction: "you will win the lottery" }])).toThrow(
      ContentValidationError,
    );
  });

  it("rejects a corrupted gazetteer fixture", () => {
    expect(() => parseGazetteer(["Paris", ""])).toThrow(ContentValidationError);
    expect(() => parseGazetteer(["Paris", "PARIS"])).toThrow(ContentValidationError);
    expect(() => parseGazetteer(["Paris", 75])).toThrow(ContentValidationError);
    expect(() => parseGazetteer("Paris")).toThrow(ContentValidationError);
  });

  it("loaders are idempotent", () => {
    expect(loadGlossary()).toEqual(glossary);
    expect(loadGazetteer()).toEqual(gazetteer);
  });
});
