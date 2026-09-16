// natally — L.3 deterministic extraction & merge (ARCHITECTURE §8.2–8.3).
// Pure functions only: no I/O, no clock, no randomness, no console. TS strict, no `any`.
//
// Dependency ruling (ARCHITECT rescuing the layering rule): packages/lore must not
// import apps/*, so the G.1 glossary gazetteer is INJECTED via `ExtractOptions.gazetteer`.
// The G.1 content module supplies the real place list at the app layer; tests pass
// inline fixtures. Same for embeddings: L.5 embeds — this module accepts precomputed
// vectors (`ExtractOptions.embeddings`, `existing[].embedding`) and never fabricates any.
//
// v1 is deterministic by law (§8.3), not NLP quality. Documented heuristic limits:
//  - Sentence-initial capitalized words are never proper-noun candidates ("Marina
//    arrived." yields nothing); mid-sentence capitalization is the only signal.
//  - A "." sentence terminator swallows the following name ("Mr. Smith" — "Smith" is
//    treated as sentence-initial and skipped). Honorifics/abbreviations are v2 work.
//  - Person names are single word tokens; multi-word names are not joined.
//  - Standalone month names and EN_STOPWORDS are never person candidates.
//  - Date validation is range-based (month 01–12, day 01–31), not calendar-true.
//  - Word segmentation uses Intl.Segmenter (granularity "word") with a unicode regex
//    fallback when unavailable.
//
// Node ids are content-addressed and stable across turns: `lore:{kind}:{norm}` where
// `norm` is NFC, lowercased, whitespace-collapsed text. Merge keeps the
// LEXICOGRAPHICALLY SMALLER id ("earlier id"); the surviving node takes the existing
// node's summary and (non-empty) embedding — the established entity identity survives,
// the candidate contributes its ref and, if smaller, its id. Node salience has no
// weight field in LoreNode (§8.2) — "bump weight" lands on LoreEdge: the re-emitted
// `mentions` edge carries 1 + (absorbed merges this turn). All emitted edge weights
// are ABSOLUTE for this turn; the caller (L.5 writer) upserts rather than accumulates.
import type { LoreEdge, LoreKind, LoreNode, Turn } from "./types";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Merge threshold (§8.3): cosine ≥ 0.92 between same-kind candidates and existing nodes. */
export const MERGE_COSINE_THRESHOLD = 0.92;

/**
 * Tiny English stopword set for thread-label derivation (caller-side, §8.3 thread
 * labels = first-turn topic words). Lowercased keys.
 */
export const EN_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "when",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "once",
  "here",
  "there",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "can",
  "will",
  "just",
  "should",
  "now",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "they",
  "them",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
]);

/** English month names recognized by the natural-date extractor. */
export const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_KEYS: ReadonlySet<string> = new Set(MONTH_NAMES.map((m) => m.toLowerCase()));

// ---------------------------------------------------------------------------
// Public contracts
// ---------------------------------------------------------------------------

/** Options for `extractFromTurn`. Everything external is injected; nothing is global. */
export interface ExtractOptions {
  /**
   * Place-name gazetteer (G.1 glossary export), injected — packages/lore never imports
   * apps/*. Matching is case-insensitive; canonical summaries come from these entries.
   */
  gazetteer: ReadonlySet<string>;
  /** Persisted nodes to merge against. Never mutated. */
  existing?: readonly LoreNode[];
  /** First-turn topic words (kind "thread"); the caller derives them with `topicWords`. */
  threadSeedWords?: readonly string[];
  /**
   * Precomputed candidate embeddings keyed by candidate id (`lore:{kind}:{norm}`).
   * Absent (or empty) vectors never merge — cosine is undefined for them.
   */
  embeddings?: ReadonlyMap<string, readonly number[]>;
}

/** One merge resolution: `mergedIds` were folded into `keptId` this turn. */
export interface MergeRecord {
  keptId: string;
  mergedIds: string[];
}

