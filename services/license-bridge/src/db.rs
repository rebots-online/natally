//! SQLite (rusqlite, bundled) persistence: webhook idempotency ledger, minted jti map,
//! deny-list revocations, and the redeem-code registry.

use rusqlite::Connection;

pub fn open(path: &str) -> Connection {
    let conn = Connection::open(path).expect("bridge: cannot open sqlite db");
    initialize(conn)
}

/// Idempotent schema creation; shared by the file-backed and in-memory databases.
pub fn initialize(conn: Connection) -> Connection {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        -- Idempotency ledger, keyed (processor, invoiceId) per §9.4. The first outcome
        -- for a delivery is stored and returned verbatim on every replay.
        CREATE TABLE IF NOT EXISTS webhook_ledger (
            processor  TEXT NOT NULL,
            invoice_id TEXT NOT NULL,
            outcome    TEXT NOT NULL,
            seen_at    INTEGER NOT NULL,
            PRIMARY KEY (processor, invoice_id)
        );

        -- jti minted per fulfilled purchase; the refund/chargeback path resolves here.
        CREATE TABLE IF NOT EXISTS minted_jti (
            jti        TEXT PRIMARY KEY,
            processor  TEXT NOT NULL,
            invoice_id TEXT NOT NULL,
            sub        TEXT NOT NULL,
            minted_at  INTEGER NOT NULL,
            UNIQUE (processor, invoice_id)
        );

        -- The ONLY revocation path (§9.3, §9.4).
        CREATE TABLE IF NOT EXISTS revocations (
            jti        TEXT PRIMARY KEY,
            revoked_at INTEGER NOT NULL
        );

        -- Single-use redeem codes: stored SHA-256-hashed, never in the clear.
        CREATE TABLE IF NOT EXISTS codes (
            code_hash   TEXT PRIMARY KEY,
            tier        TEXT NOT NULL,
            expires_at  INTEGER,
            outcome     TEXT,
            redeemed_at INTEGER
        );
        "#,
    )
    .expect("bridge: cannot initialize schema");
    conn
}

#[cfg(test)]
pub fn open_in_memory() -> Connection {
    initialize(Connection::open_in_memory().expect("bridge: in-memory db"))
}
