// natally — bridge error taxonomy (§9.4). Every variant maps to exactly one
// honest HTTP status; route handlers return `Result<_, ApiError>` and never
// unwrap.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("webhook signature verification failed")]
    BadSignature,

    #[error("not found")]
    NotFound,

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("purchase could not be verified")]
    NotEntitled,

    #[error("verified event missing required fields (appUserId / invoiceId)")]
    UnprocessableEvent,

    #[error("upstream verification failed: {0}")]
    Upstream(String),

    #[error("processor rail not configured (secret absent in .env)")]
    RailNotConfigured,

    #[error("ledger error: {0}")]
    Ledger(#[from] rusqlite::Error),

    #[error("internal error: {0}")]
    Internal(String),

    #[error("configuration error: {0}")]
    Config(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code): (StatusCode, &str) = match &self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad-request"),
            ApiError::BadSignature => (StatusCode::UNAUTHORIZED, "bad-signature"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not-found"),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            ApiError::NotEntitled => (StatusCode::FORBIDDEN, "purchase-not-verified"),
            ApiError::UnprocessableEvent => (StatusCode::UNPROCESSABLE_ENTITY, "unprocessable-event"),
            ApiError::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream-failed"),
            ApiError::RailNotConfigured => (StatusCode::SERVICE_UNAVAILABLE, "rail-not-configured"),
            ApiError::Ledger(_) | ApiError::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
            ApiError::Config(_) => (StatusCode::INTERNAL_SERVER_ERROR, "config"),
        };
        (status, Json(json!({ "error": code }))).into_response()
    }
}
