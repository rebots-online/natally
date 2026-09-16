// natally — C.2: the three-tier prompt fence + post-generation fence checker
// (ARCHITECTURE §7.2 — normative; TEST_RUBRIC §TR-2 — adversarial suite).
//
// Tier assembly: `assemblePrompt` renders exactly three tiers, each tagged with
// its §5 provenance class — TIER 1 computed chart facts (+ authored glossary),
// TIER 2 generated lore fragments (each carrying its `sourceTurnId`; memory
// informs continuity, never new astrological claims), TIER 3 the live turn and
// in-flight tool results — plus the authored persona prompt.
//
// Fence checker: `checkFence` parses every astrological number/name out of the
// companion's output — degrees ("14°32′", "14.53°", "14 degrees"), orbs, dates,
// sign names, house names, applying/separating words, aspect-type words — and
// requires each to resolve to the Tier 1 `FenceScope` within 0.01° (0.01°
// exactly passes; sign and house labels must be consistent with the resolved
// value). Degrees are read as sign-relative values — the way people speak
// ("14°32′ Taurus") — matched against `lon % 30` of the nearest anchored
// body/angle in the same sentence, or against the whole scope pool when no
// anchor is named. Two in-scope bodies plus an orb / applying-separating /
// aspect-type word in one sentence form an aspect claim that must exist in
// Tier 1. Unverifiable claims fail closed; a solar chart has no houses and no
// angles anywhere, so any such claim violates (§6 honest absence).
//
// Chain law (§7.2): a violation triggers EXACTLY ONE regeneration whose prompt
// quotes the offending snippet; a still-violating reply collapses to the
// honest-absence line — `FENCE_ABSENCE_LINE` ("I only say what your chart
// says") — returned verbatim. Violation classes follow TR-2:
//   1 fabricated degree · 2 off-by-tolerance (> 0.01°) · 3 wrong sign/house
//   name · 4 invented date · 5 invented orb or contradicted
//   applying/separating · 6 lore contamination (an astrological claim whose
//   only source is a Tier 2 fragment).
//
// Purity: nothing here reads a clock, mutates its inputs, touches a network,
// or logs (house rule: no console in src).

import type { AspectType, Body, ChartFacts } from "@natally/ephemeris/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The honest-absence line (§7.2 chain law / TR-2). Verbatim and assertable. */
export const FENCE_ABSENCE_LINE = "I only say what your chart says";

/** Degree match tolerance (§7.2): a spoken value must sit within 0.01° of a Tier 1 value. */
export const FENCE_TOLERANCE_DEG = 0.01;

/** Floating-point guard so a delta of exactly 0.01° passes (44.53 % 30 is not exact in base 2). */
const TOLERANCE_EPS = 1e-9;

/**
 * Below this distance from a Tier 1 value, an unmatched numeric claim is
 * *labeled* "off by tolerance" (TR-2 class 2) rather than wholly fabricated
 * (class 1). Diagnostic labeling only — both classes violate.
 */
const OFF_BY_PROXIMITY_DEG = 1.0;

/** Longest snippet carried on a violation (the quoted regeneration evidence). */
const SNIPPET_MAX = 160;

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
] as const;
export type SignName = (typeof SIGNS)[number];

const SIGN_LOOKUP: ReadonlyMap<string, SignName> = new Map(SIGNS.map((s) => [s, s]));

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Spoken forms for each `Body` (§6 union; ids like "north-node" are spoken spaced). */
const BODY_TERMS: readonly (readonly [Body, string])[] = [
  ["sun", "sun"],
  ["moon", "moon"],
  ["mercury", "mercury"],
  ["venus", "venus"],
  ["mars", "mars"],
  ["jupiter", "jupiter"],
  ["saturn", "saturn"],
  ["uranus", "uranus"],
  ["neptune", "neptune"],
  ["pluto", "pluto"],
  ["chiron", "chiron"],
  ["north-node", "north node"],
  ["south-node", "south node"],
];

/** Spoken forms for the principal angles; only verifiable when houses are in scope. */
const ANGLE_TERMS: readonly (readonly [string, "asc" | "mc"])[] = [
  ["ascendant", "asc"],
  ["rising", "asc"],
  ["midheaven", "mc"],
  ["mc", "mc"],
];

