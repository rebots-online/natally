import { MIGRATIONS, vecMigration } from "../ddl.js";
import type { MigrateOptions } from "../migrate.js";
import type { LoreStore } from "../store.js";
import {
  type LoreEdge,
  LoreEdgeSchema,
  type LoreNode,
  LoreNodeSchema,
  type Turn,
  TurnSchema,
} from "../types.js";

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export interface SqlStatement {
  sql: string;
  parameters?: SqlValue[];
}
export interface VecCapability {
  enabled: boolean;
  dimensions?: number;
  reason?: "disabled" | "extension-unavailable";
}
export interface StoreCapabilities {
  storage: "memory" | "opfs" | "indexeddb" | "native";
  vec: VecCapability;
  fallbackReason?: string;
}
/** A batch, including reads, is one SQLite transaction and one transport message. */
export interface StoreConnection {
  initialize(options: MigrateOptions): Promise<StoreCapabilities>;
  batch(statements: SqlStatement[]): Promise<SqlRow[][]>;
  close(): Promise<void>;
}
export interface Graph {
  nodes: LoreNode[];
  edges: LoreEdge[];
}
export interface StoreOptions {
  migration?: MigrateOptions;
  /** L.2 can supply extracted nodes; the default preserves the unabridged turn. */
  projectTurn?: (turn: Turn, embedding: number[]) => Graph | Promise<Graph>;
  /** The embedding model is supplied by the pipeline, never loaded by storage. */
  embedQuery?: (text: string) => Promise<number[]>;
  /** Use the companion tokenizer when available. Default: conservative UTF-8 bytes. */
  countTokens?: (text: string) => number;
}
export interface ManagedLoreStore extends LoreStore {
  readonly capabilities: StoreCapabilities;
  upsertGraph(graph: Graph): Promise<void>;
  close(): Promise<void>;
}

export function migrationPlan(options: MigrateOptions) {
  if (options.vecDimensions !== undefined) vecMigration(options.vecDimensions);
  return {
    migrations: MIGRATIONS,
    // Missing dimensions only fail when vec0 is actually available, as in T0.9.
    vector:
      options.vec && options.extensions !== false && options.vecDimensions !== undefined
        ? vecMigration(options.vecDimensions)
        : null,
  };
}

/** Async counterpart of T0.9's runner, using the very same DDL and ledger IDs. */
export async function migrateAsync(
  db: {
    exec(sql: string): Promise<void>;
    all(sql: string, parameters?: SqlValue[]): Promise<SqlRow[]>;
  },
  options: MigrateOptions,
): Promise<VecCapability> {
  migrationPlan(options);
  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec("BEGIN IMMEDIATE");
  try {
    await db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)");
    for (const migration of MIGRATIONS) {
      if ((await db.all("SELECT id FROM _migrations WHERE id = ?", [migration.id])).length)
        continue;
      await db.exec(migration.sql);
      await db.all("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
    }
    const capability = await vectorCapability(db.all.bind(db), options, false);
    if (capability.enabled) {
      const migration = vecMigration(capability.dimensions!);
      if (!(await db.all("SELECT id FROM _migrations WHERE id = ?", [migration.id])).length) {
        await db.exec(migration.sql);
        await db.all("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
      }
      await vectorCapability(db.all.bind(db), options);
    }
    await db.exec("COMMIT");
    return capability;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function vectorCapability(
  all: (sql: string, parameters?: SqlValue[]) => Promise<SqlRow[]>,
  options: MigrateOptions,
  checkTable = true,
): Promise<VecCapability> {
  const loaded = (await all("SELECT name FROM pragma_module_list WHERE name = 'vec0'")).length > 0;
  const table = (await all("SELECT sql FROM sqlite_master WHERE name = 'vec_nodes'")).at(0);
  // A populated vector table must never become stale through a vec-off writer.
  if (table && (!options.vec || options.extensions === false || !loaded)) {
    throw new Error("vec_nodes exists: reopen with sqlite-vec enabled before writing lore");
  }
  if (!options.vec || options.extensions === false) return { enabled: false, reason: "disabled" };
  if (!loaded) return { enabled: false, reason: "extension-unavailable" };
  if (options.vecDimensions === undefined)
    throw new Error("vecDimensions is required with sqlite-vec");
  vecMigration(options.vecDimensions);
  if (
    checkTable &&
    (!table ||
      !new RegExp(`float\\s*\\[\\s*${options.vecDimensions}\\s*\\]`, "i").test(String(table.sql)))
  ) {
    throw new Error("vecDimensions does not match the persisted vec_nodes schema");
  }
  return { enabled: true, dimensions: options.vecDimensions };
}

/** sqlite-vec uses little-endian float32 blobs; DataView avoids host endianness. */
export function encodeEmbedding(values: number[], dimensions?: number): Uint8Array {
  if (dimensions !== undefined && values.length !== dimensions) {
    throw new RangeError(`embedding must have ${dimensions} dimensions`);
  }
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new RangeError("embedding must contain finite float32 values");
    }
    view.setFloat32(index * 4, value, true);
  });
  return bytes;
}

