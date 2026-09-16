/**
 * T0.4 — Token mirror test (design-tokens contract verification).
 *
 * Independently re-parses BOTH sources at run time and asserts equality —
 * no expected token name or hex is hardcoded in this file:
 *
 *   1. packages/design-tokens/tokens.css — the generated `@theme` block
 *      (output of packages/design-tokens/scripts/gen.mjs).
 *   2. LIBS/UI/FIGMA/TOKENS.md — the frozen markdown tables, the source of
 *      truth gen.mjs must mirror.
 *
 * Frozen contract: 10 colour + 12 zodiac + 4 radius + 6 space + 1 stroke +
 * 3 size = 36 variables, identical name sets AND values in both sources.
 *
 * Collapsed TOKENS.md rows are expanded from their own cell data:
 *   - `z/aries … z/pisces`: the hex cell text "12 hues at 30° (HSL 50% / 68%)"
 *     is converted to hex here (hue 0° is the implied start of the 30° ramp —
 *     aries' red), anchored by the first/last signs parsed from the row.
 *   - `space/1 2 3 4 6 8` / `4 8 12 16 24 32`: paired per cell whitespace
 *     against the `--spacing-<n>` CSS template.
 * Only the canonical zodiac sign sequence is a domain constant here (the
 * astrological order itself, not a design-token datum).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const TOKENS_CSS = path.join(pkgRoot, "tokens.css");
const TOKENS_MD = path.join(repoRoot, "LIBS", "UI", "FIGMA", "TOKENS.md");

/** Canonical zodiac sequence — anchors the `z/…` row's first…last range. */
const ZODIAC_SIGNS: readonly string[] = [
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
];

/** The frozen T0.4 contract: family counts both sources must resolve to. */
const CONTRACT = {
  colour: 10,
  zodiac: 12,
  radius: 4,
  spacing: 6,
  stroke: 1,
  size: 3,
} as const;
const CONTRACT_TOTAL = Object.values(CONTRACT).reduce((a, b) => a + b, 0); // 36

const FAMILIES = ["colour", "zodiac", "radius", "spacing", "stroke", "size"] as const;
type Family = (typeof FAMILIES)[number];

type TokenMap = Map<string, string>;

/** HSL → #rrggbb, derived independently of any token data (zodiac ramp). */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  const byte = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

/** All pipe-table rows (header included, separator dropped) under `heading`. */
function markdownTableRows(md: string, heading: string): string[][] {
  const start = md.indexOf(`## ${heading}`);
  if (start === -1) {
    throw new Error(`TOKENS.md: section "## ${heading}" not found`);
  }
  const next = md.indexOf("\n## ", start + 1);
  const body = md.slice(start, next === -1 ? undefined : next);
  const rows = body
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !/^\s*\|[\s|:-]*\|?\s*$/.test(line)) // drop |---| row
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", "")),
    );
  if (rows.length < 2) {
    throw new Error(`TOKENS.md: no parseable table under "## ${heading}"`);
  }
  return rows;
}

/** name → value for every `--*` declaration inside the tokens.css `@theme`. */
function parseThemeBlock(css: string): TokenMap {
  const at = css.indexOf("@theme");
  if (at === -1) throw new Error("tokens.css: no @theme block");
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  if (depth !== 0) throw new Error("tokens.css: unterminated @theme block");
  const block = css.slice(open + 1, i - 1);
  const map: TokenMap = new Map();
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(`--${m[1]}`, m[2].trim().toLowerCase());
  }
  return map;
}

