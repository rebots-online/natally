#!/usr/bin/env node
// =============================================================================
// packages/design-tokens/scripts/gen.mjs — design-tokens generator
//
// Single source of truth: LIBS/UI/FIGMA/TOKENS.md (frozen Figma complement),
// cross-checked against LIBS/UI/FIGMA/STATE-LEDGER.json (Figma variable ids).
// Emits, deterministically (doc order, no timestamps):
//   tokens.css      — Tailwind 4 `@theme` block, one-to-one with TOKENS.md
//   src/generated.ts — the same tokens as frozen TS const objects
//
//   node scripts/gen.mjs          write both files
//   node scripts/gen.mjs --check  re-parse + regenerate in memory; exit 0 only
//                                 when both committed files match exactly,
//                                 else print a diff and exit 1
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(PKG_DIR, "..", "..");
const TOKENS_MD = join(REPO_DIR, "LIBS", "UI", "FIGMA", "TOKENS.md");
const LEDGER_JSON = join(REPO_DIR, "LIBS", "UI", "FIGMA", "STATE-LEDGER.json");
const TOKENS_CSS = join(PKG_DIR, "tokens.css");
const GENERATED_TS = join(PKG_DIR, "src", "generated.ts");

const SIGNS = [
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

// Emission/parse order follows TOKENS.md document order. `--color-z-` must be
// classified before `--color-` (zodiac is a colour sub-namespace).
const GROUPS = {
  colour: { name: "colour", const: "COLOUR", css: "--color-" },
  zodiac: { name: "zodiac", const: "ZODIAC", css: "--color-z-" },
  radius: { name: "radius", const: "RADIUS", css: "--radius-" },
  spacing: { name: "spacing", const: "SPACING", css: "--spacing-" },
  stroke: { name: "stroke", const: "STROKE", css: "--stroke-" },
  size: { name: "size", const: "SIZE", css: "--size-" },
};
const GROUP_ORDER = ["colour", "zodiac", "radius", "spacing", "stroke", "size"];

function fail(message) {
  throw new Error(`gen.mjs: ${message}`);
}

/** HSL (degrees, 0..1, 0..1) → `#RRGGBB`, channels rounded to nearest integer. */
function hslToHex(hDeg, s, l) {
  const h = ((hDeg % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  const hex = (n) => channel(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(0)}${hex(8)}${hex(4)}`;
}

function dequote(cell) {
  const m = cell.match(/^`(.*)`$/);
  return m ? m[1] : cell;
}

/** Body of a markdown table: data rows as trimmed cell arrays. */
function tableRows(sectionText) {
  const rows = [];
  for (const raw of sectionText.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells[0] === "Variable") continue; // header
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator
    rows.push(cells);
  }
  return rows;
}

function expectIdRange(idCell, count, what) {
  const parts = idCell.split("…").map((p) => p.trim());
  if (parts.length !== 2) fail(`${what}: expected id range "a…b", got "${idCell}"`);
  const first = Number(parts[0].split(":")[1]);
  const last = Number(parts[1].split(":")[1]);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last - first + 1 !== count) {
    fail(`${what}: id range "${idCell}" does not cover ${count} entries`);
  }
  return { first, last };
}

function groupFor(css) {
  if (css.startsWith("--color-z-")) return GROUPS.zodiac;
  for (const name of GROUP_ORDER) {
    const spec = GROUPS[name];
    if (css.startsWith(spec.css)) return spec;
  }
  fail(`no known group for CSS custom property "${css}"`);
}

/** Parse TOKENS.md into an ordered token list: {key, css, value, figmaName}. */
function parseTokens(tokensMd) {
  const tokens = [];
  const seen = new Set();

  const push = (token) => {
    if (seen.has(token.css)) fail(`duplicate CSS custom property "${token.css}"`);
    seen.add(token.css);
    tokens.push(token);
  };

  // --- Colour (COLOR) -------------------------------------------------------
  const colourSection = sectionOf(tokensMd, "Colour (COLOR)");
  for (const cells of tableRows(colourSection)) {
    if (cells.length !== 5) fail(`colour row has ${cells.length} cells: ${cells.join(" | ")}`);
    const [variableCell, idCell, valueCell, , cssCell] = cells;
    const variable = dequote(variableCell);
    const css = dequote(cssCell);

    if (css === "--color-z-<sign>") {
      // Range row: `z/aries` … `z/pisces` | 2:13 … 2:24 | 12 hues at 30° (HSL S% / L%)
      const bounds = variableCell
        .replace(/`/g, "")
        .split("…")
        .map((p) => p.trim().split("/")[1]);
      if (bounds.length !== 2 || !SIGNS.includes(bounds[0]) || !SIGNS.includes(bounds[1])) {
        fail(`zodiac range row unparsable: "${variable}"`);
      }
      const m = valueCell.match(/^12 hues at 30° \(HSL (\d+)% \/ (\d+)%\)$/);
      if (!m) fail(`zodiac HSL spec unparsable: "${valueCell}"`);
      const s = Number(m[1]) / 100;
      const l = Number(m[2]) / 100;
      const start = SIGNS.indexOf(bounds[0]);
      const end = SIGNS.indexOf(bounds[1]);
      const count = end - start + 1;
      if (count !== 12) fail(`zodiac range covers ${count} signs, expected 12`);
      expectIdRange(idCell, count, "zodiac");
      for (let i = start; i <= end; i++) {
        const sign = SIGNS[i];
        push({
          key: sign,
          css: `--color-z-${sign}`,
          value: hslToHex(i * 30, s, l),
          figmaName: `z/${sign}`,
          group: GROUPS.zodiac.name,
        });
      }
      continue;
    }

    const spec = groupFor(css);
    if (spec !== GROUPS.colour) fail(`colour-table row maps outside --color-: "${css}"`);
    if (css.includes("<")) fail(`unexpanded placeholder in colour row: "${css}"`);
    const hex = dequote(valueCell);
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) fail(`colour "${variable}" hex unparsable: "${valueCell}"`);
    push({
      key: css.slice(spec.css.length),
      css,
      value: hex.toUpperCase(),
      figmaName: variable,
      group: spec.name,
    });
  }

  // --- Shape, space, size (FLOAT) --------------------------------------------
  const floatSection = sectionOf(tokensMd, "Shape, space, size (FLOAT)");
  for (const cells of tableRows(floatSection)) {
    if (cells.length !== 5) fail(`float row has ${cells.length} cells: ${cells.join(" | ")}`);
    const [variableCell, idCell, valueCell, , cssCell] = cells;
    const variable = dequote(variableCell);
    const css = dequote(cssCell);
    const spec = groupFor(css);

    if (css.includes("<n>")) {
      // Expansion row: `space/1 2 3 4 6 8` | 2:29 … 2:34 | 4 8 12 16 24 32
      const slash = variable.indexOf("/");
      if (slash === -1) fail(`expansion row lacks "<base>/" prefix: "${variable}"`);
      const base = variable.slice(0, slash + 1);
      const suffixes = variable
        .slice(slash + 1)
        .split(/\s+/)
        .filter(Boolean);
      const values = valueCell.split(/\s+/).filter(Boolean);
      if (suffixes.length !== values.length) {
        fail(`expansion row "${variable}": ${suffixes.length} names vs ${values.length} values`);
      }
      expectIdRange(idCell, suffixes.length, css);
      for (let i = 0; i < suffixes.length; i++) {
        const suffix = suffixes[i];
        if (!/^\d+(\.\d+)?$/.test(values[i])) fail(`float value unparsable: "${values[i]}"`);
        push({
          key: suffix,
          css: `${spec.css}${suffix}`,
          value: `${values[i]}px`,
          figmaName: `${base}${suffix}`,
          group: spec.name,
        });
      }
      continue;
    }

    if (css.includes("<")) fail(`unexpanded placeholder in float row: "${css}"`);
    const num = dequote(valueCell);
    if (!/^\d+(\.\d+)?$/.test(num)) fail(`float value unparsable: "${valueCell}"`);
    push({
      key: css.slice(spec.css.length),
      css,
      value: `${num}px`,
      figmaName: variable,
      group: spec.name,
    });
  }

  return tokens;
}

