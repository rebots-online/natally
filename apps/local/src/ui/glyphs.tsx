import type { SVGProps } from "react";

/** Names correspond exactly to STATE-LEDGER.json glyphs and the frozen SVG symbols. */
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
export const glyphSpriteUrl = new URL("../assets/glyphs/natally-glyphs.svg", import.meta.url).href;

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: GlyphName;
  size?: 16 | 20 | 28;
  label?: string;
}

export function Glyph({ name, size = 20, label, ...props }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      <use href={`${glyphSpriteUrl}#g-${name}`} />
    </svg>
  );
}
