import { ChartInputsSchema, type ExportDocument, ExportDocumentSchema } from "@natally/lore";
import { type DataDatabase, getDatabase, parseStoredJson } from "./db";
import { decodePerson } from "./people";
import { decodeSession, sessionSelect } from "./sessions";
import { decodeTurn } from "./turns";

/** J8 must display this disclosure before saving the file. */
export const EXPORT_PLAINTEXT_NOTICE = "This export is plaintext JSON. It is not encrypted.";

export async function exportAll(db: DataDatabase = getDatabase()): Promise<ExportDocument> {
  const { rows, graph } = await db.snapshot([
    { sql: "SELECT * FROM people ORDER BY id" },
    { sql: `${sessionSelect} ORDER BY s.id` },
    { sql: "SELECT * FROM turns ORDER BY id" },
    // Deliberately never read facts_json, cached positions, license tokens or readings.
    { sql: "SELECT inputs_json FROM charts ORDER BY id" },
    { sql: "SELECT code_hash, redeemed_at FROM consumed_codes ORDER BY code_hash" },
  ]);
  return ExportDocumentSchema.parse({
    exportVersion: 1,
    people: rows[0].map(decodePerson),
    sessions: rows[1].map(decodeSession),
    turns: rows[2].map(decodeTurn),
    charts: rows[3].map((row) =>
      ChartInputsSchema.parse(parseStoredJson(row.inputs_json, "inputs_json")),
    ),
    loreNodes: graph.nodes,
    loreEdges: graph.edges,
    consumedCodes: rows[4].map((row) => ({ codeHash: row.code_hash, redeemedAt: row.redeemed_at })),
  });
}

export async function exportJson(db: DataDatabase = getDatabase()): Promise<string> {
  return `${JSON.stringify(await exportAll(db), null, 2)}\n`;
}
