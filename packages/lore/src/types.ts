// natally — lore & conversation contracts (ARCHITECTURE §5 entities, §8 Lore subsystem).
// Pure types + zod schemas. Zero imports outside this package except zod.
// INC-19: every field here maps to a provenance class in §5; nothing in this file
// hard-codes interpretation content — these are shapes only.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums (§5, §8.2)
// ---------------------------------------------------------------------------

/** LoreNode kind (§8.2). */
export const LoreKindSchema = z.enum(["person", "fact", "event", "thread", "place"]);
export type LoreKind = z.infer<typeof LoreKindSchema>;

/** LoreEdge relation (§8.2). */
export const LoreEdgeRelSchema = z.enum(["mentions", "relates", "follows", "contradicts"]);
export type LoreEdgeRel = z.infer<typeof LoreEdgeRelSchema>;

/** Conversation turn role (§5): the user, the companion, or a recorded tool invocation (§7.3). */
export const TurnRoleSchema = z.enum(["you", "her", "tool"]);
export type TurnRole = z.infer<typeof TurnRoleSchema>;

/** Epoch milliseconds UTC. All timestamps in these contracts use this shape. */
export const EpochMsSchema = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Conversation (§5 Turn, §7.3 DomWriteOp)
// ---------------------------------------------------------------------------

/** One DOM write op recorded by a tool turn — §7.3: no hidden writes, every op lands in the transcript. */
export const DomWriteOpSchema = z.object({
  /** Selector into the app's own WebView DOM (native legs) or page DOM (PWA). */
  selector: z.string().min(1),
  op: z.enum(["setattr", "text", "class", "focus", "scroll"]),
  /** Operation payload; may be empty for `focus` / `scroll`. */
  value: z.string(),
});
export type DomWriteOp = z.infer<typeof DomWriteOpSchema>;

/** One conversation turn (§5). Tool turns record their DOM ops (§7.3). */
export const TurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  /** Person scope; optional — a turn may predate or lack person binding. */
  personId: z.string().min(1).optional(),
  role: TurnRoleSchema,
  text: z.string(),
  ts: EpochMsSchema,
  /** Present exactly when role is "tool" (§7.3 dom.write ops). */
  toolOps: z.array(DomWriteOpSchema).optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

// ---------------------------------------------------------------------------
// Companion event bus (§4): companion:event → stage(mascot) + transcript + voice.
// Discriminated union; the Stage binds its states to real events only (STATES.md law).
// ---------------------------------------------------------------------------

/** A streamed inference token (first token flips the Stage to Thinking, §7.1/§10). */
export const TokenEventSchema = z.object({
  type: z.literal("token"),
  turnId: z.string().min(1),
  text: z.string(),
});
export type TokenEvent = z.infer<typeof TokenEventSchema>;

/** A completed turn as persisted in the transcript (§5 Turn). */
export const TurnEventSchema = z.object({
  type: z.literal("turn"),
  turn: TurnSchema,
});
export type TurnEvent = z.infer<typeof TurnEventSchema>;

/** ChartFacts are ready from the EphemerisEngine (§6) — flips the Stage to Delighted (§10). */
export const ChartComputedEventSchema = z.object({
  type: z.literal("chart-computed"),
  /** Content-addressed ChartFacts id (§5); consumers resolve the facts themselves. */
  chartId: z.string().min(1),
});
export type ChartComputedEvent = z.infer<typeof ChartComputedEventSchema>;

/** Playback RMS envelope, 0–1, driving the Stage's speaking orb+mouth (§10). */
export const EnvelopeEventSchema = z.object({
  type: z.literal("envelope"),
  rms: z.number().min(0).max(1),
});
export type EnvelopeEvent = z.infer<typeof EnvelopeEventSchema>;

/** Engine/pipeline failure — flips the Stage to Error (§10). */
export const CompanionErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string().min(1),
});
export type CompanionErrorEvent = z.infer<typeof CompanionErrorEventSchema>;

