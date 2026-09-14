import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cssUrl = new URL("../tokens.css", import.meta.url);
const outputUrl = new URL("../src/index.ts", import.meta.url);
const markdownUrl = new URL("../../../LIBS/UI/FIGMA/TOKENS.md", import.meta.url);
const ledgerUrl = new URL("../../../LIBS/UI/FIGMA/STATE-LEDGER.json", import.meta.url);
const expectedCount = 36;
const propertyPattern = /^--[a-z][a-z0-9-]*$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseLedger(source) {
  let ledger;
  try {
    ledger = JSON.parse(source);
  } catch (cause) {
    throw new Error("STATE-LEDGER.json is not valid JSON", { cause });
  }
  requireCondition(
    ledger?.variables && typeof ledger.variables === "object" && !Array.isArray(ledger.variables),
    "STATE-LEDGER.json must contain a variables object",
  );
  const entries = Object.entries(ledger.variables);
  requireCondition(
    entries.length === expectedCount,
    `STATE-LEDGER.json must define ${expectedCount} variables`,
  );
  requireCondition(
    entries.every(([, id]) => typeof id === "string" && /^VariableID:\d+:\d+$/.test(id)),
    "STATE-LEDGER.json contains an invalid variable ID",
  );
  requireCondition(
    new Set(entries.map(([, id]) => id)).size === entries.length,
    "Duplicate ledger variable ID",
  );
  return ledger;
}

export function parseSpecification(markdown, ledger) {
  const result = new Map();
  const usedVariables = new Set();
  const variablesById = new Map(Object.entries(ledger.variables).map(([name, id]) => [id, name]));
  const add = (variable, property, value, id) => {
    requireCondition(ledger.variables[variable] === id, `Ledger ID mismatch for ${variable}`);
    requireCondition(!usedVariables.has(variable), `Duplicate specification variable ${variable}`);
    requireCondition(propertyPattern.test(property), `Invalid CSS column ${property}`);
    requireCondition(!result.has(property), `Duplicate specification property ${property}`);
    usedVariables.add(variable);
    result.set(property, value);
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replaceAll("`", "").trim());
    const [variable, ids, value, , property] = cells;
    if (!property || !/^--[a-z]/.test(property)) continue;
    const range = ids.match(/^(\d+):(\d+)(?:\s+…\s+(\d+):(\d+))?$/);
    requireCondition(range, `Invalid variable ID range for ${variable}`);
    const [, page, first, endPage, last] = range;
    requireCondition(!endPage || endPage === page, `Mixed ID pages for ${variable}`);
    const count = last ? Number(last) - Number(first) + 1 : 1;
    const idAt = (index) => `VariableID:${page}:${Number(first) + index}`;

    if (property === "--color-z-<sign>") {
      const hues = value.match(/^(\d+) hues at (\d+)° \(HSL (\d+)% \/ (\d+)%\)$/);
      requireCondition(hues && Number(hues[1]) === count, "Invalid zodiac hue specification");
      const names = Array.from({ length: count }, (_, index) => variablesById.get(idAt(index)));
      requireCondition(
        names.every((name) => /^z\/[a-z]+$/.test(name ?? "")),
        "Missing zodiac ledger variable",
      );
      requireCondition(
        variable === `${names[0]} … ${names.at(-1)}`,
        "Zodiac endpoints disagree with ledger",
      );
      for (const [index, name] of names.entries()) {
        add(
          name,
          property.replace("<sign>", name.slice(2)),
          `hsl(${index * Number(hues[2])} ${hues[3]}% ${hues[4]}%)`,
          idAt(index),
        );
      }
    } else if (property === "--spacing-<n>") {
      requireCondition(variable.startsWith("space/"), "Invalid spacing variable group");
      const suffixes = variable.slice("space/".length).split(/\s+/);
      const values = value.split(/\s+/);
      requireCondition(
        suffixes.length === count && values.length === count,
        "Spacing group length mismatch",
      );
      requireCondition(
        [...suffixes, ...values].every((part) => /^\d+(?:\.\d+)?$/.test(part)),
        "Invalid spacing group value",
      );
      suffixes.forEach((suffix, index) => {
        add(`space/${suffix}`, property.replace("<n>", suffix), `${values[index]}px`, idAt(index));
      });
    } else {
      requireCondition(count === 1, `Unexpanded variable group ${variable}`);
      const colour = property.startsWith("--color-");
      requireCondition(
        colour ? /^#[\da-f]{6}$/i.test(value) : /^\d+(?:\.\d+)?$/.test(value),
        `Invalid value for ${property}`,
      );
      add(variable, property, colour ? value.toLowerCase() : `${value}px`, idAt(0));
    }
  }

  const missing = Object.keys(ledger.variables).filter((name) => !usedVariables.has(name));
  requireCondition(missing.length === 0, `TOKENS.md omits ledger variables: ${missing.join(", ")}`);
  requireCondition(
    result.size === expectedCount,
    `TOKENS.md must define ${expectedCount} variables`,
  );
  return result;
}