/** The TOKENS.md tables, resolved (collapsed rows expanded) to name → value. */
function expectedTokensFromMarkdown(md: string): TokenMap {
  const expected: TokenMap = new Map();

  // — Colour (COLOR): literal hex rows + the collapsed zodiac ramp row.
  const colourRows = markdownTableRows(md, "Colour (COLOR)");
  const cVar = colourRows[0].indexOf("Variable");
  const cHex = colourRows[0].indexOf("Hex");
  const cCss = colourRows[0].indexOf("CSS");
  for (const cells of colourRows.slice(1)) {
    if (/^#[0-9a-f]{6}$/i.test(cells[cHex])) {
      expected.set(cells[cCss], cells[cHex].toLowerCase());
      continue;
    }
    // Collapsed zodiac row: hex cell describes the ramp, CSS cell is the
    // `--color-z-<sign>` template, variable cell bounds it (z/<first> … z/<last>).
    const ramp = cells[cHex].match(
      /(\d+)\s+hues at (\d+)°\s*\(HSL\s*(\d+)%\s*\/\s*(\d+)%\)/,
    );
    if (!ramp) {
      throw new Error(`TOKENS.md: unparseable hex cell "${cells[cHex]}"`);
    }
    const count = Number(ramp[1]);
    const step = Number(ramp[2]);
    const sat = Number(ramp[3]);
    const lit = Number(ramp[4]);
    const range = cells[cVar].match(/z\/(\w+)\s*…\s*z\/(\w+)/);
    if (!range) {
      throw new Error(`TOKENS.md: unparseable variable cell "${cells[cVar]}"`);
    }
    const first = ZODIAC_SIGNS.indexOf(range[1]);
    const last = ZODIAC_SIGNS.indexOf(range[2]);
    if (first === -1 || last === -1) {
      throw new Error(`TOKENS.md: unknown sign range "${cells[cVar]}"`);
    }
    const signs = ZODIAC_SIGNS.slice(first, last + 1);
    if (signs.length !== count) {
      throw new Error(
        `TOKENS.md: zodiac range holds ${signs.length} signs, hex cell claims ${count}`,
      );
    }
    signs.forEach((sign, i) => {
      expected.set(cells[cCss].replace("<sign>", sign), hslToHex(i * step, sat, lit));
    });
  }

  // — Shape, space, size (FLOAT): px rows + the collapsed spacing row.
  const floatRows = markdownTableRows(md, "Shape, space, size (FLOAT)");
  const fVar = floatRows[0].indexOf("Variable");
  const fVal = floatRows[0].indexOf("Value");
  const fCss = floatRows[0].indexOf("CSS");
  for (const cells of floatRows.slice(1)) {
    const name = cells[fCss];
    const value = cells[fVal].trim();
    if (name.includes("<")) {
      // Collapsed: `space/1 2 3 4 6 8` / `4 8 12 16 24 32` / `--spacing-<n>`.
      const nums = cells[fVar]
        .split("/")
        .slice(1)
        .join("/")
        .trim()
        .split(/\s+/);
      const vals = value.split(/\s+/);
      if (nums.length !== vals.length) {
        throw new Error(
          `TOKENS.md: collapsed row "${name}" pairs ${nums.length} names with ${vals.length} values`,
        );
      }
      nums.forEach((n, i) => {
        expected.set(name.replace("<n>", n), `${vals[i]}px`);
      });
    } else {
      expected.set(name, `${value}px`);
    }
  }

  return expected;
}

function familyOf(name: string): Family | undefined {
  if (name.startsWith("--color-z-")) return "zodiac";
  if (name.startsWith("--color-")) return "colour";
  if (name.startsWith("--radius-")) return "radius";
  if (name.startsWith("--spacing-")) return "spacing";
  if (name.startsWith("--stroke-")) return "stroke";
  if (name.startsWith("--size-")) return "size";
  return undefined;
}

describe("T0.4 — design-tokens contract (tokens.css mirrors LIBS/UI/FIGMA/TOKENS.md)", () => {
  const expected = expectedTokensFromMarkdown(readFileSync(TOKENS_MD, "utf8"));
  const actual = parseThemeBlock(readFileSync(TOKENS_CSS, "utf8"));

  it("tokens: 36 variables mirrored exactly", () => {
    // 1. Family counts on the generated side equal the frozen contract,
    //    and no variable sits outside the six contract families.
    const byFamily: Record<Family, string[]> = {
      colour: [],
      zodiac: [],
      radius: [],
      spacing: [],
      stroke: [],
      size: [],
    };
    const stray: string[] = [];
    for (const name of actual.keys()) {
      const f = familyOf(name);
      if (f === undefined) stray.push(name);
      else byFamily[f].push(name);
    }
    const actualCounts = Object.fromEntries(
      FAMILIES.map((f) => [f, byFamily[f].length]),
    );
    expect(
      actualCounts,
      "tokens.css @theme family counts must equal the frozen contract (10/12/4/6/1/3)",
    ).toEqual({ ...CONTRACT });
    expect(
      stray,
      "no @theme variable may sit outside the six contract families",
    ).toEqual([]);

    // 2. Both sources resolve to exactly the contracted 36 names, and the
    //    name sets match — every --color-*/--spacing-* (and the rest) as the
    //    TOKENS.md CSS column spells them.
    expect(
      expected.size,
      "TOKENS.md tables must resolve to the contracted 36 variables",
    ).toBe(CONTRACT_TOTAL);
    expect(
      actual.size,
      "tokens.css @theme must hold exactly the contracted 36 variables",
    ).toBe(CONTRACT_TOTAL);
    expect(
      [...actual.keys()].sort(),
      "every @theme name must match the TOKENS.md CSS column exactly",
    ).toEqual([...expected.keys()].sort());

    // 3. Values identical: hex (colour + zodiac, the latter derived from the
    //    "12 hues at 30° (HSL 50% / 68%)" ramp description) and px (shape,
    //    space, size) — against the hex/Value column, not memory.
    const drifted = [...expected]
      .filter(([name, value]) => actual.get(name) !== value)
      .map(([name, value]) => `${name}: tokens.css=${actual.get(name)} TOKENS.md=${value}`);
    expect(
      drifted,
      "every value must equal the TOKENS.md hex/Value column",
    ).toEqual([]);
  });
});