const ASPECT_TYPE_WORDS: Readonly<Record<string, AspectType>> = {
  conjunct: "conjunction",
  conjunction: "conjunction",
  opposition: "opposition",
  trine: "trine",
  square: "square",
  sextile: "sextile",
  quincunx: "quincunx",
  semisextile: "semisextile",
};

// ---------------------------------------------------------------------------
// Tier 1 scope (the fence's ground truth)
// ---------------------------------------------------------------------------

export interface FenceScopePosition {
  body: Body;
  lon: number;
}

export interface FenceScopeAspect {
  pair: readonly [Body, Body];
  orb: number;
  applying: boolean;
  type?: AspectType;
}

/** Authored glossary definition (§5 provenance `authored`), rendered inside Tier 1. */
export interface GlossaryEntry {
  term: string;
  body: string;
}

/**
 * The Tier 1 values companion output may legally state (C.2 scope shape).
 * `dates` are caller-supplied civil dates in scope (birth/transit); `cusps`
 * (12 ascending longitudes) and `angles` are present only for a timed chart.
 */
export interface FenceScope {
  positions: readonly FenceScopePosition[];
  aspects: readonly FenceScopeAspect[];
  dates: readonly string[];
  cusps?: readonly number[];
  angles?: { asc: number; mc: number };
  signsInScope: readonly string[];
  housesInScope: readonly number[];
  glossary?: readonly GlossaryEntry[];
}

/** One Tier 2 lore fragment; `sourceTurnId` is the §8.3 provenance back into the transcript. */
export interface FenceFragment {
  text: string;
  sourceTurnId: string;
}

