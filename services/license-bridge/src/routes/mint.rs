// natally — `POST /mint {appUserId, purchaseRef}` (§9.4, the RC adapter path).
//
// The purchase is verified FIRST through the injected `RcVerifier` (prod:
// reqwest REST v2 client behind `--features http-rc`; tests: an in-memory
// impl — no network). A verified purchase is then recorded in the ledger
// under PK `('revenuecat', purchaseRef)`, so repeated mint calls for the same
// purchaseRef are idempotent and return the original token.

use crate::error::ApiError;
use crate::state::{lock_db, SharedState};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MintRequest {
    pub app_user_id: String,
    pub purchase_ref: String,
}

pub async fn mint(
    State(state): State<SharedState>,
    Json(request): Json<MintRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.app_user_id.trim().is_empty() || request.purchase_ref.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "appUserId and purchaseRef must be non-empty".to_string(),
        ));
    }
    let entitled = state
        .rc
        .verify_purchase(&request.app_user_id, &request.purchase_ref)
        .await?;
    if !entitled {
        return Err(ApiError::NotEntitled);
    }

    let now_ms = (state.config.now)();
    let iat = now_ms / 1000;
    let jti = crate::codes::random_jti();
    let token = crate::mint::mint_license_token(&state.signer, &request.app_user_id, iat, &jti);

    let mut conn = lock_db(&state)?;
    let outcome = crate::ledger::record_purchase_and_issuance(
        &mut conn,
        "revenuecat",
        &request.purchase_ref,
        &request.app_user_id,
        &jti,
        &token,
        iat,
        "rc-adapter",
        now_ms,
    )?;
    match outcome {
        crate::ledger::PurchaseOutcome::Recorded => Ok(Json(json!({
            "status": "minted",
            "token": token,
        }))),
        crate::ledger::PurchaseOutcome::Duplicate { jti } => {
            let token = crate::ledger::token_by_jti(&conn, &jti)?
                .ok_or_else(|| ApiError::Internal("recorded event has no issuance".to_string()))?;
            Ok(Json(json!({
                "status": "existing",
                "token": token,
            })))
        }
    }
}
