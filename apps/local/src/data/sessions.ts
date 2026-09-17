import { type Session, SessionSchema } from "@natally/lore";
import { type DataDatabase, getDatabase, type SqlRow, type SqlStatement } from "./db";

export const sessionSelect = `SELECT s.id, COALESCE(s.person_id, s.historical_person_id) AS person_id,
  s.started_at FROM sessions s`;

export function decodeSession(row: SqlRow): Session {
  if (row.person_id === null) {
    throw new Error(
      `Session ${row.id} has no historical person ID; ExportDocument v1 requires one`,
    );
  }
  return SessionSchema.parse({ id: row.id, personId: row.person_id, startedAt: row.started_at });
}

export function sessionInsert(session: Session, overwrite: boolean): SqlStatement {
  return {
    sql: `INSERT INTO sessions (id, person_id, historical_person_id, started_at)
      VALUES (?, (SELECT id FROM people WHERE id=?), ?, ?) ON CONFLICT(id)
      ${overwrite ? "DO UPDATE SET person_id=excluded.person_id, historical_person_id=excluded.historical_person_id, started_at=excluded.started_at" : "DO NOTHING"}
      RETURNING id`,
    parameters: [session.id, session.personId, session.personId, session.startedAt],
  };
}

export function sessionHistory(session: Session): SqlStatement {
  return {
    sql: `UPDATE sessions SET historical_person_id=? WHERE id=?
      AND person_id IS NULL AND historical_person_id IS NULL`,
    parameters: [session.personId, session.id],
  };
}

export class SessionsRepository {
  constructor(private readonly db: DataDatabase = getDatabase()) {}

  async list(personId?: string): Promise<Session[]> {
    const [rows] = await this.db.batch([
      {
        sql: `${sessionSelect} ${personId === undefined ? "" : "WHERE COALESCE(s.person_id,s.historical_person_id)=?"}
        ORDER BY s.started_at, s.id`,
        parameters: personId === undefined ? [] : [personId],
      },
    ]);
    return rows.map(decodeSession);
  }

  async get(sessionId: string): Promise<Session | undefined> {
    const [rows] = await this.db.batch([
      {
        sql: `${sessionSelect} WHERE s.id=?`,
        parameters: [sessionId],
      },
    ]);
    return rows[0] ? decodeSession(rows[0]) : undefined;
  }

  async upsert(input: Session): Promise<void> {
    const session = SessionSchema.parse(input);
    await this.db.batch([sessionInsert(session, true), sessionHistory(session)]);
  }

  /** Explicit transcript deletion, never used by removePerson. */
  async remove(sessionId: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM turns WHERE session_id=?", parameters: [sessionId] },
      { sql: "DELETE FROM sessions WHERE id=?", parameters: [sessionId] },
    ]);
  }
}