function normalizeDeg(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

function signAt(idx: number): SignName {
  const sign = SIGNS[idx];
  // idx is always 0–11 by construction (modulo of a normalized longitude);
  // the fallback only satisfies noUncheckedIndexedAccess.
  return sign ?? "aries";
}

function signOfLon(lon: number): SignName {
  return signAt(Math.floor(normalizeDeg(lon) / 30) % 12);
}

function houseOfLon(lon: number, cusps: readonly number[]): number {
  for (let i = 0; i < 12 && i < cusps.length; i++) {
    const cusp = cusps[i];
    if (cusp === undefined) continue;
    const next = cusps[(i + 1) % 12] ?? cusp;
    let span = next - cusp;
    if (span <= 0) span += 360;
    if (normalizeDeg(lon - cusp) < span) return i + 1;
  }
  return 0;
}

/** Builds the Tier 1 scope from computed `ChartFacts` (§5: provenance `computed`). */
export function fenceScopeFromChartFacts(
  facts: ChartFacts,
  extra?: { dates?: readonly string[]; glossary?: readonly GlossaryEntry[] },
): FenceScope {
  const cusps: number[] | undefined = facts.cusps ? [...facts.cusps.cusps] : undefined;
  const signs = new Set<string>();
  for (const p of facts.positions) signs.add(signOfLon(p.lon));
  if (cusps) for (const c of cusps) signs.add(signOfLon(c));
  if (facts.cusps) {
    signs.add(signOfLon(facts.cusps.asc));
    signs.add(signOfLon(facts.cusps.mc));
  }
  return {
    positions: facts.positions.map((p) => ({ body: p.body, lon: p.lon })),
    aspects: facts.aspects.map((a) => ({
      pair: [a.a, a.b] as const,
      orb: a.orb,
      applying: a.applying,
      type: a.type,
    })),
    dates: extra?.dates ? [...extra.dates] : [],
    cusps,
    angles: facts.cusps ? { asc: facts.cusps.asc, mc: facts.cusps.mc } : undefined,
    signsInScope: [...signs],
    housesInScope: cusps ? Array.from({ length: 12 }, (_, i) => i + 1) : [],
    glossary: extra?.glossary ? [...extra.glossary] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly (§7.2 tiers + §5 provenance labels)
// ---------------------------------------------------------------------------

export interface PromptTier3 {
  userTurn: string;
  toolResults?: readonly string[];
}

export interface PromptParts {
  tier1: FenceScope;
  tier2: readonly FenceFragment[];
  tier3: PromptTier3;
  persona: string;
}

/** Plain-object scope with fixed key order, so serialization is deterministic. */
function serializeScope(scope: FenceScope): unknown {
  return {
    positions: scope.positions.map((p) => ({ body: p.body, lon: p.lon })),
    aspects: scope.aspects.map((a) => ({
      pair: [a.pair[0], a.pair[1]],
      ...(a.type !== undefined ? { type: a.type } : {}),
      orb: a.orb,
      applying: a.applying,
    })),
    dates: [...scope.dates],
    ...(scope.cusps !== undefined ? { cusps: [...scope.cusps] } : {}),
    ...(scope.angles !== undefined
      ? { angles: { asc: scope.angles.asc, mc: scope.angles.mc } }
      : {}),
    signsInScope: [...scope.signsInScope],
    housesInScope: [...scope.housesInScope],
  };
}

export function assemblePrompt(parts: PromptParts): string {
  const lines: string[] = [];
  lines.push("[PERSONA]", parts.persona.trim(), "");
  lines.push("[TIER1 | provenance: computed]");
  lines.push(JSON.stringify(serializeScope(parts.tier1)));
  const glossary = parts.tier1.glossary ?? [];
  if (glossary.length > 0) {
    lines.push("[TIER1 GLOSSARY | provenance: authored]");
    for (const g of glossary) lines.push(`- ${g.term}: ${g.body}`);
  }
  lines.push(
    "",
    "[TIER2 | provenance: generated — memory for continuity, never a source of astrological facts]",
  );
  for (const f of parts.tier2) lines.push(`[turn ${f.sourceTurnId}] ${f.text}`);
  lines.push("", "[TIER3 | provenance: live turn]", `YOU: ${parts.tier3.userTurn}`);
  for (const t of parts.tier3.toolResults ?? []) lines.push(`TOOL: ${t}`);
  lines.push(
    "",
    `[FENCE LAW] Every degree, orb, date, sign and house you state must come from TIER1. If a fact is not there, say: "${FENCE_ABSENCE_LINE}"`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fence checker
// ---------------------------------------------------------------------------

export type FenceViolationClass = 1 | 2 | 3 | 4 | 5 | 6;

const CLASS_LABELS: Readonly<Record<FenceViolationClass, string>> = {
  1: "fabricated-degree",
  2: "off-by-tolerance",
  3: "name-mismatch",
  4: "invented-date",
  5: "aspect-claim",
  6: "lore-contamination",
};

export interface FenceViolation {
  class: FenceViolationClass;
  label: string;
  /** The offending text, quoted. */
  snippet: string;
  message: string;
}

interface ViolationCandidate extends FenceViolation {
  /** Core token used for Tier 2 contamination matching (diagnostic relabel to class 6). */
  core: string;
}

interface DegreeClaim {
  value: number;
  raw: string;
  pos: number;
}
interface OrbClaim {
  value: number;
  raw: string;
  pos: number;
}
interface SignClaim {
  word: SignName;
  pos: number;
}
interface HouseClaim {
  n: number;
  raw: string;
  pos: number;
}
interface WordClaim {
  word: string;
  pos: number;
}

type Anchor =
  | { kind: "body"; body: Body; label: string; lon?: number; pos: number }
  | { kind: "angle"; angle: "asc" | "mc"; label: string; lon?: number; pos: number };

const DMS_SOURCE = "(\\d{1,2})\\s*°\\s*(\\d{1,2})\\s*(?:'|′|’)(?:\\s*(\\d{1,2})\\s*(?:\"|″|”))?";
const DEC_SOURCE = "(\\d{1,3}(?:\\.\\d+)?)\\s*°";
const WORD_SOURCE = "(\\d{1,3}(?:\\.\\d+)?)\\s+degrees?\\b";
const ORB_AFTER_SOURCE = "\\borb\\b(?:\\s+of)?\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*°";
const ORB_BEFORE_SOURCE = "(\\d{1,3}(?:\\.\\d+)?)\\s*°\\s*orb\\b";
const APPLYING_SOURCE = "\\b(applying|separating)\\b";
const TYPE_SOURCE =
  "\\b(conjunct|conjunction|opposition|trine|square|sextile|quincunx|semisextile)\\b";
const HOUSE_ORDINAL_SOURCE = "\\b(\\d{1,2})(?:st|nd|rd|th)\\s+houses?\\b";
const HOUSE_POST_SOURCE = "\\bhouses?\\s+(\\d{1,2})\\b";

type DateKind = "iso" | "mdy" | "dmy" | "slash";
const DATE_PATTERNS: readonly (readonly [RegExp, DateKind])[] = [
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, "iso"],
  [/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/g, "iso"],
  [
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})\b/g,
    "mdy",
  ],
  [
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/g,
    "dmy",
  ],
  [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, "slash"],
];

function isoFrom(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isoFromMatch(m: RegExpMatchArray, kind: DateKind): string | null {
  const g = (i: number): string | undefined => m[i];
  const y = g(3);
  if (kind === "mdy") {
    const mo = MONTHS[g(1) ?? ""] ?? 0;
    const d = g(2);
    return y === undefined || d === undefined ? null : isoFrom(Number(y), mo, Number(d));
  }
  if (kind === "dmy") {
    const d = g(1);
    const mo = MONTHS[g(2) ?? ""] ?? 0;
    return y === undefined || d === undefined ? null : isoFrom(Number(y), mo, Number(d));
  }
  const y0 = kind === "iso" ? g(1) : g(3);
  const mo0 = kind === "iso" ? g(2) : g(1);
  const d0 = kind === "iso" ? g(3) : g(2);
  return y0 === undefined || mo0 === undefined || d0 === undefined
    ? null
    : isoFrom(Number(y0), Number(mo0), Number(d0));
}

/** Normalizes a scope-side date string to ISO `YYYY-MM-DD`; unparseable entries never match. */
function normalizeScopeDate(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  for (const [re, kind] of DATE_PATTERNS) {
    const anchored = new RegExp(`^(?:${re.source})$`.replace(/\\b/g, ""), "");
    const m = anchored.exec(t);
    if (m) return isoFromMatch(m, kind);
  }
  return null;
}

function blankMatches(text: string, matches: readonly RegExpMatchArray[]): string {
  let out = text;
  for (const m of matches) {
    const idx = m.index;
    if (idx === undefined) continue;
    out = out.slice(0, idx) + " ".repeat(m[0].length) + out.slice(idx + m[0].length);
  }
  return out;
}

function collectAnchors(scope: FenceScope, work: string): Anchor[] {
  const anchors: Anchor[] = [];
  for (const [body, term] of BODY_TERMS) {
    const re = new RegExp(`\\b${term.split(/\s+/).join("\\s+")}\\b`, "g");
    for (const m of work.matchAll(re)) {
      if (m.index === undefined) continue;
      const pos = scope.positions.find((p) => p.body === body);
      anchors.push({ kind: "body", body, label: body, lon: pos?.lon, pos: m.index });
    }
  }
  for (const [term, angle] of ANGLE_TERMS) {
    const re = new RegExp(`\\b${term}\\b`, "g");
    for (const m of work.matchAll(re)) {
      if (m.index === undefined) continue;
      anchors.push({
        kind: "angle",
        angle,
        label: angle === "asc" ? "Ascendant" : "Midheaven",
        lon: scope.angles?.[angle],
        pos: m.index,
      });
    }
  }
  anchors.sort((a, b) => a.pos - b.pos);
  return anchors;
}

function nearestAnchor(anchors: readonly Anchor[], pos: number): Anchor | undefined {
  let best: Anchor | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of anchors) {
    const d = Math.abs(a.pos - pos);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

/** First two distinct in-scope bodies in the sentence, if any (aspect-claim binding). */
function sentencePair(anchors: readonly Anchor[]): { a: Body; b: Body } | undefined {
  let first: Body | undefined;
  let second: Body | undefined;
  for (const a of anchors) {
    if (a.kind !== "body" || a.lon === undefined) continue;
    if (first === undefined) {
      first = a.body;
      continue;
    }
    if (a.body !== first) {
      second = a.body;
      break;
    }
  }
  return first !== undefined && second !== undefined ? { a: first, b: second } : undefined;
}

function aspectsForPair(
  scope: FenceScope,
  pair: { a: Body; b: Body } | undefined,
): readonly FenceScopeAspect[] {
  if (!pair) return scope.aspects;
  return scope.aspects.filter(
    (as) =>
      (as.pair[0] === pair.a && as.pair[1] === pair.b) ||
      (as.pair[0] === pair.b && as.pair[1] === pair.a),
  );
}

function fmtDeg(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

/**
 * Validates companion output against Tier 1 (and, optionally, Tier 2 lore for
 * contamination labeling). Returns every violation; an empty array is a clean pass.
 */
export function checkFence(
  output: string,
  tier1: FenceScope,
  tier2?: readonly FenceFragment[],
): FenceViolation[] {
  const found: ViolationCandidate[] = [];
  const seen = new Set<string>();

  const scopeDates = new Set<string>();
  for (const raw of tier1.dates) {
    const normalized = normalizeScopeDate(raw);
    if (normalized !== null) scopeDates.add(normalized);
  }

  for (const rawSentence of output.split(/(?<=[.!?])\s+|\n+/)) {
    const trimmed = rawSentence.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) continue;
    const snippet =
      trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX - 1)}…` : trimmed;

    const add = (cls: FenceViolationClass, message: string, core: string): void => {
      const key = `${cls}::${core}::${snippet}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ class: cls, label: CLASS_LABELS[cls], snippet, message, core });
    };

    let work = rawSentence.toLowerCase();

    // 1. Dates (removed first so day/year digits never read as degrees).
    const dateClaims: string[] = [];
    for (const [re, kind] of DATE_PATTERNS) {
      const matches = [...work.matchAll(new RegExp(re.source, "g"))];
      for (const m of matches) {
        const iso = isoFromMatch(m, kind);
        if (iso !== null) dateClaims.push(iso);
      }
      work = blankMatches(work, matches);
    }
    for (const iso of dateClaims) {
      if (!scopeDates.has(iso)) {
        add(4, `date ${iso} is not among the Tier 1 dates in scope`, iso);
      }
    }

    // 2. Orb numbers (removed before degrees so they are judged as aspect claims).
    const orbClaims: OrbClaim[] = [];
    for (const source of [ORB_AFTER_SOURCE, ORB_BEFORE_SOURCE]) {
      const matches = [...work.matchAll(new RegExp(source, "g"))];
      for (const m of matches) {
        const raw = m[1];
        if (raw === undefined || m.index === undefined) continue;
        orbClaims.push({ value: Number(raw), raw: m[0], pos: m.index });
      }
      work = blankMatches(work, matches);
    }

    // 3. Degrees: DMS → decimal → "N degrees".
    const degreeClaims: DegreeClaim[] = [];
    for (const source of [DMS_SOURCE, DEC_SOURCE, WORD_SOURCE]) {
      const matches = [...work.matchAll(new RegExp(source, "g"))];
      for (const m of matches) {
        const deg = m[1];
        if (deg === undefined || m.index === undefined) continue;
        const minutes = m[2];
        const seconds = m[3];
        const value =
          Number(deg) +
          (minutes ? Number(minutes) / 60 : 0) +
          (seconds ? Number(seconds) / 3600 : 0);
        degreeClaims.push({ value, raw: m[0], pos: m.index });
      }
      work = blankMatches(work, matches);
    }

    // 4. Words and names, on the fully blanked sentence.
    const applyingClaims: WordClaim[] = [];
    {
      const matches = [...work.matchAll(new RegExp(APPLYING_SOURCE, "g"))];
      for (const m of matches) {
        const w = m[1];
        if (w !== undefined && m.index !== undefined)
          applyingClaims.push({ word: w, pos: m.index });
      }
    }
    const typeClaims: { type: AspectType; pos: number }[] = [];
    {
      const matches = [...work.matchAll(new RegExp(TYPE_SOURCE, "g"))];
      for (const m of matches) {
        const w = m[1];
        const type = w === undefined ? undefined : ASPECT_TYPE_WORDS[w];
        if (type !== undefined && m.index !== undefined) typeClaims.push({ type, pos: m.index });
      }
    }
    const anchors = collectAnchors(tier1, work);
    const signClaims: SignClaim[] = [];
    {
      const matches = [...work.matchAll(new RegExp(`\\b(${SIGNS.join("|")})\\b`, "g"))];
      for (const m of matches) {
        const sign = SIGN_LOOKUP.get(m[1] ?? "");
        if (sign !== undefined && m.index !== undefined)
          signClaims.push({ word: sign, pos: m.index });
      }
    }
    const houseClaims: HouseClaim[] = [];
    for (const source of [HOUSE_ORDINAL_SOURCE, HOUSE_POST_SOURCE]) {
      const matches = [...work.matchAll(new RegExp(source, "g"))];
      for (const m of matches) {
        const n = m[1];
        if (n === undefined || m.index === undefined) continue;
        houseClaims.push({ n: Number(n), raw: m[0], pos: m.index });
      }
    }

    // Anchor-level integrity: a body/angle named but not in scope is itself fabricated.
    for (const a of anchors) {
      if (a.lon !== undefined) continue;
      if (a.kind === "body") {
        add(1, `${a.body} is not part of this chart's Tier 1 scope`, a.body);
      } else {
        add(
          1,
          `${a.label} is not in scope (solar chart — birth time unknown)`,
          a.label.toLowerCase(),
        );
      }
    }

    const judgeDegree = (claim: DegreeClaim, target: number | undefined, what: string): void => {
      if (target === undefined) return; // anchor-level violation already recorded
      const delta = Math.abs(claim.value - target);
      if (delta <= FENCE_TOLERANCE_DEG + TOLERANCE_EPS) return;
      const cls: FenceViolationClass = delta <= OFF_BY_PROXIMITY_DEG ? 2 : 1;
      add(
        cls,
        `${what}: stated ${fmtDeg(claim.value)}° vs Tier 1 ${fmtDeg(target)}° (Δ ${fmtDeg(delta)}°, tolerance ${FENCE_TOLERANCE_DEG}°)`,
        claim.raw,
      );
    };

    for (const claim of degreeClaims) {
      const anchor = nearestAnchor(anchors, claim.pos);
      if (anchor === undefined) {
        const pool = [
          ...tier1.positions.map((p) => normalizeDeg(p.lon) % 30),
          ...(tier1.cusps ?? []).map((c) => normalizeDeg(c) % 30),
          ...(tier1.angles
            ? [normalizeDeg(tier1.angles.asc) % 30, normalizeDeg(tier1.angles.mc) % 30]
            : []),
        ];
        let nearest: number | undefined;
        let nearestDelta = Number.POSITIVE_INFINITY;
        for (const v of pool) {
          const d = Math.abs(claim.value - v);
          if (d < nearestDelta) {
            nearestDelta = d;
            nearest = v;
          }
        }
        if (nearest === undefined) {
          add(1, `no Tier 1 degrees in scope to verify ${fmtDeg(claim.value)}°`, claim.raw);
        } else {
          judgeDegree(claim, nearest, "unanchored degree");
        }
        continue;
      }
      judgeDegree(
        claim,
        anchor.lon === undefined ? undefined : normalizeDeg(anchor.lon) % 30,
        anchor.label,
      );
    }

    for (const claim of signClaims) {
      const anchor = nearestAnchor(anchors, claim.pos);
      if (anchor !== undefined) {
        if (anchor.lon === undefined) continue; // anchor-level violation already recorded
        const expected = signOfLon(anchor.lon);
        if (expected !== claim.word) {
          add(3, `${anchor.label}: stated ${claim.word}, Tier 1 says ${expected}`, claim.word);
        }
      } else if (!tier1.signsInScope.includes(claim.word)) {
        add(3, `${claim.word} is not among the signs in scope`, claim.word);
      }
    }

    for (const claim of houseClaims) {
      if (claim.n < 1 || claim.n > 12) {
        add(3, `${claim.raw}: houses run 1–12`, claim.raw);
        continue;
      }
      const anchor = nearestAnchor(anchors, claim.pos);
      if (anchor !== undefined) {
        if (anchor.lon === undefined) continue; // anchor-level violation already recorded
        const cusps = tier1.cusps;
        if (cusps === undefined) {
          add(
            1,
            `${anchor.label}: no houses in scope (solar chart — birth time unknown)`,
            claim.raw,
          );
          continue;
        }
        const got = houseOfLon(anchor.lon, cusps);
        if (got !== claim.n) {
          add(3, `${anchor.label}: stated house ${claim.n}, Tier 1 says house ${got}`, claim.raw);
        }
      } else if (!tier1.housesInScope.includes(claim.n)) {
        add(3, `${claim.raw}: house not in scope`, claim.raw);
      }
    }

    const pair = sentencePair(anchors);
    for (const claim of orbClaims) {
      const cands = aspectsForPair(tier1, pair);
      if (pair && cands.length === 0) {
        add(
          5,
          `no Tier 1 aspect between ${pair.a} and ${pair.b}, so the orb claim is fabricated`,
          claim.raw,
        );
        continue;
      }
      const matched = cands.some(
        (as) => Math.abs(as.orb - claim.value) <= FENCE_TOLERANCE_DEG + TOLERANCE_EPS,
      );
      if (!matched) {
        add(
          5,
          `orb ${fmtDeg(claim.value)}° does not match any Tier 1 orb${pair ? ` for ${pair.a}–${pair.b}` : ""}`,
          claim.raw,
        );
      }
    }

    for (const claim of typeClaims) {
      const cands = aspectsForPair(tier1, pair);
      if (!cands.some((as) => as.type === claim.type)) {
        add(
          5,
          pair
            ? `no Tier 1 ${claim.type} between ${pair.a} and ${pair.b}`
            : `no Tier 1 ${claim.type} aspect in scope`,
          claim.type,
        );
      }
    }

    for (const claim of applyingClaims) {
      const stated = claim.word === "applying";
      let cands = aspectsForPair(tier1, pair);
      if (pair && cands.length === 0) {
        add(5, `no Tier 1 aspect between ${pair.a} and ${pair.b}`, claim.word);
        continue;
      }
      const typeWord = typeClaims[0]?.type;
      if (typeWord !== undefined) cands = cands.filter((as) => as.type === typeWord);
      if (pair && cands.length === 0) {
        add(5, `no Tier 1 ${typeWord ?? "aspect"} between ${pair?.a} and ${pair?.b}`, claim.word);
        continue;
      }
      if (cands.length === 0) {
        add(5, "no Tier 1 aspect available to verify the applying/separating claim", claim.word);
        continue;
      }
      if (!cands.some((as) => as.applying === stated)) {
        add(
          5,
          `“${claim.word}” contradicts Tier 1 (${cands
            .map((as) => (as.applying ? "applying" : "separating"))
            .join(", ")})`,
          claim.word,
        );
      }
    }
  }

  // Contamination relabel (TR-2 class 6): an unresolved degree/date/sign claim
  // whose core token is present in Tier 2 lore has lore as its only source.
  let result = found;
  if (tier2 !== undefined && tier2.length > 0) {
    const frags = tier2.map((f) => f.text.toLowerCase().replace(/\s+/g, " "));
    result = result.map((v) => {
      if (v.class !== 1 && v.class !== 2 && v.class !== 3 && v.class !== 4) return v;
      const core = v.core.toLowerCase();
      if (core.length > 0 && frags.some((f) => f.includes(core))) {
        return {
          ...v,
          class: 6 as const,
          label: CLASS_LABELS[6],
          message: `${v.message} — the only source found is Tier 2 lore, which never licenses astrological claims`,
        };
      }
      return v;
    });
  }

  return result.map((v) => ({
    class: v.class,
    label: v.label,
    snippet: v.snippet,
    message: v.message,
  }));
}

