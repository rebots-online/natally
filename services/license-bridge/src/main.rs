// natally — license bridge binary (§9.4). Thin bootstrap: env config, ed25519
// signing key, SQLite ledger, router, serve. All behavior lives in the lib.

use license_bridge::routes;
use license_bridge::state::{AppState, Config, RcVerifier};
use std::sync::Arc;

fn main() {
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    runtime.block_on(async_main());
}

async fn async_main() {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(message) => {
            eprintln!("license-bridge: {message}");
            std::process::exit(1);
        }
    };

    let key_encoded = std::env::var("LICENSE_ED25519_PRIVATE_KEY").unwrap_or_default();
    let signer = match license_bridge::mint::parse_license_key(&key_encoded) {
        Ok(signer) => signer,
        Err(message) => {
            eprintln!("license-bridge: {message}");
            std::process::exit(1);
        }
    };

    let ledger_path = std::env::var("LEDGER_PATH").unwrap_or_default();
    if ledger_path.trim().is_empty() {
        eprintln!("license-bridge: LEDGER_PATH is required (SQLite ledger file)");
        std::process::exit(1);
    }
    let db = match rusqlite::Connection::open(&ledger_path) {
        Ok(db) => db,
        Err(error) => {
            eprintln!("license-bridge: cannot open LEDGER_PATH {ledger_path}: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = license_bridge::ledger::init(&db) {
        eprintln!("license-bridge: ledger init failed: {error}");
        std::process::exit(1);
    }

    // The injected RevenueCat verifier (§9.4): prod reqwest REST v2 client
    // behind --features http-rc; otherwise the honest disabled stub.
    #[cfg(feature = "http-rc")]
    let rc: Arc<dyn RcVerifier> = match license_bridge::rc_http::HttpRcVerifier::from_env() {
        Ok(verifier) => Arc::new(verifier),
        Err(message) => {
            eprintln!("license-bridge: {message}");
            std::process::exit(1);
        }
    };
    #[cfg(not(feature = "http-rc"))]
    let rc: Arc<dyn RcVerifier> = Arc::new(license_bridge::state::DisabledRcVerifier);

    let bind = std::env::var("PORT").unwrap_or_else(|_| "8088".to_string());
    let address = format!("127.0.0.1:{bind}");

    let state = Arc::new(AppState::new(db, signer, config, rc));
    let app = routes::build_router(state);

    let listener = match tokio::net::TcpListener::bind(&address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("license-bridge: cannot bind {address}: {error}");
            std::process::exit(1);
        }
    };
    println!("license-bridge: listening on http://{address}");
    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("license-bridge: server error: {error}");
        std::process::exit(1);
    }
}