function sectionOf(md, heading) {
  const start = md.indexOf(`## ${heading}`);
  if (start === -1) fail(`TOKENS.md is missing section "## ${heading}"`);
  const next = md.indexOf("\n## ", start + 1);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

/**
 * Cross-check the parsed tokens against STATE-LEDGER.json: every token must map
 * to a ledger variable (exact id for single rows, contiguous range for rows the
 * doc expands), and the ledger may hold no variable the doc does not carry.
 */
function checkLedger(tokens, ledger) {
  const ids = ledger.variables;
  if (!ids || typeof ids !== "object") fail("STATE-LEDGER.json has no variables map");
  const missing = [];
  const used = new Set();
  for (const token of tokens) {
    const id = ids[token.figmaName];
    if (id === undefined) {
      missing.push(token.figmaName);
      continue;
    }
    used.add(token.figmaName);
  }
  if (missing.length > 0) fail(`tokens absent from STATE-LEDGER.json: ${missing.join(", ")}`);
  const unclaimed = Object.keys(ids).filter((name) => !used.has(name));
  if (unclaimed.length > 0)
    fail(`STATE-LEDGER.json variables not in TOKENS.md: ${unclaimed.join(", ")}`);
}

// --- Emission (deterministic: doc order, no timestamps) ----------------------

const HEADER_LINES = [
  "natally design tokens — GENERATED by packages/design-tokens/scripts/gen.mjs from",
  "LIBS/UI/FIGMA/TOKENS.md (frozen Figma complement) + STATE-LEDGER.json variable ids.",
  "Do not edit by hand — rerun: node packages/design-tokens/scripts/gen.mjs",
];

function groupEntries(tokens, groupName) {
  return tokens.filter((t) => t.group === groupName);
}

function renderTokensCss(tokens) {
  const colour = groupEntries(tokens, "colour");
  const zodiac = groupEntries(tokens, "zodiac");
  const float = tokens.filter((t) => t.group !== "colour" && t.group !== "zodiac");
  const line = (t) => `  ${t.css}: ${t.value};`;
  return [
    `/* ${HEADER_LINES[0]}`,
    `   ${HEADER_LINES[1]}`,
    `   ${HEADER_LINES[2]} */`,
    "",
    "@theme {",
    "  /* Colour (COLOR) */",
    ...colour.map(line),
    "  /* zodiac — 12 hues at 30° (HSL 50% / 68%) */",
    ...zodiac.map(line),
    "  /* Shape, space, size (FLOAT) */",
    ...float.map(line),
    "}",
    "",
  ].join("\n");
}

function quoteKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function renderTsObject(name, entries) {
  const lines = entries.map((t) => `  ${quoteKey(t.key)}: ${JSON.stringify(t.value)},`);
  return `export const ${name} = {\n${lines.join("\n")}\n} as const;`;
}

function renderVarObject(name, entries) {
  const lines = entries.map((t) => `  ${quoteKey(t.key)}: ${JSON.stringify(t.css)},`);
  return `export const ${name} = {\n${lines.join("\n")}\n} as const;`;
}

function renderIdObject(tokens, ledger) {
  const lines = tokens.map(
    (t) => `  ${JSON.stringify(t.css)}: ${JSON.stringify(ledger.variables[t.figmaName])},`,
  );
  return `export const VARIABLE_ID = {\n${lines.join("\n")}\n} as const;`;
}

function renderGeneratedTs(tokens, ledger) {
  const blocks = [];
  for (const name of GROUP_ORDER) {
    blocks.push(renderTsObject(GROUPS[name].const, groupEntries(tokens, name)));
  }
  for (const name of GROUP_ORDER) {
    blocks.push(renderVarObject(`${GROUPS[name].const}_VAR`, groupEntries(tokens, name)));
  }
  blocks.push(renderIdObject(tokens, ledger));
  const body = blocks.join("\n\n");
  return [
    `// ${HEADER_LINES[0]}`,
    `// ${HEADER_LINES[1]}`,
    `// ${HEADER_LINES[2]}`,
    "",
    body,
    "",
    `export const TOKEN_COUNT = ${tokens.length};`,
    "",
  ].join("\n");
}

// --- diff (for --check) -------------------------------------------------------

function diffLines(committed, generated) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, a: a.slice(start, endA), b: b.slice(start, endB) };
}

