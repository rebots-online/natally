import { type Person, PersonSchema } from "@natally/lore";
import { type DataDatabase, getDatabase, type SqlRow, type SqlStatement } from "./db";

export function decodePerson(row: SqlRow): Person {
  if (row.time_known !== 0 && row.time_known !== 1) throw new Error("Corrupt data time_known");
  return PersonSchema.parse({
    id: row.id,
    name: row.name,
    birth: {
      date: row.birth_date,
      ...(row.birth_time === null ? {} : { time: row.birth_time }),
      timeKnown: row.time_known === 1,
      place: row.place,
    },
  });
}

export function personInsert(person: Person, overwrite: boolean): SqlStatement {
  return {
    sql: `INSERT INTO people (id, name, birth_date, birth_time, time_known, place)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) ${
        overwrite
          ? `DO UPDATE SET
      name=excluded.name, birth_date=excluded.birth_date, birth_time=excluded.birth_time,
      time_known=excluded.time_known, place=excluded.place`
          : "DO NOTHING"
      } RETURNING id`,
    parameters: [
      person.id,
      person.name,
      person.birth.date,
      person.birth.time ?? null,
      Number(person.birth.timeKnown),
      person.birth.place,
    ],
  };
}

export class PeopleRepository {
  constructor(private readonly db: DataDatabase = getDatabase()) {}

  async list(): Promise<Person[]> {
    const [rows] = await this.db.batch([{ sql: "SELECT * FROM people ORDER BY id" }]);
    return rows.map(decodePerson);
  }

  async get(personId: string): Promise<Person | undefined> {
    const [rows] = await this.db.batch([
      { sql: "SELECT * FROM people WHERE id=?", parameters: [personId] },
    ]);
    return rows[0] ? decodePerson(rows[0]) : undefined;
  }

  async upsert(input: Person): Promise<void> {
    const person = PersonSchema.parse(input);
    await this.db.batch([
      {
        sql: `DELETE FROM charts WHERE EXISTS (SELECT 1 FROM json_each(inputs_json, '$.personIds')
          WHERE value=?) AND EXISTS (SELECT 1 FROM people WHERE id=? AND
          (birth_date IS NOT ? OR birth_time IS NOT ? OR time_known IS NOT ? OR place IS NOT ?))`,
        parameters: [
          person.id,
          person.id,
          person.birth.date,
          person.birth.time ?? null,
          Number(person.birth.timeKnown),
          person.birth.place,
        ],
      },
      personInsert(person, true),
    ]);
  }

  removePerson(personId: string): Promise<void> {
    return removePerson(personId, this.db);
  }
}

/** A real deletion with an atomic lore/chart cascade; transcript rows survive. */
export async function removePerson(
  personId: string,
  db: DataDatabase = getDatabase(),
): Promise<void> {
  const personNode = "SELECT id FROM lore_nodes WHERE id=? AND kind='person'";
  await db.batch([
    {
      sql: `UPDATE sessions SET historical_person_id=person_id, person_id=NULL WHERE person_id=?`,
      parameters: [personId],
    },
    ...(db.capabilities.vec.enabled
      ? [
          {
            sql: `DELETE FROM vec_nodes WHERE id IN (${personNode})`,
            parameters: [personId],
          },
        ]
      : []),
    {
      sql: `DELETE FROM lore_edges WHERE from_id IN (${personNode}) OR to_id IN (${personNode})`,
      parameters: [personId, personId],
    },
    { sql: "DELETE FROM lore_nodes WHERE id=? AND kind='person'", parameters: [personId] },
    {
      sql: `DELETE FROM charts WHERE EXISTS (
        SELECT 1 FROM json_each(inputs_json, '$.personIds') WHERE value=?)`,
      parameters: [personId],
    },
    { sql: "DELETE FROM people WHERE id=?", parameters: [personId] },
  ]);
}
