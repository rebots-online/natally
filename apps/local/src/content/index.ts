// natally — content loaders (G.1). The glossary and gazetteer are bundled,
// authored-static education (INC-19 provenance class "authored",
// ARCHITECTURE.md §5) and are validated at the load boundary. The gazetteer
// seeds L.3's place-name matching; user-entered places are added by L.3 at
// runtime and are not part of this file.
//
// Validation is hand-rolled rather than zod: zod is not resolvable from
// @natally/local under pnpm's isolated layout and adding a dependency is out
// of scope here. These validators enforce the same contract: fail-fast typed
// errors, no silent coercion.

import gazetteerJson from "./gazetteer.json";
import glossaryJson from "./glossary.json";

/** One glossary-callout entry (screen-glossary-callout anatomy). */
export interface GlossaryEntry {
  /** Display term, e.g. "North Node". */
  readonly term: string;
  /** Frozen glyph id from LIBS/UI/FIGMA/glyphs/glyph-ids.txt, 1:1. */
  readonly glyphId: string;
  /** "What it is" body: 2–4 sentence authored-static education. */
  readonly whatItIs: string;
  /** "In synastry" body; present on planet/point/aspect entries only. */
  readonly synastryNote?: string;
}

/** Thrown when bundled content fails its structural contract. */
export class ContentValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}

const ENTRY_KEYS: ReadonlySet<string> = new Set(["term", "glyphId", "whatItIs", "synastryNote"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function fail(path: string, reason: string): never {
  throw new ContentValidationError(`${path}: ${reason}`);
}

/** Validate untrusted data as a glossary. Exported for content tests. */
export function parseGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) fail("glossary", "expected an array of entries");
  const seenTerms = new Set<string>();
  const seenGlyphIds = new Set<string>();
  return value.map((rawEntry: unknown, index: number): GlossaryEntry => {
    const path = `glossary[${String(index)}]`;
    if (!isRecord(rawEntry)) fail(path, "expected an object");
    for (const key of Object.keys(rawEntry)) {
      if (!ENTRY_KEYS.has(key)) fail(path, `unexpected key "${key}"`);
    }
    const { term, glyphId, whatItIs, synastryNote } = rawEntry;
    if (!isNonEmptyString(term)) {
      fail(path, '"term" must be a non-empty string');
    }
    if (!isNonEmptyString(glyphId)) {
      fail(path, '"glyphId" must be a non-empty string');
    }
    if (!isNonEmptyString(whatItIs)) {
      fail(path, '"whatItIs" must be a non-empty string');
    }
    if (synastryNote !== undefined && !isNonEmptyString(synastryNote)) {
      fail(path, '"synastryNote" must be a non-empty string when present');
    }
    if (seenTerms.has(term)) fail(path, `duplicate term "${term}"`);
    if (seenGlyphIds.has(glyphId)) {
      fail(path, `duplicate glyphId "${glyphId}"`);
    }
    seenTerms.add(term);
    seenGlyphIds.add(glyphId);
    return synastryNote === undefined
      ? { term, glyphId, whatItIs }
      : { term, glyphId, whatItIs, synastryNote };
  });
}

/**
 * Validate untrusted data as a gazetteer. Names are lowercased so L.3 can
 * check membership case-insensitively. Exported for content tests.
 */
export function parseGazetteer(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) {
    fail("gazetteer", "expected an array of place-name strings");
  }
  const names = new Set<string>();
  value.forEach((rawName: unknown, index: number): void => {
    const path = `gazetteer[${String(index)}]`;
    if (!isNonEmptyString(rawName)) {
      fail(path, "expected a non-empty string");
    }
    const lower = rawName.toLowerCase();
    if (names.has(lower)) fail(path, `duplicate place "${rawName}"`);
    names.add(lower);
  });
  return names;
}

const glossaryData: unknown = glossaryJson;
const gazetteerData: unknown = gazetteerJson;

/** Typed, validated loader for the bundled glossary. Idempotent. */
export function loadGlossary(): GlossaryEntry[] {
  return parseGlossary(glossaryData);
}

/** Typed, validated loader for the bundled gazetteer. Idempotent. */
export function loadGazetteer(): ReadonlySet<string> {
  return parseGazetteer(gazetteerData);
}