function printDiff(label, committed, generated) {
  const { start, a, b } = diffLines(committed, generated);
  console.error(
    `MISMATCH ${label} — committed vs regenerated (first difference at line ${start + 1}):`,
  );
  for (const l of a) console.error(`  - ${l}`);
  for (const l of b) console.error(`  + ${l}`);
}

function compare(label, path, generated) {
  let committed;
  try {
    committed = readFileSync(path, "utf8");
  } catch {
    console.error(`MISMATCH ${label} — committed file missing: ${path}`);
    process.exitCode = 1;
    return;
  }
  if (committed !== generated) {
    printDiff(label, committed, generated);
    process.exitCode = 1;
  }
}

// --- main ---------------------------------------------------------------------

function main() {
  const tokensMd = readFileSync(TOKENS_MD, "utf8");
  const ledger = JSON.parse(readFileSync(LEDGER_JSON, "utf8"));
  const tokens = parseTokens(tokensMd);
  checkLedger(tokens, ledger);

  const css = renderTokensCss(tokens);
  const ts = renderGeneratedTs(tokens, ledger);

  if (process.argv.includes("--check")) {
    compare("tokens.css", TOKENS_CSS, css);
    compare("src/generated.ts", GENERATED_TS, ts);
    if (process.exitCode === 1) {
      console.error("out of sync — run: node packages/design-tokens/scripts/gen.mjs");
    } else {
      console.log(`tokens.css in sync with TOKENS.md (${tokens.length} vars)`);
      console.log(`src/generated.ts in sync with TOKENS.md (${tokens.length} vars)`);
    }
    return;
  }

  writeFileSync(TOKENS_CSS, css);
  writeFileSync(GENERATED_TS, ts);
  console.log(`wrote tokens.css and src/generated.ts (${tokens.length} vars from TOKENS.md)`);
}

main();
