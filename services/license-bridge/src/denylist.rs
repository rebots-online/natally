//! Signed deny-list (§9.3/§9.4) — the ONLY revocation path. Payload matches
//! `SignedDenyListSchema`: `{ payload: { issuedAt, revokedJti[] }, signature }`, where the
//! signature is Ed25519 over the canonical fixed-field-order JSON
//! `{"issuedAt":N,"revokedJti":[...]}` (identical to `denyListSigningInput` in
//! packages/billing/src/token/format.ts), base64url-encoded.

use crate::crypto;
use crate::state::Bridge;
use axum::extract::State;
use axum::Json;
use serde::Serialize;

// Field names are the wire format (SignedDenyListSchema) and stay camelCase.
#[allow(nonstandard_style)]
#[derive(Serialize)]
pub struct DenyListPayload {
    pub issuedAt: i64,
    pub revokedJti: Vec<String>,
}

/// Canonical signing input — fixed field order shared with the client.
pub fn deny_list_signing_input(payload: &DenyListPayload) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "issuedAt": payload.issuedAt,
        "revokedJti": payload.revokedJti,
    }))
    .expect("deny-list canonical json")
}

pub fn build_and_sign(bridge: &Bridge) -> serde_json::Value {
    let revoked: Vec<String> = {
        let db = bridge.db.lock().expect("db lock");
        let mut stmt = db
            .prepare("SELECT jti FROM revocations ORDER BY revoked_at, jti")
            .expect("deny-list query");
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .expect("deny-list rows");
        rows.filter_map(Result::ok).collect()
    };
    let payload = DenyListPayload {
        issuedAt: crypto::unix_now(),
        revokedJti: revoked,
    };
    use ed25519_dalek::Signer;
    let signature = bridge
        .signing
        .sign(&deny_list_signing_input(&payload));
    serde_json::json!({
        "payload": { "issuedAt": payload.issuedAt, "revokedJti": payload.revokedJti },
        "signature": crypto::b64url_encode(&signature.to_bytes()),
    })
}

pub async fn deny_list_handler(State(bridge): State<std::sync::Arc<Bridge>>) -> Json<serde_json::Value> {
    Json(build_and_sign(&bridge))
}
