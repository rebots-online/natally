// natally design tokens — public surface.
//
// Every value below is a frozen constant generated from LIBS/UI/FIGMA/TOKENS.md
// by scripts/gen.mjs (see src/generated.ts) — never restate a value by hand.
// ARCHITECTURE.md §3 law: tokens.css mirrors TOKENS.md one-to-one and no raw
// hex exists outside tokens.css; consumers reference either these constants or
// the *_VAR custom-property names (usable with Tailwind utilities as well).

import { COLOUR, RADIUS, SIZE, SPACING, STROKE, type TOKEN_COUNT, ZODIAC } from "./generated.js";

export {
  COLOUR,
  COLOUR_VAR,
  RADIUS,
  RADIUS_VAR,
  SIZE,
  SIZE_VAR,
  SPACING,
  SPACING_VAR,
  STROKE,
  STROKE_VAR,
  TOKEN_COUNT,
  VARIABLE_ID,
  ZODIAC,
  ZODIAC_VAR,
} from "./generated.js";

/** Every frozen token, grouped; values are byte-identical to tokens.css. */
export const TOKENS = {
  colour: COLOUR,
  zodiac: ZODIAC,
  radius: RADIUS,
  spacing: SPACING,
  stroke: STROKE,
  size: SIZE,
} as const;

export type ColourName = keyof typeof COLOUR;
export type ZodiacSign = keyof typeof ZODIAC;
export type RadiusName = keyof typeof RADIUS;
export type SpaceName = keyof typeof SPACING;
export type StrokeName = keyof typeof STROKE;
export type SizeName = keyof typeof SIZE;

/** Number of frozen variables parsed from TOKENS.md (single source of truth). */
export type TokenCount = typeof TOKEN_COUNT;
