import { z } from "zod";

export type { LoreStore } from "./store.js";

// The contract does not require UUIDs. References use the same opaque string IDs.
const IdSchema = z.string().min(1);
// Conversation/export timestamps are Unix epoch milliseconds; birth dates and
// local birth times remain strings because a missing time must stay missing.
const TimestampSchema = z.number().finite();

export const PersonSchema = z.strictObject({
  id: IdSchema,
  name: z.string(),
  birth: z.strictObject({
    date: z.string(),
    time: z.string().optional(),
    place: z.string(),
    timeKnown: z.boolean(),
  }),
});
export type Person = z.infer<typeof PersonSchema>;

export const SessionSchema = z.strictObject({
  id: IdSchema,
  personId: IdSchema,
  startedAt: TimestampSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const DomWriteOpSchema = z.strictObject({
  selector: z.string(),
  op: z.enum(["setattr", "text", "class", "focus", "scroll"]),
  // Values are serialized strings, including an empty value for focus/scroll.
  value: z.string(),
});
export type DomWriteOp = z.infer<typeof DomWriteOpSchema>;

export const TurnSchema = z.strictObject({
  id: IdSchema,
  sessionId: IdSchema,
  personId: IdSchema.optional(),
  role: z.enum(["you", "her", "tool"]),
  text: z.string(),
  ts: TimestampSchema,
  toolOps: z.array(DomWriteOpSchema).optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const LoreNodeSchema = z.strictObject({
  id: IdSchema,
  kind: z.enum(["person", "fact", "event", "thread", "place"]),
  summary: z.string(),
  // Dimension belongs to runtime model configuration, not this shared contract.
  embedding: z.array(z.number().finite()),
  refs: z.array(IdSchema),
});
export type LoreNode = z.infer<typeof LoreNodeSchema>;

export const LoreEdgeSchema = z.strictObject({
  from: IdSchema,
  to: IdSchema,
  rel: z.enum(["mentions", "relates", "follows", "contradicts"]),
  // Merges accumulate weight, so it is not restricted to the interval [0, 1].
  weight: z.number().finite(),
  sourceTurnId: IdSchema,
});
export type LoreEdge = z.infer<typeof LoreEdgeSchema>;

export const CompanionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("token"), token: z.string() }),
  z.strictObject({ type: z.literal("turn"), turn: TurnSchema }),
  z.strictObject({ type: z.literal("chart-computed"), chartId: IdSchema }),
  z.strictObject({ type: z.literal("envelope-start") }),
  z.strictObject({
    type: z.literal("envelope-level"),
    level: z.number().finite().min(0).max(1),
  }),
  z.strictObject({ type: z.literal("envelope-end") }),
  z.strictObject({ type: z.literal("error"), message: z.string() }),
]);
export type CompanionEvent = z.infer<typeof CompanionEventSchema>;

// Only computation inputs cross the export boundary. The ordered UT Julian days,
// coordinate pair, and closed house-system set mirror ChartFacts.inputs without
// importing ephemeris. Person IDs remain export metadata; birth.place is a label.
// Strict objects reject cached positions/cusps/aspects instead of dropping them.
export const ChartInputsSchema = z.strictObject({
  id: IdSchema,
  personIds: z.array(IdSchema),
  ut: z.array(z.number().finite()).min(1),
  place: z.strictObject({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  }),
  system: z.enum(["P", "K", "O", "R", "C", "A", "V", "W", "T", "X", "B", "U"]),
});
export type ChartInputs = z.infer<typeof ChartInputsSchema>;

export const ConsumedCodeSchema = z.strictObject({
  codeHash: z.string().min(1),
  redeemedAt: TimestampSchema,
});
export type ConsumedCode = z.infer<typeof ConsumedCodeSchema>;

export const ExportDocumentSchema = z.strictObject({
  exportVersion: z.literal(1),
  people: z.array(PersonSchema),
  sessions: z.array(SessionSchema),
  turns: z.array(TurnSchema),
  charts: z.array(ChartInputsSchema),
  loreNodes: z.array(LoreNodeSchema),
  loreEdges: z.array(LoreEdgeSchema),
  consumedCodes: z.array(ConsumedCodeSchema),
});
export type ExportDocument = z.infer<typeof ExportDocumentSchema>;
