// natally — the glyph set (U.1, TOKENS.md "Glyphs", STATE-LEDGER "glyphs").
// Serves inline SVG by id from the verbatim copy of the frozen
// `natally-glyphs.svg` (apps/local/src/assets/glyphs/), never unicode
// astrological characters in text (DESIGN.md anti-patterns). Stroke glyphs on
// a 24x24 grid, stroke 1.5, round caps, `currentColor` — colour comes from
// the CSS `color` property, so the gilt margin glyph is `text-[var(--color-gilt)]`
// at the call site, never a hex here.
//
// The frozen set is the 35 ids enumerated in LIBS/UI/FIGMA/glyphs/glyph-ids.txt
// (12 signs, 11 bodies, 2 nodes, 7 aspects, retrograde, applying, separating —
// the TOKENS.md headline "36" counts the set, the enumeration defines it).

import type { ReactElement } from "react";
import rawGlyphs from "../assets/glyphs/natally-glyphs.svg?raw";

export const GLYPH_NAMES = [
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
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "chiron",
  "north-node",
  "south-node",
  "conjunction",
  "opposition",
  "trine",
  "square",
  "sextile",
  "quincunx",
  "semisextile",
  "retrograde",
  "applying",
  "separating",
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];

type GlyphBody = {
  readonly viewBox: string;
  readonly inner: string;
};

// Parse `<symbol id="g-x" viewBox="0 0 24 24">…</symbol>` out of the frozen
// file once at module load. `?raw` keeps the copy the single source of truth.
const GLYPHS: Readonly<Record<GlyphName, GlyphBody>> = (() => {
  const bodies = {} as Record<GlyphName, GlyphBody>;
  const symbol = /<symbol\s+id="g-([a-z0-9-]+)"\s+viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g;
  let match: RegExpExecArray | null = symbol.exec(rawGlyphs);
  while (match !== null) {
    const [, id, viewBox, inner] = match;
    if (id !== undefined && viewBox !== undefined && inner !== undefined) {
      bodies[id as GlyphName] = { viewBox, inner };
    }
    match = symbol.exec(rawGlyphs);
  }
  return bodies;
})();

function isGlyphName(candidate: string): candidate is GlyphName {
  return (GLYPH_NAMES as readonly string[]).includes(candidate);
}

export type GlyphProps = {
  readonly name: GlyphName;
  /** Rendered square edge in px; the frozen set is used at 16 / 20 / 28. */
  readonly size?: number;
  readonly className?: string;
};

/** Inline SVG glyph by name from the frozen set. */
export function Glyph({ name, size = 24, className }: GlyphProps): ReactElement {
  const body = GLYPHS[name];
  if (body === undefined) {
    throw new Error(`Glyph: unknown glyph name ${name}`);
  }
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={body.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Frozen path data from the copied natally-glyphs.svg — parsed above,
      // never hand-edited. Some bodies carry explicit fill/stroke attributes
      // (e.g. the sun's core dot) which win over these inherited defaults.
      dangerouslySetInnerHTML={{ __html: body.inner }}
    />
  );
}

// Exposed for the test suite: the copied file must stay in lockstep with the
// name list and glyph-ids.txt.
export function hasGlyphBody(name: string): boolean {
  return isGlyphName(name) && GLYPHS[name] !== undefined;
}
