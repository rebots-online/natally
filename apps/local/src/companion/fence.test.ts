// natally — C.2 verify.
// Accept: `fence: clean passes; 0.01° tolerance; violation→regen→absence chain exact`.
//
// The headline describe asserts the §7.2 chain law stepwise. The remaining
// describes cover the TEST_RUBRIC §TR-2 adversarial suite (six classes,
// table-driven, one violating sample each), the 0.01° tolerance boundary,
// scope assembly from real ChartFacts, three-tier prompt assembly with §5
// provenance labels, and the authored persona (D13 voice, INC-19 absence).
// The `generate` doubles are hand-rolled counting closures — no mocks.

import { ChartFactsSchema } from "@natally/ephemeris/types";
import { describe, expect, test } from "vitest";
import {
  assemblePrompt,
  checkFence,
  enforceFence,
  FENCE_ABSENCE_LINE,
  type FenceFragment,
  type FenceScope,
  type FenceViolationClass,
  fenceScopeFromChartFacts,
} from "./fence";
import { buildPersona, PERSONA_PROMPT } from "./persona";

// ---------------------------------------------------------------------------
// Fixtures — Tier 1 scope (computed), one Tier 2 lore fragment
// ---------------------------------------------------------------------------

const SCOPE: FenceScope = {
  positions: [
    { body: "sun", lon: 220.53 }, // 10°32′ Scorpio, house 9
    { body: "moon", lon: 44.53 }, // 14°32′ Taurus, house 12
    { body: "venus", lon: 150.53 }, // 0°32′ Virgo, house 5
    { body: "mars", lon: 29.03 }, // 29°02′ Aries, house 12
  ],
  aspects: [
    { pair: ["sun", "moon"], type: "opposition", orb: 4.0, applying: true },
    { pair: ["venus", "mars"], type: "trine", orb: 1.5, applying: false },
  ],
  dates: ["1994-03-03", "2026-09-16"],
  cusps: [100, 115, 130, 145, 160, 175, 190, 205, 220, 235, 250, 265],
  angles: { asc: 100, mc: 250 },
  signsInScope: ["scorpio", "taurus", "virgo", "aries", "cancer", "leo", "libra", "capricorn"],
  housesInScope: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  glossary: [
    { term: "opposition", body: "Two planets roughly facing each other across the wheel." },
  ],
};

const LORE: FenceFragment[] = [
  {
    sourceTurnId: "turn-42",
    text: "You told me your saturn return at 21° pisces wrecked your twenties.",
  },
];

const CLEAN =
  "Your Moon sits at 14°32′ Taurus in your 12th house. " +
  "Your Sun–Moon opposition is applying with an orb of 4°. " +
  "You were born on March 3, 1994, and today, September 16, 2026, your Venus trine Mars is separating. " +
  "Your Mars fights at 29.03 degrees of Aries. " +
  "Your Ascendant lands at 10° Cancer in the 1st house.";

// ---------------------------------------------------------------------------
// Headline accept line
// ---------------------------------------------------------------------------

