// natally — router assembly (§9.4). Routes are mounted at the service root;
// an operator-facing `{prefix}` (e.g. `/bridge`) is a reverse-proxy concern.

pub mod denylist;
pub mod healthz;
pub mod mint;
pub mod redeem;
pub mod verify;
pub mod webhooks;

use crate::state::SharedState;
use axum::routing::{get, post};
use axum::Router;

pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/webhook/{processor}", post(webhooks::webhook))
        .route("/verify", post(verify::verify))
        .route("/redeem", post(redeem::redeem))
        .route("/mint", post(mint::mint))
        .route("/denylist", get(denylist::denylist))
        .route("/healthz", get(healthz::healthz))
        .with_state(state)
}
