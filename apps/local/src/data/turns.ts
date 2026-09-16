// natally — Turn repository over the shared DDL `turns` table (ARCHITECTURE §5).
// Contract type: `Turn` (@natally/lore/types). Append-only law (§5): turns are
// written once and never mutated — a duplicate id throws; corrections are new
// turns. `tool_ops` is the JSON-encoded §7.3 DomWriteOp[] recorded on tool
// turns (no hidden writes), validated on every read (INC-19).
import type { SqliteDb } from "@natally/lore/ddl";
import { DomWriteOpSchema, type Turn, TurnSchema } from "@natally/lore/types";

/** Repository over the `turns` table (§5). Writes are append-only. */
export interface TurnsRepo {
  /** Append one turn. A duplicate id throws — the transcript is immutable history. */
  append(turn: Turn): void;
  get(id: string): Turn | undefined;
  /** Every turn, transcript order (ts asc, then id). */
  list(): Turn[];
  listBySession(sessionId: string): Turn[];
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("turns repo: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

function rowToTurn(row: Record<string, unknown>): Turn {
  const id = String(row["id"]);
  let toolOps: Turn["toolOps"];
  if (typeof row["tool_ops"] === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row["tool_ops"]);
    } catch {
      throw new Error(`turns repo: malformed tool_ops JSON on turn ${id}`);
    }
    toolOps = (Array.isArray(parsed) ? parsed : []).map((op) => DomWriteOpSchema.parse(op));
  }
  return TurnSchema.parse({
    id,
    sessionId: String(row["session_id"]),
    ...(row["person_id"] === null || row["person_id"] === undefined
      ? {}
      : { personId: String(row["person_id"]) }),
    role: row["role"],
    text: String(row["text"] ?? ""),
    ts: Number(row["ts"] ?? 0),
    ...(toolOps === undefined ? {} : { toolOps }),
  });
}

export function createTurnsRepo(db: SqliteDb): TurnsRepo {
  return {
    append(turn: Turn): void {
      const t = TurnSchema.parse(turn);
      db.prepare(
        "INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        t.id,
        t.sessionId,
        t.personId ?? null,
        t.role,
        t.text,
        t.ts,
        t.toolOps === undefined ? null : JSON.stringify(t.toolOps),
      );
    },

    get(id: string): Turn | undefined {
      const row = db.prepare("SELECT * FROM turns WHERE id = ?").get(id);
      return row === undefined ? undefined : rowToTurn(asRow(row));
    },

    list(): Turn[] {
      return db
        .prepare("SELECT * FROM turns ORDER BY ts ASC, id ASC")
        .all()
        .map((value) => rowToTurn(asRow(value)));
    },

    listBySession(sessionId: string): Turn[] {
      return db
        .prepare("SELECT * FROM turns WHERE session_id = ? ORDER BY ts ASC, id ASC")
        .all(sessionId)
        .map((value) => rowToTurn(asRow(value)));
    },
  };
}