function parseJson(value: SqlValue | undefined, column: string): unknown {
  try {
    if (typeof value !== "string") throw new Error("expected JSON text");
    return JSON.parse(value);
  } catch (cause) {
    throw new Error(`Corrupt lore ${column}`, { cause });
  }
}
function decodeNode(row: SqlRow): LoreNode {
  if (!(row.embedding instanceof Uint8Array) || row.embedding.byteLength % 4 !== 0) {
    throw new Error("Corrupt lore embedding blob");
  }
  const view = new DataView(
    row.embedding.buffer,
    row.embedding.byteOffset,
    row.embedding.byteLength,
  );
  return LoreNodeSchema.parse({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    embedding: Array.from({ length: view.byteLength / 4 }, (_, i) => view.getFloat32(i * 4, true)),
    refs: parseJson(row.refs_json, "refs_json"),
  });
}
function decodeEdge(row: SqlRow): LoreEdge {
  return LoreEdgeSchema.parse({
    from: row.from_id,
    to: row.to_id,
    rel: row.rel,
    weight: row.weight,
    sourceTurnId: row.source_turn_id,
  });
}

const nodeColumns = "id, kind, summary, embedding, refs_json";
const edgeColumns = "from_id, to_id, rel, weight, source_turn_id";
const edgeOrder = "from_id, to_id, rel, source_turn_id";
// refs contains source turn IDs, not fabricated person IDs or model output.
const scope = `(? IS NULL OR (n.kind = 'person' AND n.id = ?) OR EXISTS (
  SELECT 1 FROM json_each(n.refs_json) ref JOIN turns t ON t.id = ref.value
  JOIN sessions s ON s.id = t.session_id WHERE COALESCE(t.person_id, s.person_id) = ?))`;

export class SqliteLoreStore implements ManagedLoreStore {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private constructor(
    private readonly db: StoreConnection,
    public readonly capabilities: StoreCapabilities,
    private readonly options: StoreOptions,
  ) {}

