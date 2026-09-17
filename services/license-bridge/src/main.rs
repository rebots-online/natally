//! natally license bridge — §9.3/§9.4 of DOCS/ARCHITECTURE.md.
//!
//! Operator-hosted Rust/axum service. HTTP surface is exactly:
//! - `POST /webhook/{stripe|revenuecat|polar|lemonsqueezy|paypal|square}` — HMAC-verified,
//!   idempotent (SQLite ledger keyed `(processor, invoiceId)`; a replayed delivery returns
//!   the first outcome, never re-mints).
//! - `POST /redeem` — single-use codes, B.4's four outcome codes, replay-safe.
//! - `POST /verify` — Ed25519 token check + deny-list membership, with reason codes.
//! - `GET /deny-list` — the current signed (Ed25519) deny-list.
//!
//! No processor secret and no signing key ever appears in a response body.

mod codes;
mod config;
mod crypto;
mod db;
mod denylist;
mod state;
mod token;
mod webhooks;

#[cfg(test)]
mod tests;

use axum::routing::{get, post};
use axum::Router;
use std::sync::Mutex;

pub use state::Bridge;

pub fn router(bridge: Bridge) -> Router {
    let shared = std::sync::Arc::new(bridge);
    Router::new()
        .route("/webhook/:processor", post(webhooks::webhook_handler))
        .route("/redeem", post(codes::redeem_handler))
        .route("/verify", post(token::verify_handler))
        .route("/deny-list", get(denylist::deny_list_handler))
        .with_state(shared)
}

#[tokio::main]
async fn main() {
    let cfg = config::Config::from_env();
    let db = db::open(&cfg.db_path);
    let bridge = Bridge::new(cfg, Mutex::new(db));
    let addr = bridge.cfg.bind_addr.clone();
    let app = router(bridge);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("bridge: cannot bind {addr}: {e}"));
    println!("license-bridge listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("bridge: server error");
}
