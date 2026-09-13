import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
const specification = readFileSync(
  new URL("../../../LIBS/UI/FIGMA/TOKENS.md", import.meta.url),
  "utf8",
);
const ledgerText = readFileSync(
  new URL("../../../LIBS/UI/FIGMA/STATE-LEDGER.json", import.meta.url),
  "utf8",
);

function readLedger(): Record<string, string> {
  try {
    const ledger: { variables: Record<string, string> } = JSON.parse(ledgerText);
    return ledger.variables;
  } catch (cause) {
    throw new Error("Cannot read the frozen variable ledger", { cause });
  }
}

describe("tokens: 36 variables mirrored exactly", () => {
  it("matches every CSS column and value in the frozen markdown tables", () => {
    const actual = new Map(
      [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
        match[1],
        match[2].trim(),
      ]),
    );
    const expected = new Map<string, string>();
    const variables = readLedger();
    for (const line of specification.split("\n")) {
      if (!line.startsWith("|")) continue;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim());
      const [name, , value, , property] = cells;
      if (!property || !/^--[a-z]/.test(property)) continue;
      if (property === "--color-z-<sign>") {
        const ramp = value.match(/(\d+) hues at (\d+)° \(HSL (\d+)% \/ (\d+)%\)/);
        expect(ramp).not.toBeNull();
        if (!ramp) throw new Error("Zodiac ramp specification is missing");
        const signs = Object.keys(variables).filter((key) => key.startsWith("z/"));
        expect(signs).toHaveLength(Number(ramp[1]));
        signs.forEach((sign, index) => {
          expected.set(
            `--color-z-${sign.slice(2)}`,
            `hsl(${index * Number(ramp[2])} ${ramp[3]}% ${ramp[4]}%)`,
          );
        });
      } else if (property === "--spacing-<n>") {
        const numbers = name.replace("space/", "").split(/\s+/);
        const values = value.split(/\s+/);
        numbers.forEach((number, index) => {
          expected.set(`--spacing-${number}`, `${values[index]}px`);
        });
      } else {
        expected.set(
          property,
          property.startsWith("--color-") ? value.toLowerCase() : `${value}px`,
        );
      }
    }
    expect(Object.keys(variables)).toHaveLength(36);
    expect(expected.size).toBe(36);
    expect(actual).toEqual(expected);
  });

  it("contains one theme block with the complete category counts", () => {
    expect(css.match(/@theme\b/g)).toHaveLength(1);
    const properties = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    expect(new Set(properties).size).toBe(properties.length);
    expect(properties.filter((name) => name.startsWith("--color-z-"))).toHaveLength(12);
    expect(
      properties.filter((name) => name.startsWith("--color-") && !name.startsWith("--color-z-")),
    ).toHaveLength(10);
    expect(properties.filter((name) => name.startsWith("--radius-"))).toHaveLength(4);
    expect(properties.filter((name) => name.startsWith("--spacing-"))).toHaveLength(6);
    expect(properties.filter((name) => name.startsWith("--stroke-"))).toHaveLength(1);
    expect(properties.filter((name) => name.startsWith("--size-"))).toHaveLength(3);
  });
});
