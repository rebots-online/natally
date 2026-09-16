// natally — `GET /denylist` (§9.3): the signed, dated deny-list envelope
// `{issuedAt, revokedJti, sig}`. `sig` is the Ed25519 signature (standard
// base64) over utf8(canonicalJson({issuedAt, revokedJti})) — the exact payload
// the client verifies against the build-baked public key. Revocations enter
// via the ledger's `revocations` table (see README: the operator write path).

use crate::error::ApiError;
use crate::state::{lock_db, SharedState};
use axum::extract::State;
use axum::Json;
use serde_json::Value;

pub async fn denylist(State(state): State<SharedState>) -> Result<Json<Value>, ApiError> {
    let now_ms = (state.config.now)();
    let revoked = {
        let conn = lock_db(&state)?;
        crate::ledger::revoked_jtis(&conn)?
    };
    Ok(Json(crate::mint::sign_denylist_envelope(
        &state.signer, now_ms, &revoked,
    )))
}
