import { type ExportDocument, ExportDocumentSchema, type Person } from "@natally/lore";
import { encodeEmbedding } from "@natally/lore/store/common";
import { type DataDatabase, getDatabase, type SqlStatement, type SqlValue } from "./db";
import { decodePerson, personInsert } from "./people";
import { sessionHistory, sessionInsert } from "./sessions";
import { turnInsert } from "./turns";

export interface ImportConflict {
  personId: string;
  existingBirth: Person["birth"];
  incomingBirth: Person["birth"];
}

export interface ImportReport {
  /** Counts document records inserted; unchanged/existing/conflicting records are skipped. */
  merged: number;
  skipped: number;
  conflicts: ImportConflict[];
}

function unique(items: unknown[], key: (item: unknown) => string, label: string): void {
  const keys = items.map(key);
  if (new Set(keys).size !== keys.length) throw new Error(`Duplicate ${label} in export document`);
}

function validateDocument(input: unknown): ExportDocument {
  const doc = ExportDocumentSchema.parse(input);
  for (const [label, rows] of Object.entries({
    people: doc.people,
    sessions: doc.sessions,
    turns: doc.turns,
    charts: doc.charts,
    loreNodes: doc.loreNodes,
  })) {
    unique(rows, (row) => (row as { id: string }).id, label);
  }
  unique(doc.consumedCodes, (row) => (row as { codeHash: string }).codeHash, "consumedCodes");
  unique(
    doc.loreEdges,
    (row) => {
      const edge = row as ExportDocument["loreEdges"][number];
      return JSON.stringify([edge.from, edge.to, edge.rel, edge.sourceTurnId]);
    },
    "loreEdges",
  );
  return doc;
}

function birthDifference(person: Person): { sql: string; parameters: SqlValue[] } {
  return {
    sql: `SELECT * FROM people WHERE id=? AND (birth_date IS NOT ? OR birth_time IS NOT ?
      OR time_known IS NOT ? OR place IS NOT ?)`,
    parameters: [
      person.id,
      person.birth.date,
      person.birth.time ?? null,
      Number(person.birth.timeKnown),
      person.birth.place,
    ],
  };
}

/** Merge is a union by stable identity. Existing rows win, making re-import
 * idempotent, including edge weights and consumed coupon hashes. No DELETEs. */
export async function importDocument(
  input: unknown,
  db: DataDatabase = getDatabase(),
): Promise<ImportReport> {
  const doc = validateDocument(input);
  const statements: SqlStatement[] = [];
  const inserted: number[] = [];
  const conflicts = doc.people.map((person) => {
    const index = statements.length;
    statements.push(birthDifference(person));
    return { index, person };
  });
  const insert = (statement: SqlStatement) => {
    inserted.push(statements.length);
    statements.push(statement);
  };
  const people = new Map(doc.people.map((person) => [person.id, person]));
  const birthGuard = (personIds: string[]) => {
    const differences = [...new Set(personIds)].flatMap((id) => {
      const person = people.get(id);
      return person ? [birthDifference(person)] : [];
    });
    return {
      sql: differences.map(({ sql }) => `NOT EXISTS (${sql})`).join(" AND ") || "1",
      parameters: differences.flatMap(({ parameters }) => parameters),
    };
  };

  for (const person of doc.people) insert(personInsert(person, false));
  for (const session of doc.sessions) {
    insert(sessionInsert(session, false));
    statements.push(sessionHistory(session));
  }
  for (const turn of doc.turns) insert(turnInsert(turn, false));
  for (const chart of doc.charts) {
    // A conflicted person's incoming coordinates/UT must not become a new cache input.
    const guard = birthGuard(chart.personIds);
    insert({
      sql: `INSERT INTO charts (id, inputs_json, facts_json, computed_at)
        SELECT ?, ?, 'null', NULL WHERE ${guard.sql} ON CONFLICT(id) DO NOTHING RETURNING id`,
      parameters: [chart.id, JSON.stringify(chart), ...guard.parameters],
    });
  }
  for (const node of doc.loreNodes) {
    const guard = birthGuard(node.kind === "person" ? [node.id] : []);
    const embedding = encodeEmbedding(node.embedding, db.capabilities.vec.dimensions);
    insert({
      sql: `INSERT INTO lore_nodes (id, kind, summary, embedding, refs_json)
        SELECT ?, ?, ?, ?, ? WHERE ${guard.sql} ON CONFLICT(id) DO NOTHING RETURNING id`,
      parameters: [
        node.id,
        node.kind,
        node.summary,
        embedding,
        JSON.stringify(node.refs),
        ...guard.parameters,
      ],
    });
    if (db.capabilities.vec.enabled) {
      // Read the winning row, not incoming values; do not alter an existing vector.
      statements.push({
        sql: `INSERT INTO vec_nodes (id, embedding) SELECT id, embedding FROM lore_nodes
          WHERE id=? AND NOT EXISTS (SELECT 1 FROM vec_nodes WHERE id=?)`,
        parameters: [node.id, node.id],
      });
    }
  }
  for (const edge of doc.loreEdges) {
    insert({
      sql: `INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM lore_nodes WHERE id=?)
          AND EXISTS (SELECT 1 FROM lore_nodes WHERE id=?)
        ON CONFLICT(from_id, to_id, rel, source_turn_id) DO NOTHING RETURNING from_id`,
      parameters: [
        edge.from,
        edge.to,
        edge.rel,
        edge.weight,
        edge.sourceTurnId,
        edge.from,
        edge.to,
      ],
    });
  }
  for (const code of doc.consumedCodes) {
    insert({
      sql: `INSERT INTO consumed_codes (code_hash, redeemed_at) VALUES (?, ?)
        ON CONFLICT(code_hash) DO NOTHING RETURNING code_hash`,
      parameters: [code.codeHash, code.redeemedAt],
    });
  }

  const rows = await db.batch(statements);
  const merged = inserted.reduce((count, index) => count + rows[index].length, 0);
  return {
    merged,
    skipped: inserted.length - merged,
    conflicts: conflicts.flatMap(({ index, person }) => {
      const row = rows[index][0];
      return row
        ? [
            {
              personId: person.id,
              existingBirth: decodePerson(row).birth,
              incomingBirth: person.birth,
            },
          ]
        : [];
    }),
  };
}

export async function importJson(
  json: string,
  db: DataDatabase = getDatabase(),
): Promise<ImportReport> {
  let document: unknown;
  try {
    document = JSON.parse(json);
  } catch (cause) {
    throw new Error("Invalid export JSON", { cause });
  }
  return importDocument(document, db);
}
