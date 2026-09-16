// natally — `POST /verify {appUserId}` (§9.4): the most recent LicenseToken
// for the app user (null when no verified purchase exists) plus the current
// signed deny-list envelope, in one response.

use crate::error::ApiError;
use crate::state::{lock_db, SharedState};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub app_user_id: String,
}

pub async fn verify(
    State(state): State<SharedState>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.app_user_id.trim().is_empty() {
        return Err(ApiError::BadRequest("appUserId must be non-empty".to_string()));
    }
    let now_ms = (state.config.now)();
    let (token, revoked) = {
        let conn = lock_db(&state)?;
        (
            crate::ledger::latest_token_for_sub(&conn, &request.app_user_id)?,
            crate::ledger::revoked_jtis(&conn)?,
        )
    };
    let denylist = crate::mint::sign_denylist_envelope(&state.signer, now_ms, &revoked);
    Ok(Json(json!({
        "token": token,
        "denylist": denylist,
    })))
}
