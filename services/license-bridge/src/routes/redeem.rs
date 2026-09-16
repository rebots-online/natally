// natally — `POST /redeem {code, appUserId?}` (§9.4, §9.5): single-use
// registry keyed by SHA-256 of the canonical code string; reuse is a 409; the
// first redemption mints a LicenseToken.
//
// The optional `appUserId` binds the token to the redeemer's app user id
// (the desktop `enter-license-key` path). When absent, the token carries the
// honest registry-scoped sub `code:<hash16>` (the TS LicensePayload schema
// only requires a non-empty sub) — documented in the README.

use crate::error::ApiError;
use crate::state::{lock_db, SharedState};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemRequest {
    pub code: String,
    pub app_user_id: Option<String>,
}

pub async fn redeem(
    State(state): State<SharedState>,
    Json(request): Json<RedeemRequest>,
) -> Result<Json<Value>, ApiError> {
    let canonical = crate::codes::normalize_code(&request.code)
        .ok_or_else(|| ApiError::BadRequest("invalid code (charset/shape/prefix)".to_string()))?;
    let code_hash = crate::codes::code_hash_hex(&canonical);

    // Honest 409 with the original jti when already consumed.
    {
        let conn = lock_db(&state)?;
        if let Some(jti) = crate::ledger::code_consumed_jti(&conn, &code_hash)? {
            return Err(ApiError::Conflict(format!("code already redeemed (jti {jti})")));
        }
    }

    let now_ms = (state.config.now)();
    let iat = now_ms / 1000;
    let jti = crate::codes::random_jti();
    let sub = request
        .app_user_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("code:{}", &code_hash[..16]));
    let token = crate::mint::mint_license_token(&state.signer, &sub, iat, &jti);

    let mut conn = lock_db(&state)?;
    let fresh = crate::ledger::redeem_code(
        &mut conn, &code_hash, &sub, &jti, &token, iat, now_ms,
    )?;
    if !fresh {
        return Err(ApiError::Conflict("code already redeemed".to_string()));
    }
    Ok(Json(json!({ "token": token })))
}