describe("fence: clean passes; 0.01° tolerance; violation→regen→absence chain exact", () => {
  test("clean output passes untouched and never calls generate", async () => {
    let calls = 0;
    const result = await enforceFence({
      generate: () => {
        calls += 1;
        return "unused";
      },
      output: CLEAN,
      tier1: SCOPE,
    });
    expect(result.outcome).toBe("clean");
    expect(result.text).toBe(CLEAN);
    expect(result.violations).toEqual([]);
    expect(result.regenerations).toBe(0);
    expect(calls).toBe(0);
  });

  test("a Tier 1 value altered by exactly 0.01° passes; 0.0101° fails", () => {
    expect(checkFence("Your Moon rests at 14.54° tonight.", SCOPE)).toEqual([]);
    const violations = checkFence("Your Moon rests at 14.5401° tonight.", SCOPE);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.class).toBe(2);
  });

  test("violation → exactly one regeneration quoting it → still violating → absence line verbatim", async () => {
    const calls: string[] = [];
    const result = await enforceFence({
      generate: (note) => {
        calls.push(note);
        return "Your Venus glows at 23°17′ tonight, truly.";
      },
      output: "Your Venus glows at 23°17′ tonight.",
      tier1: SCOPE,
    });
    expect(result.outcome).toBe("absent");
    expect(FENCE_ABSENCE_LINE).toBe("I only say what your chart says");
    expect(result.text).toBe(FENCE_ABSENCE_LINE); // honest absence, EXACTLY
    expect(result.regenerations).toBeLessThanOrEqual(1); // regeneration count asserted ≤ 1
    expect(result.regenerations).toBe(1);
    expect(calls).toHaveLength(1); // generate called ONCE
    expect(calls[0] ?? "").toContain('"Your Venus glows at 23°17′ tonight."'); // violation quoted
    expect(calls[0] ?? "").toContain("Fence violation");
    expect(result.violations).toHaveLength(2); // first + regenerated attempt
  });

  test("violation → clean regeneration is returned (chain succeeds after exactly one retry)", async () => {
    const calls: string[] = [];
    const result = await enforceFence({
      generate: async (note) => {
        calls.push(note);
        return "Your Moon sits at 14°32′ Taurus.";
      },
      output: "Your Moon sits at 14°39′ Taurus.",
      tier1: SCOPE,
    });
    expect(result.outcome).toBe("regenerated");
    expect(result.text).toBe("Your Moon sits at 14°32′ Taurus.");
    expect(result.regenerations).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.violations).toHaveLength(1);
  });

  test("maxRegenerations 0 skips generate; custom absentFallback is returned exactly", async () => {
    let calls = 0;
    const result = await enforceFence({
      generate: () => {
        calls += 1;
        return "unused";
      },
      output: "Your Venus glows at 23°17′ tonight.",
      tier1: SCOPE,
      maxRegenerations: 0,
      absentFallback: "—",
    });
    expect(result.outcome).toBe("absent");
    expect(result.text).toBe("—");
    expect(result.regenerations).toBe(0);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TR-2 adversarial suite — table-driven, one violating sample per class
// ---------------------------------------------------------------------------

interface Tr2Case {
  name: string;
  output: string;
  class: FenceViolationClass;
  quoted: string;
  tier2?: readonly FenceFragment[];
}

const TR2_CASES: readonly Tr2Case[] = [
  {
    name: "1 fabricated degree — number not present in Tier 1",
    output: "Your Venus glows at 23°17′ tonight.",
    class: 1,
    quoted: "23°17′",
  },
  {
    name: "2 off-by-tolerance — Tier 1 value altered by > 0.01°",
    output: "Your Moon rests at 14.5402° right now.",
    class: 2,
    quoted: "14.5402",
  },
  {
    name: "3 wrong sign name — degree matches, label inconsistent",
    output: "Your Moon sits at 14°32′ Gemini today.",
    class: 3,
    quoted: "Gemini",
  },
  {
    name: "3 wrong house name — degree scope, house label inconsistent",
    output: "Your Moon sits in your 11th house tonight.",
    class: 3,
    quoted: "11th house",
  },
  {
    name: "4 invented date — absent from Tier 1 dates",
    output: "Back on March 9, 1994, your Moon was loud.",
    class: 4,
    quoted: "March 9, 1994",
  },
  {
    name: "5 invented orb — contradicted by Tier 1 orb",
    output: "The Sun–Moon opposition is nearly exact — an orb of 5.5°.",
    class: 5,
    quoted: "5.5°",
  },
  {
    name: "5 contradicted applying/separating — Tier 1 says applying",
    output: "Your Sun–Moon opposition is separating, honestly.",
    class: 5,
    quoted: "separating",
  },
  {
    name: "6 lore contamination — astrological claim sourced only from Tier 2",
    output: "That Saturn return at 21° shaped so much for you.",
    class: 6,
    quoted: "Saturn return at 21°",
    tier2: LORE,
  },
];

describe("fence: TR-2 adversarial classes — every class fails, one violating sample each", () => {
  test.each(TR2_CASES)("$name", ({ output, class: cls, quoted, tier2 }) => {
    const violations = checkFence(output, SCOPE, tier2);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.class).toBe(cls);
    expect(violations[0]?.snippet).toContain(quoted); // the offending text is quoted
    expect(violations[0]?.message.length ?? 0).toBeGreaterThan(0);
  });

  test("the same lore-echoing sample without Tier 2 fragments stays class 1 (provenance of the label)", () => {
    const violations = checkFence("That Saturn return at 21° shaped so much for you.", SCOPE);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.class).toBe(1);
  });

  test("a Tier 1-backed value that also appears in lore is clean (lore is only a source when Tier 1 is silent)", () => {
    const lore: FenceFragment[] = [
      { sourceTurnId: "turn-7", text: "she said her moon at 14°32′ taurus felt like home" },
    ];
    expect(checkFence("Your Moon sits at 14°32′ Taurus.", SCOPE, lore)).toEqual([]);
  });

  test("a solar chart (no birth time) has no houses and no angles — both claims violate", () => {
    const solar: FenceScope = { ...SCOPE, cusps: undefined, angles: undefined, housesInScope: [] };
    const house = checkFence("Your Moon hides in the 5th house tonight.", solar);
    expect(house).toHaveLength(1);
    expect(house[0]?.class).toBe(1);
    const angle = checkFence("Your Ascendant shines at 10°.", solar);
    expect(angle).toHaveLength(1);
    expect(angle[0]?.class).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scope assembly from computed ChartFacts
// ---------------------------------------------------------------------------

describe("fence: FenceScope from ChartFacts — positions, cusps, aspects, signs, houses", () => {
  const facts = ChartFactsSchema.parse({
    id: "chart-fixture-1",
    inputs: { ut: [2449449.5], place: { lat: 52.52, lon: 13.405 }, system: "P" },
    positions: [
      { body: "sun", lon: 220.53, lat: 0, speed: 1 },
      { body: "moon", lon: 44.53, lat: 0, speed: 13 },
    ],
    cusps: {
      cusps: [100, 115, 130, 145, 160, 175, 190, 205, 220, 235, 250, 265],
      asc: 100,
      mc: 250,
      armc: 245,
    },
    aspects: [{ a: "sun", b: "moon", type: "opposition", orb: 4, applying: true }],
  });

  test("scope mirrors the computed facts and derives signs/houses/angles", () => {
    const scope = fenceScopeFromChartFacts(facts, { dates: ["1994-03-03"] });
    expect(scope.positions).toEqual([
      { body: "sun", lon: 220.53 },
      { body: "moon", lon: 44.53 },
    ]);
    expect(scope.aspects).toHaveLength(1);
    expect(scope.aspects[0]).toMatchObject({ orb: 4, applying: true, type: "opposition" });
    expect(scope.cusps).toHaveLength(12);
    expect(scope.angles).toEqual({ asc: 100, mc: 250 });
    expect(scope.signsInScope).toContain("scorpio"); // sun
    expect(scope.signsInScope).toContain("taurus"); // moon
    expect(scope.signsInScope).toContain("cancer"); // cusp/ascendant sign
    expect(scope.signsInScope).toContain("sagittarius"); // midheaven sign (250° → Sagittarius)
    expect(scope.housesInScope).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(scope.dates).toEqual(["1994-03-03"]);
  });

  test("the derived scope fences real companion output", () => {
    const scope = fenceScopeFromChartFacts(facts);
    expect(checkFence("Your Moon sits at 14°32′ Taurus in your 12th house.", scope)).toEqual([]);
    expect(checkFence("Your Moon sits at 14°32′ Gemini.", scope)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Three-tier prompt assembly (§7.2 tiers, §5 provenance labels)
// ---------------------------------------------------------------------------

describe("fence: assemblePrompt — three tiers, provenance labels, lore turn ids", () => {
  const parts = {
    tier1: SCOPE,
    tier2: LORE,
    tier3: {
      userTurn: "what's in my sky today?",
      toolResults: ["dom.read → transcript pane (masked)"],
    },
    persona: PERSONA_PROMPT,
  };
  const prompt = assemblePrompt(parts);

  test("tier markers and §5 provenance classes are present", () => {
    expect(prompt).toContain("[TIER1 | provenance: computed]");
    expect(prompt).toContain("[TIER1 GLOSSARY | provenance: authored]");
    expect(prompt).toContain("[TIER2 | provenance: generated");
    expect(prompt).toContain("[TIER3 | provenance: live turn]");
  });

  test("tier 1 carries serialized facts, tier 2 the sourceTurnId, tier 3 the live turn", () => {
    expect(prompt).toContain("44.53");
    expect(prompt).toContain("1994-03-03");
    expect(prompt).toContain("[turn turn-42]");
    expect(prompt).toContain("YOU: what's in my sky today?");
    expect(prompt).toContain("TOOL: dom.read");
  });

  test("the fence law and honest-absence line are part of the assembled contract", () => {
    expect(prompt).toContain(FENCE_ABSENCE_LINE);
    expect(prompt).toContain("[FENCE LAW]");
  });

  test("assembly is deterministic", () => {
    expect(assemblePrompt(parts)).toBe(prompt);
  });
});

// ---------------------------------------------------------------------------
// Persona (D13 voice law, INC-19 honest absence)
// ---------------------------------------------------------------------------

describe("persona: authored voice law (D13) + honest absence (INC-19)", () => {
  test("PERSONA_PROMPT is warm, approachable, never clinical, and carries the fence law", () => {
    expect(PERSONA_PROMPT).toContain("Warm, approachable, ultra-relatable");
    expect(PERSONA_PROMPT).toContain("Never clinical");
    expect(PERSONA_PROMPT).toContain(FENCE_ABSENCE_LINE);
    expect(PERSONA_PROMPT).toContain("TIER 1");
    expect(PERSONA_PROMPT).toContain("Memory never licenses a new astrological claim");
  });

  test("buildPersona() is the authored base; variants append; blank variants drop", () => {
    expect(buildPersona()).toBe(PERSONA_PROMPT);
    const extended = buildPersona(["Extra voice note for the season.", "  "]);
    expect(extended.startsWith(PERSONA_PROMPT)).toBe(true);
    expect(extended).toContain("Extra voice note for the season.");
  });
});
