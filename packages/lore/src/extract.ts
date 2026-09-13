import type { LoreEdge, LoreNode, Turn } from "./types.js";

/** G.1 data is supplied by the application; lore never imports application data. */
export interface GazetteerEntry {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lon: number;
  readonly tzid: string;
}

export interface LoreGraph {
  nodes: LoreNode[];
  edges: LoreEdge[];
}

export interface ExtractOptions {
  gazetteer: readonly GazetteerEntry[];
  /** Supply the session's actual first turn when extracting subsequent turns. */
  firstTurn?: Turn;
  /** The caller supplies the immediately preceding turn in this session. */
  previousTurn?: Turn;
  /** Already retrieved lore.recall nodes; only textually supported hits are used. */
  recallHints?: readonly LoreNode[];
  /** Explicit local civil date, YYYY-MM-DD. A Unix timestamp alone has no timezone. */
  referenceDate?: string;
  /** Optional pure embedding function; an empty embedding means not yet embedded. */
  embed?: (summary: string, kind: LoreNode["kind"]) => readonly number[];
}

interface Token {
  text: string;
  key: string;
  start: number;
  end: number;
}

interface Span {
  start: number;
  end: number;
}

const STOP_WORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have " +
    "he her here hers him his how i if in into is it its me mine my of on or our ours " +
    "please she so some than that the their theirs them then there these they this " +
    "those to us was we were what when where which who why will with would you your " +
    "yours hello hi hey thanks thank tell about want like let's"
  ).split(" "),
);
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_PATTERN =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|" +
  "jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const LEFT_BOUNDARY = "(?<![\\p{L}\\p{M}\\p{N}_])";
