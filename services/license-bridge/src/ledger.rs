// natally — the bridge's idempotent SQLite ledger (§9.4, §9.5).
//
// INSERT-ONLY discipline (house never-delete rule): corrections are
// compensating rows; there is no UPDATE or DELETE statement anywhere in this
// module. Idempotency for webhooks rests on the primary key
// `(processor, invoice_id)`: a redelivered event hits `ON CONFLICT DO
// NOTHING` inside an IMMEDIATE transaction and returns the original row's
// jti, so a double delivery mints nothing new and still answers 200.

use crate::codes::random_jti;
use crate::mint;
use ed25519_dalek::SigningKey;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS purchase_events (
    processor   TEXT NOT NULL,
    invoice_id  TEXT NOT NULL,
    app_user_id TEXT NOT NULL,
    jti         TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (processor, invoice_id)
);
CREATE TABLE IF NOT EXISTS issuances (
    jti       TEXT PRIMARY KEY,
    sub       TEXT NOT NULL,
    tier      TEXT NOT NULL,
    iat       INTEGER NOT NULL,
    exp       INTEGER,
    token     TEXT NOT NULL,
    source    TEXT NOT NULL,
    issued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS consumed_codes (
    code_hash   TEXT PRIMARY KEY,
    redeemed_at INTEGER NOT NULL,
    jti         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revocations (
    jti        TEXT PRIMARY KEY,
    revoked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issuances_sub ON issuances(sub, issued_at);
";

/// Create the ledger tables (idempotent).
pub fn init(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(SCHEMA)
}

/// Outcome of a recorded purchase event.
pub enum PurchaseOutcome {
    /// Fresh `(processor, invoice_id)` — the passed-in jti/token were stored.
    Recorded,
    /// Already-present PK — nothing new minted; the original jti is returned.
    Duplicate { jti: String },
}

/// Record a verified purchase event and (only when fresh) its issuance, in one
/// IMMEDIATE transaction. Shared by the webhook path (processor = the rail)
/// and the /mint path (processor = 'revenuecat', invoice_id = purchaseRef).
pub fn record_purchase_and_issuance(
    conn: &mut Connection,
    processor: &str,
    invoice_id: &str,
    app_user_id: &str,
    jti: &str,
    token: &str,
    iat: u64,
    source: &str,
    now_ms: u64,
) -> Result<PurchaseOutcome, rusqlite::Error> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let inserted = tx.execute(
        "INSERT INTO purchase_events (processor, invoice_id, app_user_id, jti, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(processor, invoice_id) DO NOTHING",
        params![processor, invoice_id, app_user_id, jti, now_ms as i64],
    )?;
    if inserted == 0 {
        let existing: String = tx.query_row(
            "SELECT jti FROM purchase_events WHERE processor = ?1 AND invoice_id = ?2",
            params![processor, invoice_id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        return Ok(PurchaseOutcome::Duplicate { jti: existing });
    }
    tx.execute(
        "INSERT INTO issuances (jti, sub, tier, iat, exp, token, source, issued_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
        params![jti, app_user_id, mint::TOKEN_TIER, iat as i64, token, source, now_ms as i64],
    )?;
    tx.commit()?;
    Ok(PurchaseOutcome::Recorded)
}

/// The stored token for a jti, if any.
pub fn token_by_jti(conn: &Connection, jti: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT token FROM issuances WHERE jti = ?1",
        params![jti],
        |row| row.get(0),
    )
    .optional()
}

/// The most recent token issued for an app user (§9.4 `POST /verify`).
pub fn latest_token_for_sub(
    conn: &Connection,
    sub: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT token FROM issuances WHERE sub = ?1 ORDER BY issued_at DESC, rowid DESC LIMIT 1",
        params![sub],
        |row| row.get(0),
    )
    .optional()
}

/// The jti already bound to a consumed code hash, if any.
pub fn code_consumed_jti(
    conn: &Connection,
    code_hash: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT jti FROM consumed_codes WHERE code_hash = ?1",
        params![code_hash],
        |row| row.get(0),
    )
    .optional()
}

/// Redeem a code exactly once: the consumed-code row and the issuance land in
/// the same IMMEDIATE transaction, so two racing redemptions of the same
/// (canonical) code yield exactly one fresh row. Returns false on reuse.
pub fn redeem_code(
    conn: &mut Connection,
    code_hash: &str,
    sub: &str,
    jti: &str,
    token: &str,
    iat: u64,
    now_ms: u64,
) -> Result<bool, rusqlite::Error> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let inserted = tx.execute(
        "INSERT INTO consumed_codes (code_hash, redeemed_at, jti)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(code_hash) DO NOTHING",
        params![code_hash, now_ms as i64, jti],
    )?;
    if inserted == 0 {
        tx.commit()?;
        return Ok(false);
    }
    tx.execute(
        "INSERT INTO issuances (jti, sub, tier, iat, exp, token, source, issued_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, 'redeem', ?6)",
        params![jti, sub, mint::TOKEN_TIER, iat as i64, token, now_ms as i64],
    )?;
    tx.commit()?;
    Ok(true)
}

/// Revoke a jti (INSERT-only; duplicates are no-ops). This is the operator's
/// write path into the published deny-list: rows land in this table and are
/// signed into the envelope by `GET /denylist` and every `POST /verify`.
pub fn revoke_jti(conn: &Connection, jti: &str, now_ms: u64) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO revocations (jti, revoked_at) VALUES (?1, ?2)
         ON CONFLICT(jti) DO NOTHING",
        params![jti, now_ms as i64],
    )?;
    Ok(())
}

/// The revoked jti set (unsorted; `mint::sign_denylist_envelope` sorts).
pub fn revoked_jtis(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT jti FROM revocations")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Convenience for tests/operator tooling: mint + record in one call.
pub fn mint_and_record(
    conn: &mut Connection,
    signer: &SigningKey,
    processor: &str,
    invoice_id: &str,
    app_user_id: &str,
    source: &str,
    now_ms: u64,
) -> Result<(String, PurchaseOutcome), rusqlite::Error> {
    let jti = random_jti();
    let token = mint::mint_license_token(signer, app_user_id, now_ms / 1000, &jti);
    let outcome = record_purchase_and_issuance(
        conn, processor, invoice_id, app_user_id, &jti, &token, now_ms / 1000, source, now_ms,
    )?;
    Ok((token, outcome))
}
