import { type ChartFacts, ChartFactsSchema } from "@natally/ephemeris/types";
import { type ChartInputs, ChartInputsSchema } from "@natally/lore";
import { type DataDatabase, getDatabase, parseStoredJson, type SqlRow } from "./db";

export interface ChartRecord {
  id: string;
  inputs: ChartInputs;
  /** null means imported inputs await real ephemeris computation. */
  facts: ChartFacts | null;
  computedAt: number | null;
}

export function decodeChart(row: SqlRow): ChartRecord {
  const inputs = ChartInputsSchema.parse(parseStoredJson(row.inputs_json, "inputs_json"));
  const value = parseStoredJson(row.facts_json, "facts_json");
  const facts = value === null ? null : ChartFactsSchema.parse(value);
  if (
    inputs.id !== row.id ||
    (facts && (facts.id !== row.id || !sameInputs(inputs, facts.inputs)))
  ) {
    throw new Error("Corrupt data chart identity/inputs");
  }
  if (
    row.computed_at !== null &&
    (typeof row.computed_at !== "number" || !Number.isFinite(row.computed_at))
  ) {
    throw new Error("Corrupt data computed_at");
  }
  return { id: inputs.id, inputs, facts, computedAt: row.computed_at as number | null };
}

function sameInputs(a: ChartFacts["inputs"], b: ChartFacts["inputs"]): boolean {
  return (
    a.system === b.system &&
    a.place.lat === b.place.lat &&
    a.place.lon === b.place.lon &&
    a.ut.length === b.ut.length &&
    a.ut.every((ut, i) => ut === b.ut[i])
  );
}

export class ChartsRepository {
  constructor(private readonly db: DataDatabase = getDatabase()) {}

  async list(): Promise<ChartRecord[]> {
    const [rows] = await this.db.batch([{ sql: "SELECT * FROM charts ORDER BY id" }]);
    return rows.map(decodeChart);
  }

  async get(chartId: string): Promise<ChartRecord | undefined> {
    const [rows] = await this.db.batch([
      { sql: "SELECT * FROM charts WHERE id=?", parameters: [chartId] },
    ]);
    return rows[0] ? decodeChart(rows[0]) : undefined;
  }

  async upsert(input: ChartFacts, personIds: string[], computedAt = Date.now()): Promise<void> {
    const facts = ChartFactsSchema.parse(input);
    const inputs = ChartInputsSchema.parse({ id: facts.id, personIds, ...facts.inputs });
    if (!Number.isFinite(computedAt)) throw new Error("computedAt must be finite");
    await this.db.batch([
      {
        sql: `INSERT INTO charts (id, inputs_json, facts_json, computed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET inputs_json=excluded.inputs_json,
        facts_json=excluded.facts_json, computed_at=excluded.computed_at`,
        parameters: [facts.id, JSON.stringify(inputs), JSON.stringify(facts), computedAt],
      },
    ]);
  }

  async remove(chartId: string): Promise<void> {
    await this.db.batch([{ sql: "DELETE FROM charts WHERE id=?", parameters: [chartId] }]);
  }
}
