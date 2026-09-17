//! Single-use redeem codes (§9.5, B.4). 128-bit random generated server-side, stored
//! SHA-256-hashed, in the `NATALLY-XXXX-XXXX-XXXX` Crockford base32 shape. Outcomes mirror
//! packages/billing/src/codes.ts `CodeOutcome` exactly:
//! `valid{tier,expiresAt} | invalid{reason: shape|charset|signature|payload}
//!  | already-used{codeHash} | expired{expiresAt}`.
//!
//! A replayed code never re-grants: a successfully redeemed code replays as
//! `already-used`; any other first outcome (invalid/expired) replays verbatim.

use crate::crypto;
use crate::state::Bridge;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

pub const CODE_PREFIX: &str = "NATALLY-";
/// Crockford base32: no I, L, O, U (§9.5 — confusables never appear).
const CROCKFORD_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_BODY_LENGTH: usize = 12;

pub fn code_sha256_hex(canonical_code: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_code.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn is_code_shape(value: &str) -> bool {
    let Some(body) = value.strip_prefix(CODE_PREFIX) else {
        return false;
    };
    let groups: Vec<&str> = body.split('-').collect();
    groups.len() >= 2
        && groups
            .iter()
            .all(|g| g.len() == 4 && g.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()))
}

pub fn crockford_chars(value: &str) -> bool {
    let Some(body) = value.strip_prefix(CODE_PREFIX) else {
        return false;
    };
    body.bytes()
        .filter(|b| *b != b'-')
        .all(|b| CROCKFORD_ALPHABET.contains(&b))
}

/// Mint a single-use code: 128 bits of server-side entropy, rendered as 12 Crockford
/// characters (`NATALLY-XXXX-XXXX-XXXX`) and registered SHA-256-hashed.
pub fn issue_code(
    bridge: &Bridge,
    tier: &str,
    expires_at: Option<i64>,
) -> (String, String) {
    let entropy = crypto::random_bytes(16); // 128-bit random
    let mut body = String::with_capacity(CODE_BODY_LENGTH);
    let mut bits: u32 = 0;
    let mut buffer: u32 = 0;
    for byte in &entropy {
        buffer = (buffer << 8) | *byte as u32;
        bits += 8;
        while bits >= 5 && body.len() < CODE_BODY_LENGTH {
            bits -= 5;
            let index = ((buffer >> bits) & 31) as usize;
            body.push(CROCKFORD_ALPHABET[index] as char);
        }
        if body.len() == CODE_BODY_LENGTH {
            break;
        }
    }
    let groups: Vec<String> = body
        .as_bytes()
        .chunks(4)
        .map(|g| String::from_utf8_lossy(g).to_string())
        .collect();
    let code = format!("{CODE_PREFIX}{}", groups.join("-"));
    let code_hash = code_sha256_hex(&code);
    let db = bridge.db.lock().expect("db lock");
    db.execute(
        "INSERT INTO codes (code_hash, tier, expires_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![code_hash, tier, expires_at],
    )
    .expect("insert code");
    (code, code_hash)
}

/// Pure redeem logic; returns the exact B.4 outcome JSON.
pub fn redeem(bridge: &Bridge, raw_code: &str) -> serde_json::Value {
    let code = raw_code.trim().to_uppercase();
    if !is_code_shape(&code) {
        return json!({ "result": "invalid", "reason": "shape" });
    }
    if !crockford_chars(&code) {
        return json!({ "result": "invalid", "reason": "charset" });
    }
    let code_hash = code_sha256_hex(&code);
    let db = bridge.db.lock().expect("db lock");
    let row: Option<(Option<String>, Option<i64>, Option<i64>)> = db
        .query_row(
            "SELECT outcome, redeemed_at, expires_at FROM codes WHERE code_hash = ?1",
            [&code_hash],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();
    match row {
        // Registered code never redeemed: apply time-based outcome.
        Some((None, _, expires_at)) => {
            if let Some(exp) = expires_at {
                if crypto::unix_now() >= exp {
                    let outcome = json!({ "result": "expired", "expiresAt": exp });
                    record_outcome(&db, &code_hash, &outcome);
                    return outcome;
                }
            }
            let outcome = json!({
                "result": "valid",
                "tier": tier_of(&db, &code_hash),
                "expiresAt": expires_at,
            });
            record_outcome(&db, &code_hash, &outcome);
            outcome
        }
        // Replayed code: valid ones re-grant nothing — already-used; other outcomes replay.
        Some((Some(first_outcome), _, _)) => {
            let first: serde_json::Value =
                serde_json::from_str(&first_outcome).expect("stored outcome json");
            if first.get("result").and_then(|r| r.as_str()) == Some("valid") {
                json!({ "result": "already-used", "codeHash": code_hash })
            } else {
                first
            }
        }
        // Unregistered code: nothing to grant; do not register (replay stays invalid).
        None => json!({ "result": "invalid", "reason": "payload" }),
    }
}

fn tier_of(db: &rusqlite::Connection, code_hash: &str) -> serde_json::Value {
    db.query_row(
        "SELECT tier FROM codes WHERE code_hash = ?1",
        [code_hash],
        |row| row.get::<_, String>(0),
    )
    .map(serde_json::Value::String)
    .unwrap_or(serde_json::Value::String("unlimited".to_string()))
}

fn record_outcome(db: &rusqlite::Connection, code_hash: &str, outcome: &serde_json::Value) {
    db.execute(
        "UPDATE codes SET outcome = ?1, redeemed_at = ?2 WHERE code_hash = ?3",
        rusqlite::params![outcome.to_string(), crypto::unix_now(), code_hash],
    )
    .expect("record code outcome");
}

// ---------- HTTP surface ----------

#[derive(Deserialize)]
pub struct RedeemRequest {
    pub code: String,
}

pub async fn redeem_handler(
    State(bridge): State<std::sync::Arc<Bridge>>,
    Json(req): Json<RedeemRequest>,
) -> Json<serde_json::Value> {
    Json(redeem(&bridge, &req.code))
}