export const CompanionEventSchema = z.discriminatedUnion("type", [
  TokenEventSchema,
  TurnEventSchema,
  ChartComputedEventSchema,
  EnvelopeEventSchema,
  CompanionErrorEventSchema,
]);
export type CompanionEvent = z.infer<typeof CompanionEventSchema>;

// ---------------------------------------------------------------------------
// Lore graph (§8.2)
// ---------------------------------------------------------------------------

/**
 * A lore graph node (§8.2). Provenance: generated/derived (§5) — never shown as a
 * computed fact. `refs` carries the source turn ids evidencing the node (§8.3
 * fragments carry `sourceTurnId` back into the transcript).
 */
export const LoreNodeSchema = z.object({
  id: z.string().min(1),
  kind: LoreKindSchema,
  summary: z.string(),
  /** Embedding vector; dimension fixed by `VITE_LORE_EMBED_DIM` at runtime (§8.1, default 384). */
  embedding: z.array(z.number()),
  refs: z.array(z.string()),
});
export type LoreNode = z.infer<typeof LoreNodeSchema>;

/** A lore graph edge (§8.2); `weight` accumulates on merge (§8.3). */
export const LoreEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  rel: LoreEdgeRelSchema,
  weight: z.number(),
  sourceTurnId: z.string().min(1),
});
export type LoreEdge = z.infer<typeof LoreEdgeSchema>;

// ---------------------------------------------------------------------------
// Export document sub-entities (§5 entity table + §5 export law)
// ---------------------------------------------------------------------------

/** Person (§5). Birth data is quasi-PII (§12); `timeKnown: false` ⇒ honest-absence branches (§6). */
export const PersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  birth: z.object({
    /** Civil date, ISO-8601 `YYYY-MM-DD`. */
    date: z.string().min(1),
    /** Local birth time, ISO-8601 `HH:MM` — absent when unknown. */
    time: z.string().optional(),
    place: z.string().min(1),
    timeKnown: z.boolean(),
  }),
});
export type Person = z.infer<typeof PersonSchema>;

/** Session (§5): one conversation thread. */
export const SessionSchema = z.object({
  id: z.string().min(1),
  personId: z.string().min(1),
  startedAt: EpochMsSchema,
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Geographic place as a chart *input* (§6 EphemerisEngine `GeoPlace`).
 * Contract-level shape: latitude/longitude in degrees, optional human label.
 */
export const GeoPlaceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().min(1).optional(),
});
export type GeoPlace = z.infer<typeof GeoPlaceSchema>;

/**
 * Chart *inputs only* (§5 export law): the content-addressed input tuple that
 * reproduces ChartFacts. Computed positions/cusps/aspects are NEVER exported.
 */
export const ChartInputsSchema = z.object({
  id: z.string().min(1),
  personIds: z.array(z.string().min(1)).min(1),
  /** Universal Time instant, ISO-8601 UTC. */
  ut: z.string().min(1),
  place: GeoPlaceSchema,
});
export type ChartInputs = z.infer<typeof ChartInputsSchema>;

/** ConsumedCode (§5/§9.5): single-use enforcement — hash only, never the code. */
export const ConsumedCodeSchema = z.object({
  codeHash: z.string().min(1),
  redeemedAt: EpochMsSchema,
});
export type ConsumedCode = z.infer<typeof ConsumedCodeSchema>;

// ---------------------------------------------------------------------------
// Export document (§5: one JSON document, versioned by exportVersion, J8)
// ---------------------------------------------------------------------------

/** Full user-owned export (§5): people, sessions, turns, chart inputs, lore, consumed codes. */
export const ExportDocumentSchema = z.object({
  exportVersion: z.literal(1),
  people: z.array(PersonSchema),
  sessions: z.array(SessionSchema),
  turns: z.array(TurnSchema),
  /** Chart INPUTS only — computed facts are never serialized (§5). */
  charts: z.array(ChartInputsSchema),
  loreNodes: z.array(LoreNodeSchema),
  loreEdges: z.array(LoreEdgeSchema),
  consumedCodes: z.array(ConsumedCodeSchema),
});
export type ExportDocument = z.infer<typeof ExportDocumentSchema>;
