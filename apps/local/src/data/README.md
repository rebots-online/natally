# X.1 data integration

`index.ts` exports the public surface. `openWebDatabase(options?)` and
`openNativeDatabase({ invoke, ...options })` return `Promise<DataDatabase>`.
`DataDatabase.open(connection, options?)` accepts the real L.1 `StoreConnection`
interface: initialize the T0.9 schema, execute an atomic SQL batch returning one
row array per statement (including `RETURNING` rows), and close the connection.
No database is silently created in memory. Tests explicitly inject SQLite.

The parent mounts the chosen database with `setDatabase(db)`. It can also pass
`db` explicitly to the repository constructors and lifecycle functions:

| Export | Signature / behavior |
| --- | --- |
| `PeopleRepository` | `list()`, `get(personId)`, `upsert(Person)`, `removePerson(personId)` |
| `SessionsRepository` | `list(personId?)`, `get(sessionId)`, `upsert(Session)`, `remove(sessionId)` |
| `TurnsRepository` | `list(sessionId?)`, `get(turnId)`, `upsert(Turn)`, `remove(turnId)` |
| `ChartsRepository` | `list()`, `get(chartId)`, `upsert(ChartFacts, personIds, computedAt?)`, `remove(chartId)` |
| `exportAll` | `(db?) => Promise<ExportDocument>` |
| `exportJson` | `(db?) => Promise<string>`; deterministic pretty-printed plaintext JSON |
| `importDocument` | `(doc: unknown, db?) => Promise<ImportReport>` |
| `importJson` | `(json: string, db?) => Promise<ImportReport>` |
| `removePerson` | `(personId: string, db?) => Promise<void>` |

Repository methods are asynchronous. Missing `get()` results are `undefined`.
`ChartRecord` contains `id`, `inputs`, `facts: ChartFacts | null`, and
`computedAt: number | null`. Imported charts await real computation: their
T0.9 `facts_json` value is JSON `null` (the column itself is NOT NULL), and
`computed_at` is SQL NULL. Parent chart consumers must handle this state and
must provide chart-associated person IDs when caching newly computed facts.

Export reads all application tables and uses L.1 `exportAll()` for lore in one
backend transaction. It exports no license token, cached facts or reading ledger.
J8 must display the exported `EXPORT_PLAINTEXT_NOTICE` before saving. This task
provides the disclosure; the settings/export UI is outside its owned surface.

Import is a single atomic union by record identity; all existing records win,
including node contents, edge weights and consumed-code redemption times.
`merged` counts inserted document records across all seven collections;
`skipped` counts existing or rejected dependent records. Each birth conflict is
`{ personId, existingBirth, incomingBirth }`. Incoming chart inputs and new
person lore nodes for a birth-conflicted person are skipped. Edges whose endpoints
do not exist are skipped. Invalid schemas, duplicate identities, incompatible
embedding dimensions and SQLite failures reject the import; writes roll back.

`removePerson()` deletes their person row, lore node whose ID equals the person ID
and whose kind is `person`, incident edges, matching vectors, and all charts whose
stored `personIds` include the ID. Sessions and turns survive. To reconcile
T0.9's session foreign key with v1's required historical `Session.personId`,
T0.9 migration 3 adds `sessions.historical_person_id` to the existing sessions table.
Removal retains that historical ID before setting the live FK to NULL. It contains
no birth data, and deleting the session deletes the reference. The closed set of
nine application tables is preserved for X.2's erasure contract.
Pre-existing NULL-person sessions without historical IDs cannot be represented
by the shared v1 schema: export rejects them explicitly instead of inventing IDs
or silently dropping transcripts.

Native mounting must register L.1's `plugin:lore|lore_open`, `lore_batch` and
`lore_close` commands and pass Tauri `invoke`. Binary parameters/results use
`{ blob: number[] }`. Web uses the L.1 dedicated SQLite worker with its persistent
OPFS/IndexedDB backend, bundled WASM, and backend-selection registry. Use `db.lore`
for the shared lore store and `db.close()` for coordinated shutdown.

Runtime dependencies are the already declared `@natally/lore` and
`@natally/ephemeris` packages plus the existing platform dependencies behind L.1.
No additional dependency or manifest change is required. The test suite reuses
L.1's installed `better-sqlite3` and `sqlite-vec` via its package-local resolution.
It covers real SQLite (with/without vectors), atomic rollback, deterministic
roundtrips, deletion/history, and native/worker transport protocols backed by
SQLite. Actual Tauri mounting and browser OPFS/IndexedDB execution remain parent
platform integration checks.

Verification: `pnpm vitest run apps/local/src/data`.
In a concurrently changing workspace, use
`pnpm_config_verify_deps_before_run=warn pnpm vitest run apps/local/src/data`
to keep pnpm's automatic dependency preflight from invoking an install.