const RIGHT_BOUNDARY = "(?![\\p{L}\\p{M}\\p{N}_])";

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokens(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu), (match) => ({
    text: match[0],
    key: normalize(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function id(kind: LoreNode["kind"], scope: string, key: string): string {
  // Length-prefixed components are collision-free, including arbitrary opaque IDs.
  return `lore:${kind}:${scope.length}:${scope}:${key.length}:${key}`;
}

function overlaps(span: Span, occupied: readonly Span[]): boolean {
  return occupied.some((other) => span.start < other.end && other.start < span.end);
}

function phrases(text: string, words: readonly Token[], phrase: string): Span[] {
  const keys = tokens(phrase).map((word) => word.key);
  if (keys.length === 0) return [];
  const found: Span[] = [];
  for (let i = 0; i <= words.length - keys.length; i += 1) {
    const first = words[i];
    const last = words[i + keys.length - 1];
    if (!first || !last) continue;
    if (!keys.every((key, j) => words[i + j]?.key === key)) continue;
    // Token equality alone must not join words across sentence punctuation.
    if (normalize(text.slice(first.start, last.end)) !== normalize(phrase)) continue;
    found.push({ start: first.start, end: last.end });
  }
  return found;
}

function civilDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return date;
}

function parseCivilDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? civilDate(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
}

function dateReference(text: string, reference: Date | undefined): string | undefined {
  const lower = normalize(text);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(lower)) {
    return parseCivilDate(lower) ? lower : undefined;
  }
  const natural = new RegExp(
    `^(?:(${MONTH_PATTERN})\\.? (\\d{1,2})(?:st|nd|rd|th)?|` +
      `(\\d{1,2})(?:st|nd|rd|th)? (${MONTH_PATTERN})\\.?)(?:,? (\\d{4}))?$`,
    "u",
  ).exec(lower);
  if (natural) {
    const month =
      MONTHS.findIndex((name) => name.startsWith((natural[1] ?? natural[4] ?? "").slice(0, 3))) + 1;
    const day = Number(natural[2] ?? natural[3]);
    const year = natural[5];
    // 2000 only validates a yearless month/day, including February 29; it is not inferred.
    if (!civilDate(year === undefined ? 2000 : Number(year), month, day)) return undefined;
    return `${year === undefined ? "-" : year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  let offset: number | undefined;
  if (lower === "today") offset = 0;
  if (lower === "yesterday") offset = -1;
  if (lower === "tomorrow") offset = 1;
  const weekday = /^(next|last) (\p{L}+)$/u.exec(lower);
  if (reference && weekday) {
    const day = WEEKDAYS.indexOf(weekday[2] ?? "");
    if (day >= 0) {
      const difference = day - reference.getUTCDay();
      offset = weekday[1] === "next" ? (difference + 7) % 7 || 7 : -((-difference + 7) % 7 || 7);
    }
  }
  if (reference && offset !== undefined) {
    const date = new Date(reference.getTime());
    date.setUTCDate(date.getUTCDate() + offset);
    if (date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999) {
      return date.toISOString().slice(0, 10);
    }
  }
  // Keep an explicit normalized reference rather than fabricate a calendar date.
  return `relative:${lower.replace(/\s+/gu, "-")}`;
}

function topic(firstTurn: Turn): string {
  const seen = new Set<string>();
  for (const word of tokens(firstTurn.text)) {
    if (word.key.length < 3 || STOP_WORDS.has(word.key) || !/\p{L}/u.test(word.key)) continue;
    seen.add(word.key);
    if (seen.size === 5) break;
  }
  return Array.from(seen).join(" ");
}

/**
 * Deterministic extraction v1. Date-event summaries are YYYY-MM-DD, --MM-DD
 * (unknown year), or relative:<normalized-phrase> (unresolved local reference).
 */
export function extractTurn(turn: Turn, options: ExtractOptions): LoreGraph {
  const { firstTurn, previousTurn } = options;
  for (const context of [firstTurn, previousTurn]) {
    if (context && (context.sessionId !== turn.sessionId || context.ts > turn.ts)) {
      throw new RangeError(
        "Extraction context must belong to the same session and not follow the turn",
      );
    }
  }
  if (previousTurn?.id === turn.id) throw new RangeError("A turn cannot follow itself");
  const reference =
    options.referenceDate === undefined ? undefined : parseCivilDate(options.referenceDate);
  if (options.referenceDate !== undefined && !reference)
    throw new RangeError("referenceDate must be a valid YYYY-MM-DD civil date");
  const text = turn.text.normalize("NFC");
  const words = tokens(text);
  const occupied: Span[] = [];
  const nodes = new Map<string, LoreNode>();
  function add(
    kind: LoreNode["kind"],
    summary: string,
    key = normalize(summary),
    refs = [turn.id],
    scope = turn.id,
    hint?: LoreNode,
  ): void {
    const nodeId = id(kind, scope, key);
    const existing = nodes.get(nodeId);
    if (existing) {
      existing.refs = Array.from(new Set([...existing.refs, ...refs]));
      return;
    }
    const embedding = Array.from(options.embed?.(summary, kind) ?? hint?.embedding ?? []);
    if (!embedding.every(Number.isFinite)) throw new RangeError("Embedding values must be finite");
    nodes.set(nodeId, { id: nodeId, kind, summary, embedding, refs: Array.from(new Set(refs)) });
  }

  // Longer names win overlapping matches, with ID as a stable gazetteer tie-break.
  const places = [...options.gazetteer].sort(
    (a, b) => tokens(b.name).length - tokens(a.name).length || compare(a.id, b.id),
  );
  for (const place of places) {
    for (const span of phrases(text, words, place.name)) {
      if (overlaps(span, occupied)) continue;
      occupied.push(span);
      add("place", place.name, place.id);
    }
  }

  const datePatterns = [
    "\\d{4}-\\d{2}-\\d{2}",
    `${MONTH_PATTERN}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
    `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?(?:,?\\s+\\d{4})?`,
    `(?:today|yesterday|tomorrow|(?:next|last)\\s+(?:${WEEKDAYS.join("|")}|week|month|year))`,
  ];
  for (const pattern of datePatterns) {
    for (const match of text.matchAll(
      new RegExp(`${LEFT_BOUNDARY}(?:${pattern})${RIGHT_BOUNDARY}`, "giu"),
    )) {
      const span = { start: match.index, end: match.index + match[0].length };
      if (overlaps(span, occupied)) continue;
      occupied.push(span);
      const normalized = dateReference(match[0], reference);
      if (normalized !== undefined) add("event", normalized);
    }
  }

  for (const hint of [...(options.recallHints ?? [])].sort((a, b) => compare(a.id, b.id))) {
    for (const span of phrases(text, words, hint.summary)) {
      const supported = Array.from(nodes.values()).find(
        (node) => node.kind === hint.kind && normalize(node.summary) === normalize(hint.summary),
      );
      if (supported) {
        supported.refs = Array.from(new Set([...supported.refs, ...hint.refs]));
        if (supported.embedding.length === 0 && !options.embed) {
          const embedding = Array.from(hint.embedding);
          if (!embedding.every(Number.isFinite))
            throw new RangeError("Embedding values must be finite");
          supported.embedding = embedding;
        }
        occupied.push(span);
        continue;
      }
      if (overlaps(span, occupied)) continue;
      occupied.push(span);
      add(hint.kind, hint.summary, normalize(hint.summary), [...hint.refs, turn.id], turn.id, hint);
    }
  }

  let name: Token[] = [];
  function flushName(): void {
    const first = name[0];
    const last = name[name.length - 1];
    if (first && last) add("person", text.slice(first.start, last.end));
    name = [];
  }
  for (const word of words) {
    const isName =
      /^[\p{Lu}\p{Lt}]/u.test(word.text) &&
      !STOP_WORDS.has(word.key) &&
      !MONTHS.includes(word.key) &&
      !WEEKDAYS.includes(word.key) &&
      !overlaps(word, occupied);
    if (!isName) {
      flushName();
      continue;
    }
    const previous = name[name.length - 1];
    if (previous && !/^\s+$/u.test(text.slice(previous.end, word.start))) flushName();
    name.push(word);
  }
  flushName();

  const sessionStart = firstTurn ?? (previousTurn ? undefined : turn);
  if (sessionStart) {
    const label = topic(sessionStart);
    if (label) add("thread", label, label, [sessionStart.id, turn.id], turn.sessionId);
  }
  const graph: LoreGraph = { nodes: Array.from(nodes.values()), edges: [] };
  for (const node of graph.nodes) {
    graph.edges.push({
      from: turn.id,
      to: node.id,
      rel: "mentions",
      weight: 1,
      sourceTurnId: turn.id,
    });
  }
  if (previousTurn) {
    graph.edges.push({
      from: previousTurn.id,
      to: turn.id,
      rel: "follows",
      weight: 1,
      sourceTurnId: turn.id,
    });
  }
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const left = graph.nodes[i];
    if (!left) continue;
    for (const right of graph.nodes.slice(i + 1)) {
      if (left.refs.some((ref) => right.refs.includes(ref))) {
        graph.edges.push({
          from: left.id,
          to: right.id,
          rel: "relates",
          weight: 1,
          sourceTurnId: turn.id,
        });
      }
    }
  }
  return graph;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Missing, zero, mismatched, or non-finite vectors cannot establish similarity. */
export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number | undefined {
  if (left.length === 0 || left.length !== right.length) return undefined;
  let leftScale = 0;
  let rightScale = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b))
      return undefined;
    leftScale = Math.max(leftScale, Math.abs(a));
    rightScale = Math.max(rightScale, Math.abs(b));
  }
  if (leftScale === 0 || rightScale === 0) return undefined;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = (left[i] ?? 0) / leftScale;
    const b = (right[i] ?? 0) / rightScale;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))));
}

