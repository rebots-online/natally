import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_MICRO_COPY,
  COPY_MONTHLY_SUBTITLE_TEMPLATE,
  COPY_MONTHLY_TITLE,
  COPY_PAYG_SUBTITLE,
  COPY_PAYG_TITLE,
  COPY_UNLIMITED_SUBTITLE,
  COPY_UNLIMITED_TITLE,
  MICRO_COPY_ADD_CREDITS,
  MICRO_COPY_OFFLINE,
  MICRO_COPY_RESTORE,
  OFFER_CATALOG,
  renderMonthlySubtitle,
  DEFAULT_MONTHLY_AMOUNT,
} from "../src/offers.js";
import offerCopyJson from "../src/offer-copy.json";

/**
 * OR.2 — Customer language enforcement, architecture §21.2.
 *
 * Customer-facing copy discusses chatting with natally only. Forbidden:
 * "local", "inference", "ephemeris", model names (qwen/kokoro/minilm/lfm/
 * bonsai), token accounting, quantization, API routing. All matched
 * whole-word, case-insensitive, so "locality" or "$ROCHE"-adjacent copy
 * does not false-positive.
 *
 * The enumerated customer-copy module set is closed:
 *   - packages/billing/src/offers.ts (exported copy strings)
 *   - packages/billing/src/offer-copy.json (all string values)
 * Legal documents (apps/local/public/legal/privacy.html, terms.html) are
 * NOT scanned — §21.2's carve-out: legal copy may use technical terms lawfully.
 */

export interface Violation {
  file: string;
  term: string;
  value: string;
}

/** Pure scanner so the fail-red self-test can run against fixtures without mutating real modules. */
export function scanForForbiddenTerms(
  strings: ReadonlyArray<{ file: string; value: string }>,
): Violation[] {
  const forbidden = [
    "local",
    "inference",
    "ephemeris",
    "qwen",
    "kokoro",
    "minilm",
    "lfm",
    "bonsai",
    "token",
    "quantization",
    "api",
  ];
  const violations: Violation[] = [];
  for (const { file, value } of strings) {
    for (const term of forbidden) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${term}(?![\\p{L}\\p{N}_])`, "iu");
      if (re.test(value)) {
        violations.push({ file, term, value });
      }
    }
  }
  return violations;
}

/** All customer-facing copy strings shipped by offers.ts (closed, explicit enumeration). */
function offersTsCopyStrings(): Array<{ file: string; value: string }> {
  const constants = [
    COPY_UNLIMITED_TITLE,
    COPY_UNLIMITED_SUBTITLE,
    COPY_PAYG_TITLE,
    COPY_PAYG_SUBTITLE,
    COPY_MONTHLY_TITLE,
    COPY_MONTHLY_SUBTITLE_TEMPLATE,
    MICRO_COPY_ADD_CREDITS,
    MICRO_COPY_OFFLINE,
    MICRO_COPY_RESTORE,
  ].map((value) => ({ file: "packages/billing/src/offers.ts", value }));
  const catalogCopy = OFFER_CATALOG.flatMap((entry) => [
    { file: "packages/billing/src/offers.ts", value: entry.copy.title },
    { file: "packages/billing/src/offers.ts", value: entry.copy.subtitle },
    { file: "packages/billing/src/offers.ts", value: renderMonthlySubtitle(DEFAULT_MONTHLY_AMOUNT) },
  ]);
  return [...constants, ...catalogCopy];
}

/** All string values in offer-copy.json (walked exhaustively, not hand-listed). */
function offerCopyJsonStrings(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      out.push({ file: "packages/billing/src/offer-copy.json", value: node });
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(offerCopyJson);
  return out;
}

const ALL_CUSTOMER_COPY = [...offersTsCopyStrings(), ...offerCopyJsonStrings()];

describe("language law (architecture §21.2)", () => {
  it("zero forbidden terms in customer surfaces", () => {
    const violations = scanForForbiddenTerms(ALL_CUSTOMER_COPY);
    const report = violations
      .map((v) => `${v.file}: forbidden term "${v.term}" in ${JSON.stringify(v.value)}`)
      .join("\n");
    expect(report, report === "" ? undefined : report).toBe("");
  });

  it("approved micro-copy appears exactly once each in the copy modules", () => {
    for (const approved of APPROVED_MICRO_COPY) {
      const count = ALL_CUSTOMER_COPY.filter((s) => s.value === approved).length;
      expect(
        count,
        `approved micro-copy ${JSON.stringify(approved)} appears ${count} times (expected exactly 2: offers.ts export + offer-copy.json)`,
      ).toBe(2);
    }
  });

  it("offer-copy.json stays byte-equal to the §21.1 approved copy table", () => {
    const json = offerCopyJson as {
      offers: Array<{ id: string; title: string; subtitle: string; subtitleTemplate?: string }>;
      microCopy: { addCredits: string; offline: string; restore: string };
    };
    expect(json.offers[0].title).toBe(COPY_UNLIMITED_TITLE);
    expect(json.offers[0].subtitle).toBe(COPY_UNLIMITED_SUBTITLE);
    expect(json.offers[1].title).toBe(COPY_PAYG_TITLE);
    expect(json.offers[1].subtitle).toBe(COPY_PAYG_SUBTITLE);
    expect(json.offers[2].title).toBe(COPY_MONTHLY_TITLE);
    expect(json.offers[2].subtitleTemplate).toBe(COPY_MONTHLY_SUBTITLE_TEMPLATE);
    expect(json.microCopy.addCredits).toBe(MICRO_COPY_ADD_CREDITS);
    expect(json.microCopy.offline).toBe(MICRO_COPY_OFFLINE);
    expect(json.microCopy.restore).toBe(MICRO_COPY_RESTORE);
  });

  it("fail-red proven: the scanner reports a seeded fixture violation", () => {
    const seeded = scanForForbiddenTerms([
      { file: "FIXTURE", value: "Powered by on-device inference with the Kokoro engine" },
      { file: "FIXTURE", value: "Your $ROCHE balance is fine; token count hidden" },
      { file: "FIXTURE", value: "Unlimited chats with natally" },
    ]);
    expect(seeded).toEqual([
      { file: "FIXTURE", term: "inference", value: "Powered by on-device inference with the Kokoro engine" },
      { file: "FIXTURE", term: "kokoro", value: "Powered by on-device inference with the Kokoro engine" },
      { file: "FIXTURE", term: "token", value: "Your $ROCHE balance is fine; token count hidden" },
    ]);
  });

  it("fail-red proven: whole-word matching does not false-positive on near-miss copy", () => {
    const clean = scanForForbiddenTerms([
      { file: "FIXTURE", value: "Add $ROCHE to keep chatting." },
      { file: "FIXTURE", value: "Your locality and locale settings are respected." },
      { file: "FIXTURE", value: "Capitalize on credit, monetize politely." },
    ]);
    expect(clean).toEqual([]);
  });

  it("scanned set is the closed enumerated module list", () => {
    const files = new Set(ALL_CUSTOMER_COPY.map((s) => s.file));
    expect([...files].sort()).toEqual([
      "packages/billing/src/offer-copy.json",
      "packages/billing/src/offers.ts",
    ]);
    // The real JSON file on disk matches the imported module (guards against drift).
    const onDisk = JSON.parse(
      readFileSync(resolve(__dirname, "../src/offer-copy.json"), "utf8"),
    );
    expect(onDisk).toEqual(offerCopyJson);
    expect(ALL_CUSTOMER_COPY.length).toBeGreaterThan(0);
  });
});
