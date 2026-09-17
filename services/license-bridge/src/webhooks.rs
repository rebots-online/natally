//! Processor webhook ingestion (§9.4). HMAC-verified against per-processor secrets from
//! the bridge's `.env`; idempotent via the SQLite ledger keyed `(processor, invoiceId)` —
//! a replayed delivery returns the first outcome and never re-mints.
//!
//! Event body (uniform across rails; each rail's adapter normalizes upstream):
//! `{ "event": "purchase.fulfilled" | "refund" | "chargeback", "invoiceId": "...",
//!    "userId": "..." }` — `userId` required for `purchase.fulfilled`.

use crate::crypto;
use crate::state::Bridge;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

const SIGNATURE_HEADER: &str = "x-natally-signature";

#[derive(Deserialize)]
pub struct WebhookEvent {
    pub event: String,
    #[serde(rename = "invoiceId")]
    pub invoice_id: String,
    #[serde(rename = "userId", default)]
    pub user_id: Option<String>,
}

pub async fn webhook_handler(
    State(bridge): State<std::sync::Arc<Bridge>>,
    Path(processor): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let Some(secret) = bridge.secret_for(&processor).map(|s| s.to_string()) else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "unknown-rail"}))).into_response();
    };
    let provided = headers
        .get(SIGNATURE_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("v1="))
        .unwrap_or("");
    let expected = crypto::hmac_sha256_hex(&secret, &body);
    if provided.is_empty() || !crypto::signatures_equal(provided, &expected) {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": "bad-signature"})))
            .into_response();
    }
    let event: WebhookEvent = match serde_json::from_slice(&body) {
        Ok(e) => e,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-event"}))).into_response()
        }
    };
    if event.invoice_id.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-event"}))).into_response();
    }
    let outcome = match event.event.as_str() {
        "purchase.fulfilled" => {
            let Some(user_id) = event.user_id.as_deref().filter(|s| !s.is_empty()) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "missing-userId"})),
                )
                    .into_response();
            };
            process_fulfilled(&bridge, &processor, &event.invoice_id, user_id)
        }
        "refund" | "chargeback" => process_reversal(&bridge, &processor, &event.invoice_id),
        _ => {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad-event"}))).into_response()
        }
    };
    (StatusCode::OK, Json(outcome)).into_response()
}

/// First delivery of a fulfilled purchase mints a token; any later delivery of the same
/// `(processor, invoiceId)` returns the stored first outcome verbatim.
fn process_fulfilled(
    bridge: &Bridge,
    processor: &str,
    invoice_id: &str,
    user_id: &str,
) -> serde_json::Value {
    let db = bridge.db.lock().expect("db lock");
    let replayed: Option<String> = db
        .query_row(
            "SELECT outcome FROM webhook_ledger WHERE processor = ?1 AND invoice_id = ?2",
            [processor, invoice_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(outcome) = replayed {
        return serde_json::from_str(&outcome).expect("stored outcome json");
    }
    let (token, jti) = crate::token::mint(bridge, user_id);
    db.execute(
        "INSERT INTO minted_jti (jti, processor, invoice_id, sub, minted_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![jti, processor, invoice_id, user_id, crypto::unix_now()],
    )
    .expect("insert minted_jti");
    let outcome = json!({ "result": "minted", "token": token, "jti": jti });
    db.execute(
        "INSERT INTO webhook_ledger (processor, invoice_id, outcome, seen_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![processor, invoice_id, outcome.to_string(), crypto::unix_now()],
    )
    .expect("insert webhook_ledger");
    outcome
}

/// Refund/chargeback that identifies a fulfilled purchase revokes the minted jti onto the
/// deny-list — the ONLY revocation path. Replays return the stored outcome.
fn process_reversal(bridge: &Bridge, processor: &str, invoice_id: &str) -> serde_json::Value {
    let db = bridge.db.lock().expect("db lock");
    let replayed: Option<String> = db
        .query_row(
            "SELECT outcome FROM webhook_ledger WHERE processor = ?1 AND invoice_id = ?2",
            [processor, invoice_id],
            |row| row.get(0),
        )
        .ok();
    if let Some(outcome) = replayed {
        // If the first delivery was the fulfillment itself, a later refund delivery must
        // still revoke — but a repeated reversal replay returns the stored outcome.
        let already_revoked = serde_json::from_str::<serde_json::Value>(&outcome)
            .ok()
            .and_then(|v| v.get("result").and_then(|r| r.as_str()).map(|s| s.to_owned()))
            == Some("revoked".to_string());
        if already_revoked {
            return serde_json::from_str(&outcome).expect("stored outcome json");
        }
    }
    let jti: Option<String> = db
        .query_row(
            "SELECT jti FROM minted_jti WHERE processor = ?1 AND invoice_id = ?2",
            [processor, invoice_id],
            |row| row.get(0),
        )
        .ok();
    let outcome = match jti {
        Some(jti) => {
            db.execute(
                "INSERT INTO revocations (jti, revoked_at) VALUES (?1, ?2)",
                rusqlite::params![jti, crypto::unix_now()],
            )
            .expect("insert revocation");
            json!({ "result": "revoked", "jti": jti })
        }
        None => json!({ "result": "no-fulfilled-purchase" }),
    };
    db.execute(
        "INSERT INTO webhook_ledger (processor, invoice_id, outcome, seen_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(processor, invoice_id) DO UPDATE SET outcome = excluded.outcome",
        rusqlite::params![processor, invoice_id, outcome.to_string(), crypto::unix_now()],
    )
    .expect("upsert webhook_ledger");
    outcome
}