/**
 * Supply nodes oldest-first (existing before incoming): LoreNode has no timestamp.
 * The first same-kind node at cosine >= 0.92 keeps its ID, summary and embedding.
 * Refs are unioned. Only edge weights exist in the shared schema; identical edges
 * accumulate weight per sourceTurnId, never erasing a different turn's provenance.
 */
export function mergeLore(existing: Readonly<LoreGraph>, incoming: Readonly<LoreGraph>): LoreGraph {
  const nodes: LoreNode[] = [];
  const aliases = new Map<string, string>();
  for (const candidate of [...existing.nodes, ...incoming.nodes]) {
    const knownId = aliases.get(candidate.id);
    const sameId = nodes.find((node) => node.id === (knownId ?? candidate.id));
    if (sameId && sameId.kind !== candidate.kind) throw new Error("A lore ID cannot change kind");
    const earlier =
      sameId ??
      nodes.find(
        (node) =>
          node.kind === candidate.kind &&
          (cosineSimilarity(node.embedding, candidate.embedding) ?? -1) >= 0.92,
      );
    if (earlier) {
      earlier.refs = Array.from(new Set([...earlier.refs, ...candidate.refs]));
      aliases.set(candidate.id, earlier.id);
    } else {
      nodes.push({ ...candidate, refs: [...candidate.refs], embedding: [...candidate.embedding] });
      aliases.set(candidate.id, candidate.id);
    }
  }
  const edges = new Map<string, LoreEdge>();
  for (const edge of [...existing.edges, ...incoming.edges]) {
    const rewritten: LoreEdge = {
      ...edge,
      from:
        edge.rel === "mentions" || edge.rel === "follows"
          ? edge.from
          : (aliases.get(edge.from) ?? edge.from),
      to: edge.rel === "follows" ? edge.to : (aliases.get(edge.to) ?? edge.to),
    };
    // Keep even collapsed self-edges: dropping one would erase its source evidence.
    const key = JSON.stringify([
      rewritten.from,
      rewritten.to,
      rewritten.rel,
      rewritten.sourceTurnId,
    ]);
    const prior = edges.get(key);
    if (prior) {
      const weight = prior.weight + rewritten.weight;
      if (!Number.isFinite(weight)) throw new RangeError("Merged edge weight must be finite");
      prior.weight = weight;
    } else {
      edges.set(key, rewritten);
    }
  }
  return { nodes, edges: Array.from(edges.values()) };
}
