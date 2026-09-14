import Database from "better-sqlite3";
import { load as loadVec } from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS, VEC_MIGRATION_ID, vecMigration } from "../src/ddl.js";
import { migrate, type SqliteDatabase } from "../src/migrate.js";

const APPLICATION_TABLES = [
  "charts",
  "consumed_codes",
  "license_state",
  "lore_edges",
  "lore_nodes",
  "people",
  "readings",
  "sessions",
  "turns",
];

describe("migrations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function tables(): string[] {
    return (
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
  }

  function ledger(): unknown[] {
    return db.prepare("SELECT id FROM _migrations ORDER BY id").all();
  }

  it("creates and reopens the tenth application table with the real vector extension", () => {
    loadVec(db);
    migrate(db, { vec: true, vecDimensions: 384 });
    expect(tables()).toContain("vec_nodes");
    expect(ledger()).toEqual([{ id: 1 }, { id: VEC_MIGRATION_ID }]);
    const vector = JSON.stringify(Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0)));
    db.prepare("INSERT INTO vec_nodes(id, embedding) VALUES (?, ?)").run("node-1", vector);
    migrate(db, { vec: true, vecDimensions: 384 });
    expect(
      db
        .prepare("SELECT id, distance FROM vec_nodes WHERE embedding MATCH ? AND k = 1")
        .get(vector),
    ).toEqual({ id: "node-1", distance: 0 });
    expect(ledger()).toHaveLength(2);
  });

  it("creates exactly nine application tables plus the migration ledger", () => {
    migrate(db, { vec: false });

    expect(tables()).toEqual(["_migrations", ...APPLICATION_TABLES]);
    expect(tables()).toHaveLength(10);
    expect(ledger()).toEqual(MIGRATIONS.map(({ id }) => ({ id })));
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("re-runs without changing schema, existing data, or ledger entries", () => {
    migrate(db, { vec: false });
    db.exec(`
      INSERT INTO people VALUES ('p', 'Robin', '2000-01-02', NULL, 0, 'Toronto', 1);
      INSERT INTO sessions VALUES ('s', 'p', 2);
      INSERT INTO turns VALUES ('t', 's', 'p', 'you', 'Hello', 3, NULL);
      INSERT INTO charts VALUES ('c', '{}', '{"computed":true}', 4);
      INSERT INTO readings VALUES ('r', 5, 'p', 'c');
      INSERT INTO consumed_codes VALUES ('hash', 6);
      INSERT INTO license_state VALUES (1, 'signed-token', 7);
      INSERT INTO lore_nodes VALUES ('n', 'fact', 'Summary', X'0000803F', '[]');
      INSERT INTO lore_edges VALUES ('n', 'n', 'mentions', 0.5, 't');
    `);
    const schema = db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();
    const entries = ledger();
    const contents = APPLICATION_TABLES.map((table) => db.prepare(`SELECT * FROM ${table}`).all());

    migrate(db, { vec: false });
    migrate(db, { vec: false });

    expect(db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
    expect(ledger()).toEqual(entries);
    expect(APPLICATION_TABLES.map((table) => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(
      contents,
    );
  });

  it("creates all specified columns with their SQLite types", () => {
    migrate(db, { vec: false });
    const columns: Record<string, [string, string][]> = {
      people: [
        ["id", "TEXT"],
        ["name", "TEXT"],
        ["birth_date", "TEXT"],
        ["birth_time", "TEXT"],
        ["time_known", "INTEGER"],
        ["place", "TEXT"],
        ["created_at", "INTEGER"],
      ],
      sessions: [
        ["id", "TEXT"],
        ["person_id", "TEXT"],
        ["started_at", "INTEGER"],
      ],
      turns: [
        ["id", "TEXT"],
        ["session_id", "TEXT"],
        ["person_id", "TEXT"],
        ["role", "TEXT"],
        ["text", "TEXT"],
        ["ts", "INTEGER"],
        ["tool_ops", "TEXT"],
      ],
      charts: [
        ["id", "TEXT"],
        ["inputs_json", "TEXT"],
        ["facts_json", "TEXT"],
        ["computed_at", "INTEGER"],
      ],
      readings: [
        ["id", "TEXT"],
        ["ts", "INTEGER"],
        ["person_id", "TEXT"],
        ["chart_id", "TEXT"],
      ],
      consumed_codes: [
        ["code_hash", "TEXT"],
        ["redeemed_at", "INTEGER"],
      ],
      license_state: [
        ["id", "INTEGER"],
        ["token", "TEXT"],
        ["verified_at", "INTEGER"],
      ],
      lore_nodes: [
        ["id", "TEXT"],
        ["kind", "TEXT"],
        ["summary", "TEXT"],
        ["embedding", "BLOB"],
        ["refs_json", "TEXT"],
      ],
      lore_edges: [
        ["from_id", "TEXT"],
        ["to_id", "TEXT"],
        ["rel", "TEXT"],
        ["weight", "REAL"],
        ["source_turn_id", "TEXT"],
      ],
    };

    for (const [table, expected] of Object.entries(columns)) {
      const actual = db.pragma(`table_info(${table})`) as { name: string; type: string }[];
      expect(
        actual.map(({ name, type }) => [name, type]),
        table,
      ).toEqual(expected);
    }
  });

  it("enforces every specified NOT NULL field while allowing optional values", () => {
    migrate(db, { vec: false });
    const required = {
      people: ["name", "birth_date", "time_known", "place"],
      sessions: [],
      turns: ["session_id", "text"],
      charts: ["inputs_json", "facts_json"],
      readings: [],
      consumed_codes: [],
      license_state: [],
      lore_nodes: [],
      lore_edges: [],
    };

    for (const [table, expected] of Object.entries(required)) {
      const actual = db.pragma(`table_info(${table})`) as {
        name: string;
        notnull: number;
      }[];
      expect(
        actual.filter(({ notnull }) => notnull === 1).map(({ name }) => name),
        table,
      ).toEqual(expected);
    }

    const insertPerson = db.prepare(
      "INSERT INTO people (id, name, birth_date, time_known, place) VALUES (?, ?, ?, ?, ?)",
    );
    for (let index = 1; index <= 4; index += 1) {
      const values: (string | number | null)[] = ["p", "Robin", "2000-01-02", 0, "Toronto"];
      values[index] = null;
      expect(() => insertPerson.run(...values)).toThrow(/NOT NULL/);
    }
    insertPerson.run("p", "Robin", "2000-01-02", 0, "Toronto");
    db.exec("INSERT INTO sessions (id) VALUES ('s')");
    expect(() => db.exec("INSERT INTO turns (id, text) VALUES ('t', 'hello')")).toThrow(/NOT NULL/);
    expect(() => db.exec("INSERT INTO turns (id, session_id) VALUES ('t', 's')")).toThrow(
      /NOT NULL/,
    );
    expect(() => db.exec("INSERT INTO charts (id, inputs_json) VALUES ('c', '{}')")).toThrow(
      /NOT NULL/,
    );
    expect(() => db.exec("INSERT INTO charts (id, facts_json) VALUES ('c', '{}')")).toThrow(
      /NOT NULL/,
    );
    db.exec("INSERT INTO turns (id, session_id, text) VALUES ('t', 's', 'hello')");
    expect(db.prepare("SELECT birth_time, created_at FROM people WHERE id = 'p'").get()).toEqual({
      birth_time: null,
      created_at: null,
    });
  });

  it("enforces the session/person foreign keys and the three allowed turn roles", () => {
    migrate(db, { vec: false });
    expect(() => db.exec("INSERT INTO sessions (id, person_id) VALUES ('s', 'missing')")).toThrow(
      /FOREIGN KEY/,
    );
    expect(() =>
      db.exec(
        "INSERT INTO turns (id, session_id, role, text) VALUES ('t', 'missing', 'you', 'Hi')",
      ),
    ).toThrow(/FOREIGN KEY/);

    db.exec(`
      INSERT INTO people (id, name, birth_date, time_known, place)
      VALUES ('p', 'Robin', '2000-01-02', 0, 'Toronto');
      INSERT INTO sessions (id, person_id) VALUES ('s', 'p');
    `);
    const turn = db.prepare("INSERT INTO turns (id, session_id, role, text) VALUES (?, ?, ?, ?)");
    for (const role of ["you", "her", "tool"]) turn.run(role, "s", role, "Hello");
    expect(() => turn.run("bad", "s", "assistant", "Hello")).toThrow(/CHECK/);
    expect(db.prepare("SELECT role FROM turns ORDER BY role").all()).toEqual([
      { role: "her" },
      { role: "tool" },
      { role: "you" },
    ]);
    expect(() => db.exec("DELETE FROM people WHERE id = 'p'")).toThrow(/FOREIGN KEY/);
    expect(() => db.exec("DELETE FROM sessions WHERE id = 's'")).toThrow(/FOREIGN KEY/);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("enforces primary keys, the license singleton and source-specific lore edges", () => {
    migrate(db, { vec: false });
    for (const table of APPLICATION_TABLES.filter((name) => name !== "lore_edges")) {
      const primaryKey = table === "consumed_codes" ? "code_hash" : "id";
      const columns = db.pragma(`table_info(${table})`) as { name: string; pk: number }[];
      expect(
        columns.filter(({ pk }) => pk > 0).map(({ name }) => name),
        table,
      ).toEqual([primaryKey]);
    }

    expect(() => db.exec("INSERT INTO license_state (id) VALUES (2)")).toThrow(/CHECK/);
    db.exec("INSERT INTO license_state VALUES (1, 'token', 1)");
    expect(() => db.exec("INSERT INTO license_state (id) VALUES (1)")).toThrow(/UNIQUE/);
    db.exec("INSERT INTO consumed_codes VALUES ('hash', 1)");
    expect(() => db.exec("INSERT INTO consumed_codes VALUES ('hash', 2)")).toThrow(/UNIQUE/);

    const edge = db.prepare(
      "INSERT INTO lore_edges (from_id, to_id, rel, weight, source_turn_id) VALUES (?, ?, ?, ?, ?)",
    );
    edge.run("a", "b", "relates", 0.5, "t1");
    expect(() => edge.run("a", "b", "relates", 0.8, "t1")).toThrow(/UNIQUE/);
    edge.run("a", "b", "relates", 0.8, "t2");
    edge.run("a", "b", "mentions", 0.8, "t1");
    expect(db.prepare("SELECT COUNT(*) AS count FROM lore_edges").get()).toEqual({ count: 3 });
  });

  it("rolls back partial DDL and ledger changes when a migration fails", () => {
    db.exec("CREATE TABLE charts (preserved TEXT); INSERT INTO charts VALUES ('keep me')");

    expect(() => migrate(db, { vec: false })).toThrow(/charts already exists/);

    expect(tables()).toEqual(["charts"]);
    expect(db.prepare("SELECT * FROM charts").all()).toEqual([{ preserved: "keep me" }]);
    expect(db.inTransaction).toBe(false);
    db.exec("ALTER TABLE charts RENAME TO preserved_charts");
    migrate(db, { vec: false });
    expect(ledger()).toEqual(MIGRATIONS.map(({ id }) => ({ id })));
    expect(db.prepare("SELECT * FROM preserved_charts").all()).toEqual([{ preserved: "keep me" }]);
  });

  it("rolls back DDL if recording the migration fails", () => {
    db.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY);
      CREATE TRIGGER reject_migration BEFORE INSERT ON _migrations
      BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END;
    `);

    expect(() => migrate(db, { vec: false })).toThrow("ledger unavailable");
    expect(tables()).toEqual(["_migrations"]);
    expect(ledger()).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it("does not commit or roll back a transaction owned by its caller", () => {
    db.pragma("foreign_keys = ON");
    db.exec(
      "BEGIN; CREATE TABLE caller_data (value TEXT); INSERT INTO caller_data VALUES ('keep')",
    );
    migrate(db, { vec: false });
    expect(db.inTransaction).toBe(true);
    expect(db.prepare("SELECT * FROM caller_data").all()).toEqual([{ value: "keep" }]);
    expect(ledger()).toEqual(MIGRATIONS.map(({ id }) => ({ id })));

    db.exec("ROLLBACK");
    expect(tables()).toEqual([]);
  });

  it("preserves its caller transaction when migration fails", () => {
    db.pragma("foreign_keys = ON");
    db.exec("BEGIN; CREATE TABLE charts (value TEXT); INSERT INTO charts VALUES ('keep')");

    expect(() => migrate(db, { vec: false })).toThrow(/charts already exists/);
    expect(db.inTransaction).toBe(true);
    expect(tables()).toEqual(["charts"]);
    expect(db.prepare("SELECT * FROM charts").all()).toEqual([{ value: "keep" }]);
    db.exec("COMMIT");
    expect(db.prepare("SELECT * FROM charts").all()).toEqual([{ value: "keep" }]);
  });

  it("needs only the structural synchronous database interface", () => {
    const adapter: SqliteDatabase = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        return {
          get: (...parameters) => statement.get(...parameters),
          run: (...parameters) => statement.run(...parameters),
        };
      },
    };

    migrate(adapter, { vec: false });
    migrate(adapter, { vec: false });
    expect(tables()).toEqual(["_migrations", ...APPLICATION_TABLES]);
  });

  it("never probes or emits extension SQL when vec is disabled", () => {
    const statements: string[] = [];
    const adapter: SqliteDatabase = {
      exec: (sql) => {
        statements.push(sql);
        return db.exec(sql);
      },
      prepare: (sql) => {
        statements.push(sql);
        return db.prepare(sql);
      },
    };

    migrate(adapter, { vec: false });
    expect(statements.join("\n")).not.toMatch(/vec0|vec_nodes|pragma_module_list/i);
    expect(tables()).toEqual(["_migrations", ...APPLICATION_TABLES]);
  });

  it("keeps the optional migration pending if sqlite-vec has not loaded", () => {
    expect(
      db.prepare("SELECT name FROM pragma_module_list WHERE name = 'vec0'").get(),
    ).toBeUndefined();

    migrate(db, { vec: true });
    migrate(db, { vec: true });

    expect(tables()).toEqual(["_migrations", ...APPLICATION_TABLES]);
    expect(ledger()).toEqual(MIGRATIONS.map(({ id }) => ({ id })));
    expect(
      db.prepare("SELECT id FROM _migrations WHERE id = ?").get(VEC_MIGRATION_ID),
    ).toBeUndefined();
  });

  it("supports adapters that explicitly disable extensions", () => {
    const adapter: SqliteDatabase = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        if (sql.includes("pragma_module_list")) throw new Error("extensions disabled");
        return db.prepare(sql);
      },
    };

    migrate(adapter, { vec: true, extensions: false });
    expect(tables()).toEqual(["_migrations", ...APPLICATION_TABLES]);
  });
});

describe("optional vector DDL", () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid embedding width %s",
    (dimensions) => {
      expect(() => vecMigration(dimensions)).toThrow(/positive safe integer/);
    },
  );
});