  static async open(db: StoreConnection, options: StoreOptions = {}): Promise<SqliteLoreStore> {
    try {
      const capabilities = await db.initialize(options.migration ?? { vec: false });
      return new SqliteLoreStore(db, capabilities, options);
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("LoreStore is closed"));
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private graphStatements(graph: Graph): SqlStatement[] {
    const statements: SqlStatement[] = [];
    for (const input of graph.nodes) {
      const node = LoreNodeSchema.parse(input);
      const embedding = encodeEmbedding(node.embedding, this.capabilities.vec.dimensions);
      statements.push({
        sql: `INSERT INTO lore_nodes (${nodeColumns}) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, summary=excluded.summary,
        embedding=excluded.embedding, refs_json=excluded.refs_json`,
        parameters: [node.id, node.kind, node.summary, embedding, JSON.stringify(node.refs)],
      });
      if (this.capabilities.vec.enabled) {
        statements.push({ sql: "DELETE FROM vec_nodes WHERE id = ?", parameters: [node.id] });
        statements.push({
          sql: "INSERT INTO vec_nodes (id, embedding) VALUES (?, ?)",
          parameters: [node.id, embedding],
        });
      }
    }
    for (const input of graph.edges) {
      const edge = LoreEdgeSchema.parse(input);
      statements.push({
        sql: `INSERT INTO lore_edges (${edgeColumns}) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(from_id, to_id, rel, source_turn_id) DO UPDATE SET weight=excluded.weight`,
        parameters: [edge.from, edge.to, edge.rel, edge.weight, edge.sourceTurnId],
      });
    }
    return statements;
  }

  upsertTurn(input: Turn, values: number[]): Promise<void> {
    return this.run(async () => {
      const turn = TurnSchema.parse(input);
      encodeEmbedding(values, this.capabilities.vec.dimensions);
      const graph = this.options.projectTurn
        ? await this.options.projectTurn(turn, [...values])
        : {
            nodes: [
              {
                id: `turn:${turn.id}`,
                kind: "thread" as const,
                summary: turn.text,
                embedding: values,
                refs: [turn.id],
              },
            ],
            edges: [],
          };
      await this.db.batch([
        {
          sql: `INSERT INTO turns (id, session_id, person_id, role, text, ts, tool_ops)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
          session_id=excluded.session_id, person_id=excluded.person_id, role=excluded.role,
          text=excluded.text, ts=excluded.ts, tool_ops=excluded.tool_ops`,
          parameters: [
            turn.id,
            turn.sessionId,
            turn.personId ?? null,
            turn.role,
            turn.text,
            turn.ts,
            turn.toolOps === undefined ? null : JSON.stringify(turn.toolOps),
          ],
        },
        ...this.graphStatements(graph),
      ]);
    });
  }

  /** Idempotent storage upsert. The extraction pipeline owns accumulated weights. */
  upsertGraph(graph: Graph): Promise<void> {
    return this.run(async () => {
      await this.db.batch(this.graphStatements(graph));
    });
  }

  query(personId: string | undefined, q: string, k: number, budget: number): Promise<Graph> {
    return this.run(async () => {
      if (!Number.isSafeInteger(k) || k < 0 || !Number.isSafeInteger(budget) || budget < 0) {
        throw new RangeError("k and budget must be non-negative safe integers");
      }
      if (k === 0 || budget === 0) return { nodes: [], edges: [] };
      const person = personId ?? null;
      const parameters: SqlValue[] = [person, person, person];
      let scoring: string;
      let matching = "1";
      if (this.capabilities.vec.enabled && this.options.embedQuery && q.trim()) {
        const embedding = await this.options.embedQuery(q);
        parameters.push(encodeEmbedding(embedding, this.capabilities.vec.dimensions));
        scoring = "-vec_distance_cosine(embedding, ?)";
      } else {
        const terms = [...new Set(q.toLowerCase().trim().split(/\s+/u).filter(Boolean))];
        scoring = terms.length
          ? terms
              .map(() => "CASE WHEN lower(summary) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END")
              .join(" + ")
          : "0";
        for (const term of terms) parameters.push(`%${term.replace(/[\\%_]/gu, "\\$&")}%`);
        if (terms.length) matching = "score > 0";
      }
      parameters.push(k);
      const [rows, edgeRows] = await this.db.batch([
        {
          sql: `WITH RECURSIVE scoped AS (SELECT n.* FROM lore_nodes n WHERE ${scope}),
          scored AS (SELECT *, ${scoring} AS score FROM scoped),
          seeds AS (SELECT id, score FROM scored WHERE ${matching} ORDER BY score DESC, id LIMIT ?),
          walk(id, depth) AS (
            SELECT id, 0 FROM seeds UNION
            SELECT n.id, walk.depth + 1 FROM walk JOIN lore_edges e
              ON e.from_id = walk.id OR e.to_id = walk.id
            JOIN scoped n ON n.id = CASE WHEN e.from_id = walk.id THEN e.to_id ELSE e.from_id END
            WHERE walk.depth < 2
          ) SELECT n.* FROM scoped n JOIN (SELECT id, MIN(depth) depth FROM walk GROUP BY id) w ON w.id=n.id
            LEFT JOIN seeds s ON s.id=n.id ORDER BY w.depth, s.score DESC, n.id`,
          parameters,
        },
        {
          sql: `SELECT ${edgeColumns} FROM lore_edges e WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM turns t JOIN sessions s ON s.id=t.session_id
          WHERE t.id=e.source_turn_id AND COALESCE(t.person_id,s.person_id)=?) ORDER BY ${edgeOrder}`,
          parameters: [person, person],
        },
      ]);
      const count =
        this.options.countTokens ?? ((text: string) => new TextEncoder().encode(text).length);
      let remaining = budget;
      const fits = (text: string) => {
        const cost = count(text);
        if (!Number.isSafeInteger(cost) || cost < 0)
          throw new Error("countTokens must return a non-negative safe integer");
        if (cost > remaining) return false;
        remaining -= cost;
        return true;
      };
      const nodes = rows!.map(decodeNode).filter((node) => fits(node.summary));
      const ids = new Set(nodes.map((node) => node.id));
      const edges = edgeRows!
        .map(decodeEdge)
        .filter(
          (edge) =>
            ids.has(edge.from) && ids.has(edge.to) && fits(`${edge.from} ${edge.rel} ${edge.to}`),
        );
      return { nodes, edges };
    });
  }

  exportAll(): Promise<Graph> {
    return this.run(async () => {
      const [nodes, edges] = await this.db.batch([
        { sql: `SELECT ${nodeColumns} FROM lore_nodes ORDER BY id` },
        { sql: `SELECT ${edgeColumns} FROM lore_edges ORDER BY ${edgeOrder}` },
      ]);
      return { nodes: nodes!.map(decodeNode), edges: edges!.map(decodeEdge) };
    });
  }

  deleteAll(): Promise<void> {
    return this.run(async () => {
      await this.db.batch([
        ...(this.capabilities.vec.enabled ? [{ sql: "DELETE FROM vec_nodes" }] : []),
        { sql: "DELETE FROM lore_edges" },
        { sql: "DELETE FROM lore_nodes" },
      ]);
    });
  }

  stats(): Promise<{ turns: number; nodes: number; edges: number }> {
    return this.run(async () => {
      const [rows] = await this.db.batch([
        {
          sql: `SELECT (SELECT COUNT(*) FROM turns) AS turns,
        (SELECT COUNT(*) FROM lore_nodes) AS nodes, (SELECT COUNT(*) FROM lore_edges) AS edges`,
        },
      ]);
      const row = rows![0]!;
      return { turns: Number(row.turns), nodes: Number(row.nodes), edges: Number(row.edges) };
    });
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.closing = this.pending.then(() => this.db.close());
    }
    return this.closing;
  }
}
