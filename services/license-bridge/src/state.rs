// natally — bridge state: configuration, injected clock, and the injected
// RevenueCat purchase verifier (§9.4 `POST /mint`).
//
// The RC verifier is a trait so that tests run with zero network surface
// (house rule): `TestRcVerifier` in tests/, `state::DisabledRcVerifier` (this
// module) when built without the `http-rc` feature, and the real reqwest REST
// v2 client (`rc_http::HttpRcVerifier`) behind `--features http-rc`.

use crate::error::ApiError;
use ed25519_dalek::SigningKey;
use std::sync::{Arc, Mutex};

/// Injected wall clock in epoch milliseconds (tests pin this; prod uses the
/// system clock).
pub type NowFn = Arc<dyn Fn() -> u64 + Send + Sync>;

pub fn system_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Bridge configuration; every secret is `Option` — an absent secret means
/// that rail answers 503 `rail-not-configured` (honest absence, §9.4
/// "blank ⇒ rail hidden").
pub struct Config {
    pub stripe_webhook_secret: Option<String>,
    pub polar_webhook_secret: Option<String>,
    pub lemonsqueezy_webhook_secret: Option<String>,
    pub paypal_webhook_secret: Option<String>,
    pub square_webhook_secret: Option<String>,
    pub revenuecat_webhook_secret: Option<String>,
    pub rc_secret_key: Option<String>,
    pub rc_api_key: Option<String>,
    /// Stripe replay-tolerance window in seconds (docs default 300).
    pub stripe_tolerance_secs: u64,
    pub now: NowFn,
}

impl Config {
    /// Read the documented env names (see README's mapping table). Does not
    /// fail on absent processor secrets (rail hidden); only structural
    /// problems are errors.
    pub fn from_env() -> Result<Self, String> {
        Ok(Config {
            stripe_webhook_secret: env_opt("STRIPE_WEBHOOK_SECRET"),
            polar_webhook_secret: env_opt("POLAR_WEBHOOK_SECRET"),
            lemonsqueezy_webhook_secret: env_opt("LEMONSQUEEZY_WEBHOOK_SECRET"),
            paypal_webhook_secret: env_opt("PAYPAL_WEBHOOK_SECRET"),
            square_webhook_secret: env_opt("SQUARE_WEBHOOK_SECRET"),
            revenuecat_webhook_secret: env_opt("REVENUECAT_WEBHOOK_SECRET"),
            rc_secret_key: env_opt("RC_SECRET_KEY"),
            rc_api_key: env_opt("RC_API_KEY"),
            stripe_tolerance_secs: env_opt("STRIPE_TOLERANCE_SECS")
                .and_then(|v| v.parse().ok())
                .unwrap_or(300),
            now: Arc::new(system_now_ms),
        })
    }
}

fn env_opt(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Verifies a RevenueCat purchase before `POST /mint` issues a token.
#[async_trait::async_trait]
pub trait RcVerifier: Send + Sync + 'static {
    /// Ok(true) = the purchase is real and entitled for this app user.
    async fn verify_purchase(
        &self,
        app_user_id: &str,
        purchase_ref: &str,
    ) -> Result<bool, ApiError>;
}

/// Used when the service is built without `--features http-rc`: /mint answers
/// 502 with the honest reason instead of pretending to verify.
pub struct DisabledRcVerifier;

#[async_trait::async_trait]
impl RcVerifier for DisabledRcVerifier {
    async fn verify_purchase(
        &self,
        _app_user_id: &str,
        _purchase_ref: &str,
    ) -> Result<bool, ApiError> {
        Err(ApiError::Upstream(
            "RevenueCat REST v2 verification disabled: build with --features http-rc"
                .to_string(),
        ))
    }
}

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub signer: SigningKey,
    pub config: Config,
    pub rc: Arc<dyn RcVerifier>,
}

impl AppState {
    pub fn new(
        db: rusqlite::Connection,
        signer: SigningKey,
        config: Config,
        rc: Arc<dyn RcVerifier>,
    ) -> Self {
        AppState {
            db: Mutex::new(db),
            signer,
            config,
            rc,
        }
    }
}

pub type SharedState = Arc<AppState>;

/// Lock the ledger without unwrapping (a poisoned mutex is an honest 500).
pub fn lock_db(state: &AppState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, ApiError> {
    state
        .db
        .lock()
        .map_err(|_| ApiError::Internal("ledger mutex poisoned".to_string()))
}