// ---------------------------------------------------------------------------
// Chain law: violation → one regeneration → honest absence
// ---------------------------------------------------------------------------

function regenerationNote(v: FenceViolation): string {
  return `Fence violation (class ${v.class} ${v.label}): "${v.snippet}" — ${v.message}. Reply again using only the Tier 1 chart facts; if a fact is not there, say: "${FENCE_ABSENCE_LINE}"`;
}

export interface FenceEnforceInput {
  /** Produces a regenerated companion reply, given the quoted violation. May be sync or async. */
  generate: (regenerationNote: string) => string | Promise<string>;
  output: string;
  tier1: FenceScope;
  tier2?: readonly FenceFragment[];
  maxRegenerations?: number;
  absentFallback?: string;
}

export interface FenceResult {
  text: string;
  violations: FenceViolation[];
  regenerations: number;
  outcome: "clean" | "regenerated" | "absent";
}

/**
 * §7.2 chain law: a violating output triggers exactly one regeneration whose
 * prompt quotes the violation; a still-violating reply collapses to the
 * honest-absence fallback (default `FENCE_ABSENCE_LINE`), returned verbatim.
 */
export async function enforceFence(input: FenceEnforceInput): Promise<FenceResult> {
  const {
    generate,
    output,
    tier1,
    tier2,
    maxRegenerations = 1,
    absentFallback = FENCE_ABSENCE_LINE,
  } = input;

  const first = checkFence(output, tier1, tier2);
  if (first.length === 0) {
    return { text: output, violations: [], regenerations: 0, outcome: "clean" };
  }
  const firstViolation = first[0];
  if (firstViolation === undefined) {
    return { text: absentFallback, violations: first, regenerations: 0, outcome: "absent" };
  }

  const violations: FenceViolation[] = [...first];
  if (maxRegenerations > 0) {
    const retry = await generate(regenerationNote(firstViolation));
    const second = checkFence(retry, tier1, tier2);
    if (second.length === 0) {
      return { text: retry, violations, regenerations: 1, outcome: "regenerated" };
    }
    violations.push(...second);
  }
  return {
    text: absentFallback,
    violations,
    regenerations: maxRegenerations > 0 ? 1 : 0,
    outcome: "absent",
  };
}