/** Result of extracting one turn: fresh + re-emitted merged nodes, edges, merge records. */
export interface ExtractionResult {
  /** Fresh candidates and re-emitted merged nodes (unioned refs) — caller upserts. */
  nodes: LoreNode[];
  /** This turn's edges (mentions/follows/relates); weights are absolute for the turn. */
  edges: LoreEdge[];
  /** Merge resolutions applied against `existing` (and existing-descended nodes). */
  merges: MergeRecord[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Word {
  text: string;
  start: number;
}

interface Candidate {
  id: string;
  kind: LoreKind;
  summary: string;
  /** Character offset in the turn text; `Infinity` for thread labels (chain tail). */
  pos: number;
  /** Creation index — deterministic tie-breaker. */
  seq: number;
}

const SENTENCE_TERMINATORS: ReadonlySet<string> = new Set([
  ".",
  "!",
  "?",
  "\n",
  "\r",
  "\u2026",
  "\u3002",
  "\uFF01",
  "\uFF1F",
]);

/** Characters that preserve a pending sentence boundary (whitespace, quotes, brackets). */
const BOUNDARY_TRANSPARENT: ReadonlySet<string> = new Set([
  " ",
  "\t",
  "\u00A0",
  '"',
  "'",
  "\u201C",
  "\u201D",
  "\u2018",
  "\u2019",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\u00AB",
  "\u00BB",
  "\u300C",
  "\u300D",
  "*",
  "_",
]);

const EMPTY_VECTORS: readonly number[] = [];

/** NFC, lowercase, trim, collapse whitespace — the normalization behind node ids. */
function normalizeKey(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Unicode-aware word segmentation: Intl.Segmenter when present, regex fallback otherwise. */
function segmentWords(text: string): Word[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("und", { granularity: "word" });
    const words: Word[] = [];
    for (const data of segmenter.segment(text)) {
      if (data.isWordLike === true) words.push({ text: data.segment, start: data.index });
    }
    return words;
  }
  // Fallback: unicode letter/number runs, tolerating internal apostrophes/hyphens.
  const fallback = /[\p{L}\p{N}]+(?:['’\u2019-][\p{L}\p{N}]+)*/gu;
  const words: Word[] = [];
  for (const match of text.matchAll(fallback)) {
    const word = match[0];
    if (word !== undefined && match.index !== undefined) {
      words.push({ text: word, start: match.index });
    }
  }
  return words;
}

/**
 * Character offsets that begin a sentence: text start and the first non-transparent
 * character after a terminator. Deterministic; this is the sentence-initial heuristic.
 */
function sentenceStarts(text: string): ReadonlySet<number> {
  const starts = new Set<number>([0]);
  let pending = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (SENTENCE_TERMINATORS.has(ch)) {
      pending = true;
      continue;
    }
    if (BOUNDARY_TRANSPARENT.has(ch)) continue;
    if (pending) {
      starts.add(i);
      pending = false;
    }
  }
  return starts;
}

/** True when the word's first code point is cased and uppercase (unicode-aware). */
function startsUppercase(word: string): boolean {
  const first = Array.from(word)[0];
  if (first === undefined) return false;
  const upper = first.toUpperCase();
  const lower = first.toLowerCase();
  return upper !== lower && first === upper;
}

/** Cosine similarity; -1 (never merges) for empty, zero-norm, or dimension-mismatched vectors. */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / Math.sqrt(normA * normB);
}

interface Span {
  start: number;
  end: number;
}

function overlapsAny(span: Span, taken: readonly Span[]): boolean {
  return taken.some((s) => span.start < s.end && s.start < span.end);
}

const ISO_DATE = /(?<![\p{L}\p{N}])(\d{4})-(\d{2})-(\d{2})(?![\p{L}\p{N}])/gu;
const MONTH_ALT = MONTH_NAMES.join("|");
/** "May 2", "May 2, 1990" (comma optional), month matched case-insensitively. */
const MONTH_DAY = new RegExp(
  `(?<![\\p{L}\\p{N}])(${MONTH_ALT})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?(?![\\p{L}\\p{N}])`,
  "giu",
);
/** "2 May", "2 May 1990" (comma optional), month matched case-insensitively. */
const DAY_MONTH = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2})\\s+(${MONTH_ALT})(?:\\s*,?\\s*(\\d{4}))?(?![\\p{L}\\p{N}])`,
  "giu",
);

/** All date spans (ISO first, then natural month-day forms), non-overlapping, in text order. */
function dateSpans(text: string): Array<Span & { text: string }> {
  const spans: Array<Span & { text: string }> = [];
  const take = (span: Span & { text: string }): void => {
    if (!overlapsAny(span, spans)) spans.push(span);
  };
  for (const match of text.matchAll(ISO_DATE)) {
    const whole = match[0];
    const mm = Number(match[2] ?? "0");
    const dd = Number(match[3] ?? "0");
    if (whole === undefined || match.index === undefined) continue;
    // Range-based validity (documented limit): month 01–12, day 01–31.
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      take({ start: match.index, end: match.index + whole.length, text: whole });
    }
  }
  for (const pattern of [MONTH_DAY, DAY_MONTH]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const whole = match[0];
      const day = Number(match[2] ?? "0");
      if (whole === undefined || match.index === undefined) continue;
      if (day >= 1 && day <= 31) {
        take({ start: match.index, end: match.index + whole.length, text: whole });
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Gazetteer spans: case-insensitive whole-name matches, longest-first, non-overlapping. */
function placeSpans(
  text: string,
  gazetteer: ReadonlySet<string>,
): Array<Span & { canonical: string }> {
  const raw: Array<Span & { canonical: string; length: number }> = [];
  for (const entry of gazetteer) {
    const canonical = entry.trim();
    if (canonical.length === 0) continue;
    const pattern = escapeRegExp(canonical).replace(/\s+/gu, "\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(re)) {
      const whole = match[0];
      if (whole === undefined || match.index === undefined) continue;
      raw.push({
        start: match.index,
        end: match.index + whole.length,
        canonical,
        length: whole.length,
      });
    }
  }
  // Deterministic resolution: earlier start wins; at equal starts the longest match wins.
  raw.sort((a, b) => a.start - b.start || b.length - a.length);
  const spans: Array<Span & { canonical: string }> = [];
  for (const span of raw) {
    if (!overlapsAny(span, spans)) {
      spans.push({ start: span.start, end: span.end, canonical: span.canonical });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** In-range character check against a span list. */
function inSpans(index: number, end: number, spans: readonly Span[]): boolean {
  return spans.some((s) => index < s.end && s.start < end);
}

/** First-turn topic words: segmented words minus stopwords/months/numbers, order kept. */
export function topicWords(text: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of segmentWords(text)) {
    const key = normalizeKey(word.text);
    if (key.length < 3 || EN_STOPWORDS.has(key) || MONTH_KEYS.has(key)) continue;
    if (!/[\p{L}]/u.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(word.text);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction + merge (the L.3 entry point)
// ---------------------------------------------------------------------------

/**
 * Deterministically extract lore candidates from one turn and merge them against
 * `existing`. Pure: inputs are never mutated; identical inputs yield deep-equal output.
 *
 * Candidate order (and therefore node/edge order) is reading order: events, places and
 * persons by character position, thread labels appended in seed order.
 */
export function extractFromTurn(turn: Turn, options: ExtractOptions): ExtractionResult {
  const lowerGazetteer = new Set([...options.gazetteer].map((e) => normalizeKey(e)));
  const starts = sentenceStarts(turn.text);
  const dates = dateSpans(turn.text);
  const places = placeSpans(turn.text, options.gazetteer);

  const candidates: Candidate[] = [];
  let seq = 0;
  const push = (id: string, kind: LoreKind, summary: string, pos: number): void => {
    if (candidates.some((c) => c.id === id)) return;
    candidates.push({ id, kind, summary, pos, seq });
    seq += 1;
  };

  for (const span of dates)
    push(`lore:event:${normalizeKey(span.text)}`, "event", span.text, span.start);
  for (const span of places)
    push(`lore:place:${normalizeKey(span.canonical)}`, "place", span.canonical, span.start);

  for (const word of segmentWords(turn.text)) {
    if (inSpans(word.start, word.start + word.text.length, dates)) continue;
    if (inSpans(word.start, word.start + word.text.length, places)) continue;
    if (!startsUppercase(word.text)) continue;
    if (starts.has(word.start)) continue; // sentence-initial heuristic (documented)
    if (word.text.length < 2) continue;
    const key = normalizeKey(word.text);
    if (EN_STOPWORDS.has(key) || MONTH_KEYS.has(key)) continue;
    if (lowerGazetteer.has(key)) continue; // gazetteer hit ⇒ already a place
    push(`lore:person:${key}`, "person", word.text.normalize("NFC"), word.start);
  }

  for (const seed of options.threadSeedWords ?? []) {
    const trimmed = seed.trim();
    if (trimmed.length === 0) continue;
    push(`lore:thread:${normalizeKey(trimmed)}`, "thread", trimmed, Number.POSITIVE_INFINITY);
  }

  // Reading order: textual candidates by position, threads last in seed order.
  candidates.sort((a, b) => a.pos - b.pos || a.seq - b.seq);

  // --- Merge resolution (§8.3) ------------------------------------------------
  // Working set starts as a copy of `existing`; merged results replace their target in
  // place, so later candidates resolve against the already-merged node deterministically.
  const current: LoreNode[] = (options.existing ?? []).map((node) => ({
    ...node,
    refs: [...node.refs],
    embedding: [...node.embedding],
  }));
  const mergedIdsByKept = new Map<string, Set<string>>();
  const resolved: Array<{ candidate: Candidate; id: string; merged: LoreNode | null }> = [];

  for (const candidate of candidates) {
    const candidateEmbedding = options.embeddings?.get(candidate.id) ?? EMPTY_VECTORS;
    let best: LoreNode | null = null;
    let bestSim = -1;
    for (const node of current) {
      if (node.kind !== candidate.kind) continue;
      const sim = cosine(candidateEmbedding, node.embedding);
      const better =
        sim >= MERGE_COSINE_THRESHOLD &&
        (best === null || sim > bestSim || (sim === bestSim && node.id < best.id));
      if (better) {
        best = node;
        bestSim = sim;
      }
    }
    if (best === null) {
      resolved.push({ candidate, id: candidate.id, merged: null });
      continue;
    }
    // Keep the earlier (lexicographically smaller) id; existing identity survives.
    const keptId = candidate.id < best.id ? candidate.id : best.id;
    const discardedId = keptId === best.id ? candidate.id : best.id;
    const merged: LoreNode = {
      id: keptId,
      kind: candidate.kind,
      summary: best.summary,
      embedding: best.embedding.length > 0 ? [...best.embedding] : [...candidateEmbedding],
      refs: sortedUnique([...best.refs, turn.id]),
    };
    const index = current.indexOf(best);
    if (index >= 0) current[index] = merged;
    const absorbed = mergedIdsByKept.get(keptId) ?? new Set<string>();
    absorbed.add(discardedId);
    mergedIdsByKept.set(keptId, absorbed);
    resolved.push({ candidate, id: keptId, merged });
  }

  // --- Assemble output ---------------------------------------------------------
  const nodes: LoreNode[] = [];
  const mentionedIds: string[] = [];
  const emitted = new Set<string>();
  for (const r of resolved) {
    if (emitted.has(r.id)) continue;
    emitted.add(r.id);
    mentionedIds.push(r.id);
    if (r.merged !== null) {
      nodes.push(r.merged); // re-emitted merged node — caller upserts (unioned refs)
    } else {
      nodes.push({
        id: r.candidate.id,
        kind: r.candidate.kind,
        summary: r.candidate.summary,
        embedding: [...(options.embeddings?.get(r.candidate.id) ?? EMPTY_VECTORS)],
        refs: [turn.id],
      });
    }
  }

  const edges: LoreEdge[] = [];
  for (const id of mentionedIds) {
    edges.push({
      from: turn.id,
      to: id,
      rel: "mentions",
      // 1 + absorbed merges: the "bump weight" of §8.3 (LoreNode has no weight field).
      weight: 1 + (mergedIdsByKept.get(id)?.size ?? 0),
      sourceTurnId: turn.id,
    });
  }
  for (let i = 0; i + 1 < mentionedIds.length; i += 1) {
    const from = mentionedIds[i];
    const to = mentionedIds[i + 1];
    if (from === undefined || to === undefined || from === to) continue;
    edges.push({ from, to, rel: "follows", weight: 1, sourceTurnId: turn.id });
  }
  for (let i = 0; i < mentionedIds.length; i += 1) {
    for (let j = i + 1; j < mentionedIds.length; j += 1) {
      const from = mentionedIds[i];
      const to = mentionedIds[j];
      if (from === undefined || to === undefined) continue;
      edges.push({ from, to, rel: "relates", weight: 1, sourceTurnId: turn.id });
    }
  }

  const merges: MergeRecord[] = [...mergedIdsByKept.entries()]
    .map(([keptId, ids]) => ({ keptId, mergedIds: sortedUnique([...ids]) }))
    .sort((a, b) => (a.keptId < b.keptId ? -1 : a.keptId > b.keptId ? 1 : 0));

  return { nodes, edges, merges };
}
