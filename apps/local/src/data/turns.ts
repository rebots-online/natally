import { type Turn, TurnSchema } from "@natally/lore";
import {
  type DataDatabase,
  getDatabase,
  parseStoredJson,
  type SqlRow,
  type SqlStatement,
} from "./db";

export function decodeTurn(row: SqlRow): Turn {
  return TurnSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    ...(row.person_id === null ? {} : { personId: row.person_id }),
    role: row.role,
    text: row.text,
    ts: row.ts,
    ...(row.tool_ops === null ? {} : { toolOps: parseStoredJson(row.tool_ops, "tool_ops") }),
  });
}

export function turnInsert(turn: Turn, overwrite: boolean): SqlStatement {
  return {
    sql: `INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) ${
        overwrite
          ? `DO UPDATE SET
      session_id=excluded.session_id, person_id=excluded.person_id, role=excluded.role,
      text=excluded.text, ts=excluded.ts, tool_ops=excluded.tool_ops`
          : "DO NOTHING"
      } RETURNING id`,
    parameters: [
      turn.id,
      turn.sessionId,
      turn.personId ?? null,
      turn.role,
      turn.text,
      turn.ts,
      turn.toolOps === undefined ? null : JSON.stringify(turn.toolOps),
    ],
  };
}

export class TurnsRepository {
  constructor(private readonly db: DataDatabase = getDatabase()) {}

  async list(sessionId?: string): Promise<Turn[]> {
    const [rows] = await this.db.batch([
      {
        sql: `SELECT * FROM turns ${sessionId === undefined ? "" : "WHERE session_id=?"} ORDER BY ts, id`,
        parameters: sessionId === undefined ? [] : [sessionId],
      },
    ]);
    return rows.map(decodeTurn);
  }

  async get(turnId: string): Promise<Turn | undefined> {
    const [rows] = await this.db.batch([
      { sql: "SELECT * FROM turns WHERE id=?", parameters: [turnId] },
    ]);
    return rows[0] ? decodeTurn(rows[0]) : undefined;
  }

  async upsert(input: Turn): Promise<void> {
    await this.db.batch([turnInsert(TurnSchema.parse(input), true)]);
  }

  async remove(turnId: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM turns WHERE id=?", parameters: [turnId] }]);
  }
}
