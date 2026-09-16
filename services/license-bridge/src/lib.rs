// natally — license bridge (ARCHITECTURE §9.3–§9.5, TR-3 B.6).
//
// Library root. The binary (`main.rs`) is a thin bootstrap over these modules;
// integration tests (`tests/bridge.rs`) drive `routes::build_router` through
// `tower::ServiceExt::oneshot` with an injected `RcVerifier` — no network.

pub mod codes;
pub mod error;
pub mod ledger;
pub mod mint;
pub mod routes;
pub mod state;

#[cfg(feature = "http-rc")]
pub mod rc_http;