export function parseCss(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const theme = css.match(/^@theme(?:\s+static)?\s*\{([^{}]*)\}$/);
  requireCondition(theme, "tokens.css must contain exactly one @theme block");
  requireCondition(theme[1].trim().endsWith(";"), "Token declarations must end with a semicolon");
  const tokens = new Map();
  for (const statement of theme[1].split(";")) {
    if (!statement.trim()) continue;
    const declaration = statement.trim().match(/^(--[a-z][a-z0-9-]*)\s*:\s*([^;{}]+)$/);
    requireCondition(declaration, `Invalid token declaration: ${statement.trim()}`);
    const [, property, value] = declaration;
    requireCondition(!tokens.has(property), `Duplicate CSS property ${property}`);
    requireCondition(value.trim().length > 0, `Empty value for ${property}`);
    tokens.set(property, value.trim());
  }
  return tokens;
}

export function assertInSync(expected, actual) {
  const problems = [];
  for (const [property, value] of expected) {
    if (!actual.has(property)) problems.push(`missing ${property}`);
    else if (actual.get(property) !== value)
      problems.push(
        `value mismatch for ${property}: expected ${value}, received ${actual.get(property)}`,
      );
  }
  for (const property of actual.keys()) {
    if (!expected.has(property)) problems.push(`unexpected ${property}`);
  }
  requireCondition(
    problems.length === 0,
    `tokens.css is out of sync with TOKENS.md:\n${problems.join("\n")}`,
  );
}

export function renderTypeScript(tokens) {
  // Escaping the hash preserves exact CSS string values while keeping raw colour
  // literals confined to tokens.css. This file contains no duplicated token values.
  const literal = (value) => JSON.stringify(value).replaceAll("#", "\\u0023");
  const entries = [...tokens].map(([name, value]) => `  ${literal(name)}: ${literal(value)},`);
  return [
    "// Generated from tokens.css by scripts/gen.mjs. Do not edit by hand.",
    "// Colour hashes are escaped; runtime values exactly match the CSS source.",
    "export const tokens = Object.freeze({",
    ...entries,
    "} as const);",
    "",
    "export type TokenName = keyof typeof tokens;",
    "export type TokenValue = (typeof tokens)[TokenName];",
    "",
  ].join("\n");
}

export function assertGenerated(expected, actual) {
  requireCondition(
    expected === actual,
    "src/index.ts is stale; run node packages/design-tokens/scripts/gen.mjs",
  );
}

async function readInputs() {
  const [css, markdown, ledger] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(markdownUrl, "utf8"),
    readFile(ledgerUrl, "utf8"),
  ]);
  return { css, markdown, ledger: parseLedger(ledger) };
}

