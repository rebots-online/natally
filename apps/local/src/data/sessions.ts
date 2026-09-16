// natally — Session repository over the shared DDL `sessions` table (ARCHITECTURE §5).
// Contract type: `Session` (@natally/lore/types). One row per conversation thread.
//
// The lore pipeline may insert safety-net session rows with a NULL `person_id`
// (packages/lore store core upsertTurn). Those are pipeline guards, not user
// sessions (§5 Session requires a person): this repo does not surface them —
// the same law the §5 export applies when it drops NULL-person rows.
import type { SqliteDb } from "@natally/lore/ddl";
import { type Session, SessionSchema } from "@natally/lore/types";

/** Repository over the `sessions` table (§5). */
export interface SessionsRepo {
  /** Insert a new session; a duplicate id throws — the caller owns identity. */
  create(session: Session): void;
  get(id: string): Session | undefined;
  /** All user sessions (NULL-person lore stubs excluded), oldest-first then id. */
  list(): Session[];
  listByPerson(personId: string): Session[];
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("sessions repo: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

/** NULL-person rows are lore safety-net stubs, not user sessions (§5) — not surfaced. */
function rowToSession(row: Record<string, unknown>): Session | undefined {
  const personId = row["person_id"];
  if (personId === null || personId === undefined) {
    return undefined;
  }
  return SessionSchema.parse({
    id: String(row["id"]),
    personId: String(personId),
    startedAt: Number(row["started_at"] ?? 0),
  });
}

export function createSessionsRepo(db: SqliteDb): SessionsRepo {
  return {
    create(session: Session): void {
      const s = SessionSchema.parse(session);
      db.prepare("INSERT INTO sessions (id, person_id, started_at) VALUES (?, ?, ?)").run(
        s.id,
        s.personId,
        s.startedAt,
      );
    },

    get(id: string): Session | undefined {
      const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
      return row === undefined ? undefined : rowToSession(asRow(row));
    },

    list(): Session[] {
      return db
        .prepare("SELECT * FROM sessions ORDER BY started_at ASC, id ASC")
        .all()
        .map((value) => rowToSession(asRow(value)))
        .filter((session): session is Session => session !== undefined);
    },

    listByPerson(personId: string): Session[] {
      return db
        .prepare("SELECT * FROM sessions WHERE person_id = ? ORDER BY started_at ASC, id ASC")
        .all(personId)
        .map((value) => rowToSession(asRow(value)))
        .filter((session): session is Session => session !== undefined);
    },
  };
}
