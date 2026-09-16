// natally — ChartFacts store repository over the shared DDL `charts` table (ARCHITECTURE §5).
// Chart inputs are content-addressed by the chart id (input hash); the row is
// immutable: computed facts come from the EphemerisEngine only (§6) and a
// repeat put of an existing id NEVER overwrites (first write wins).
//
// Export law (§5/J8): `facts_json` is engine-owned computed data and is NEVER
// serialized — export carries `inputs` only. Import therefore lands inputs
// with a JSON-`null` facts placeholder until the engine recomputes; consumers
// read `facts === null` as honest absence, never a fabricated chart.
import type { SqliteDb } from "@natally/lore/ddl";
import { type ChartInputs, ChartInputsSchema } from "@natally/lore/types";

/** One `charts` row as the contract sees it (§5). */
export interface ChartRecord {
  readonly inputs: ChartInputs;
  /**
   * Computed ChartFacts (§5/§6, engine-owned). `null` = input stored, facts not
   * (yet) computed — the import placeholder; recompute via the EphemerisEngine.
   */
  readonly facts: unknown;
  readonly computedAt: number | null;
}

/** Repository over the `charts` table (§5). */
export interface ChartsRepo {
  /** Content-addressed put: inserts when the id is new, silently keeps the existing row otherwise. */
  put(inputs: ChartInputs, facts: unknown): void;
  get(id: string): ChartRecord | undefined;
  /** Every chart row, id order — the deterministic scan order J8 export maps over. */
  list(): ChartRecord[];
}

function asRow(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("charts repo: expected a row object from the SQLite driver");
  }
  return value as Record<string, unknown>;
}

function parseJson(raw: unknown, id: string, column: string): unknown {
  if (typeof raw !== "string") {
    throw new Error(`charts repo: missing ${column} on chart ${id}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`charts repo: malformed ${column} on chart ${id}`);
  }
}

function rowToRecord(row: Record<string, unknown>): ChartRecord {
  const id = String(row["id"]);
  const inputs: unknown = parseJson(row["inputs_json"], id, "inputs_json");
  const computedAt = row["computed_at"];
  return {
    inputs: ChartInputsSchema.parse(inputs),
    facts: parseJson(row["facts_json"], id, "facts_json"),
    computedAt: computedAt === null || computedAt === undefined ? null : Number(computedAt),
  };
}

export function createChartsRepo(db: SqliteDb): ChartsRepo {
  return {
    put(inputs: ChartInputs, facts: unknown): void {
      const c = ChartInputsSchema.parse(inputs);
      db.prepare(
        "INSERT INTO charts (id, inputs_json, facts_json, computed_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO NOTHING",
      ).run(c.id, JSON.stringify(c), JSON.stringify(facts ?? null), Date.now());
    },

    get(id: string): ChartRecord | undefined {
      const row = db.prepare("SELECT * FROM charts WHERE id = ?").get(id);
      return row === undefined ? undefined : rowToRecord(asRow(row));
    },

    list(): ChartRecord[] {
      return db
        .prepare("SELECT * FROM charts ORDER BY id ASC")
        .all()
        .map((value) => rowToRecord(asRow(value)));
    },
  };
}
