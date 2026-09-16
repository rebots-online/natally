// natally — Person repository over the shared DDL `people` table (ARCHITECTURE §5).
// Contract type: `Person` (@natally/lore/types). Birth data is quasi-PII (§12);
// `timeKnown: false` drives the honest-absence branches (§6: solar chart, no
// Ascendant). Rows are mapped and zod-validated on every read — a shape bug
// fails loudly instead of surfacing a lie (INC-19).
import type { SqliteDb } from "@natally/lore/ddl";
import { type Person, PersonSchema } from "@natally/lore/types";

/** Repository over the `people` table (§5). */
export interface PeopleRepo {
  /** Insert a new person; a duplicate id throws — the caller owns identity. */
  create(person: Person): void;
  /** Full-row update by id; `false` when the id does not exist. The import path never calls this. */
  update(person: Person): boolean;
  get(id: string): Person | undefined;
  /** All people, oldest-first then id — deterministic scan order. */
  list(): Person[];
  /**
   * Real deletion (§8.4 law: deletion is real deletion, not soft-hide). This is the
   * repository capability for the delete-everything flow; the J8 import path NEVER
   * deletes — it merges by id only.
   */
  remove(id: string): boolean;
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("people repo: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

function rowToPerson(row: Record<string, unknown>): Person {
  const time = row["birth_time"];
  return PersonSchema.parse({
    id: String(row["id"]),
    name: String(row["name"]),
    birth: {
      date: String(row["birth_date"]),
      ...(typeof time === "string" ? { time } : {}),
      place: String(row["place"]),
      timeKnown: Number(row["time_known"] ?? 0) !== 0,
    },
  });
}

export function createPeopleRepo(db: SqliteDb): PeopleRepo {
  return {
    create(person: Person): void {
      const p = PersonSchema.parse(person);
      db.prepare(
        "INSERT INTO people (id, name, birth_date, birth_time, time_known, place, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        p.id,
        p.name,
        p.birth.date,
        p.birth.time ?? null,
        p.birth.timeKnown ? 1 : 0,
        p.birth.place,
        Date.now(),
      );
    },

    update(person: Person): boolean {
      const p = PersonSchema.parse(person);
      const result = db
        .prepare(
          "UPDATE people SET name = ?, birth_date = ?, birth_time = ?, time_known = ?, place = ? " +
            "WHERE id = ?",
        )
        .run(
          p.name,
          p.birth.date,
          p.birth.time ?? null,
          p.birth.timeKnown ? 1 : 0,
          p.birth.place,
          p.id,
        );
      return Number(result.changes) > 0;
    },

    get(id: string): Person | undefined {
      const row = db.prepare("SELECT * FROM people WHERE id = ?").get(id);
      return row === undefined ? undefined : rowToPerson(asRow(row));
    },

    list(): Person[] {
      return db
        .prepare("SELECT * FROM people ORDER BY created_at ASC, id ASC")
        .all()
        .map((value) => rowToPerson(asRow(value)));
    },

    remove(id: string): boolean {
      const result = db.prepare("DELETE FROM people WHERE id = ?").run(id);
      return Number(result.changes) > 0;
    },
  };
}