async function generate(check) {
  const { css, markdown, ledger } = await readInputs();
  const tokens = parseCss(css);
  assertInSync(parseSpecification(markdown, ledger), tokens);
  const generated = renderTypeScript(tokens);
  let current;
  try {
    current = await readFile(outputUrl, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (check) assertGenerated(generated, current);
  else if (current !== generated) await writeFile(outputUrl, generated);
  console.log(`tokens.css in sync with TOKENS.md (${tokens.size} vars)`);
}

async function runTests() {
  const { test } = await import("node:test");
  const assert = await import("node:assert/strict");
  const { css, markdown, ledger } = await readInputs();
  const expected = parseSpecification(markdown, ledger);
  const actual = parseCss(css);

  await test("all 36 CSS values and variable IDs match the frozen sources", () => {
    assert.equal(expected.size, expectedCount);
    assert.equal(actual.size, expectedCount);
    assertInSync(expected, actual);
  });
  await test("zodiac and spacing groups expand without missing members", () => {
    const zodiac = [...actual].filter(([name]) => name.startsWith("--color-z-"));
    assert.equal(zodiac.length, 12);
    zodiac.forEach(([, value], index) => {
      assert.equal(value, `hsl(${index * 30} 50% 68%)`);
    });
    const spacing = [...actual].filter(([name]) => name.startsWith("--spacing-"));
    assert.equal(spacing.length, 6);
    spacing.forEach(([name, value]) => {
      assert.equal(value, `${Number(name.slice("--spacing-".length)) * 4}px`);
    });
  });
  await test("missing, extra, renamed, and changed tokens fail even with unchanged counts", () => {
    const first = actual.keys().next().value;
    const missing = new Map(actual);
    missing.delete(first);
    assert.throws(() => assertInSync(expected, missing), /missing/);
    const extra = new Map(actual).set("--unexpected", "1px");
    assert.throws(() => assertInSync(expected, extra), /unexpected/);
    const renamed = new Map(missing).set("--renamed", actual.get(first));
    assert.equal(renamed.size, actual.size);
    assert.throws(() => assertInSync(expected, renamed), /missing[\s\S]*unexpected/);
    const changed = new Map(actual).set(first, "transparent");
    assert.throws(() => assertInSync(expected, changed), /value mismatch/);
  });
  await test("duplicate declarations and CSS outside the theme are rejected", () => {
    assert.throws(
      () => parseCss(css.replace(/}\s*$/, "  --size-touch: 1px;\n}")),
      /Duplicate CSS property/,
    );
    assert.throws(() => parseCss(`${css}\n:root { --extra: 1px; }`), /exactly one @theme/);
    assert.throws(() => parseCss(css.replace(/;\s*}/, "\n}")), /semicolon/);
    assert.throws(
      () => parseCss(css.replace("--size-touch:", "invalid:")),
      /Invalid token declaration/,
    );
  });
  await test("source changes and invalid or inconsistent ledger data are rejected", () => {
    const changed = markdown.replace("| 200 |", "| 201 |");
    assert.notEqual(changed, markdown);
    assert.throws(() => assertInSync(parseSpecification(changed, ledger), actual), /--size-stage/);
    assert.throws(() => parseLedger("{"), /not valid JSON/);
    assert.throws(() => parseLedger("{}"), /variables object/);
    const missing = structuredClone(ledger);
    delete missing.variables["z/aries"];
    assert.throws(() => parseLedger(JSON.stringify(missing)), /36 variables/);
    const duplicate = structuredClone(ledger);
    duplicate.variables["z/aries"] = duplicate.variables["z/taurus"];
    assert.throws(() => parseLedger(JSON.stringify(duplicate)), /Duplicate ledger variable ID/);
    const swapped = structuredClone(ledger);
    [swapped.variables["z/aries"], swapped.variables["z/taurus"]] = [
      swapped.variables["z/taurus"],
      swapped.variables["z/aries"],
    ];
    assert.throws(() => parseSpecification(markdown, swapped), /Zodiac endpoints/);
  });
  await test("generated TypeScript is current and deterministically preserves every value", async () => {
    const generated = renderTypeScript(actual);
    assert.equal(renderTypeScript(parseCss(css)), generated);
    assertGenerated(generated, await readFile(outputUrl, "utf8"));
    assert.throws(() => assertGenerated(generated, `${generated}\n`), /stale/);
    assert.throws(() => assertGenerated(generated, undefined), /stale/);
    assert.doesNotMatch(generated, /#[\da-f]{3,8}\b/i);
    // The generated module has only an as-const assertion and two type aliases.
    // Remove those to exercise its runtime export without a TypeScript loader.
    const javascript = generated.replace("} as const);", "});").replace(/^export type .*;\n/gm, "");
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
    const { tokens } = await import(moduleUrl);
    assert.deepEqual(Object.entries(tokens), [...actual]);
    assert.ok(Object.isFrozen(tokens));
    assert.throws(() => {
      tokens["--size-touch"] = "0px";
    }, TypeError);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(
      args.length === 0 || (args.length === 1 && ["--check", "--test"].includes(args[0])),
      "Usage: node scripts/gen.mjs [--check | --test]",
    );
    if (args[0] === "--test") await runTests();
    else await generate(args[0] === "--check");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
