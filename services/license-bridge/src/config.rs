//! Bridge configuration — read from the operator's own `.env` (never committed; see
//! `.env.example`). Blank/missing processor secret ⇒ that rail is hidden (§9.4).

use std::collections::HashMap;

pub const PROCESSORS: [&str; 6] = [
    "stripe",
    "revenuecat",
    "polar",
    "lemonsqueezy",
    "paypal",
    "square",
];

#[derive(Clone)]
pub struct Config {
    pub bind_addr: String,
    pub db_path: String,
    /// Ed25519 seed (32 bytes) for license tokens and the deny-list, base64 (std) encoded
    /// in `LICENSE_ED25519_PRIVATE_KEY`.
    pub signing_seed: [u8; 32],
    /// Per-processor webhook HMAC secrets; absent ⇒ rail hidden (404).
    pub processor_secrets: HashMap<String, String>,
}

impl Config {
    fn env(key: &str) -> Option<String> {
        let value = std::env::var(key).ok()?;
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    fn required(key: &str) -> String {
        Self::env(key).unwrap_or_else(|| panic!("bridge: missing required env var {key}"))
    }

    pub fn from_env() -> Config {
        let bind_addr =
            Self::env("BRIDGE_BIND_ADDR").unwrap_or_else(|| "127.0.0.1:47231".to_string());
        let db_path = Self::env("BRIDGE_DB_PATH").unwrap_or_else(|| "bridge.sqlite3".to_string());
        let seed_b64 = Self::required("LICENSE_ED25519_PRIVATE_KEY");
        let seed = crate::crypto::b64_decode_std(&seed_b64);
        let signing_seed: [u8; 32] = seed
            .try_into()
            .unwrap_or_else(|v: Vec<u8>| panic!("bridge: LICENSE_ED25519_PRIVATE_KEY must be 32 bytes, got {}", v.len()));
        let mut processor_secrets = HashMap::new();
        for processor in PROCESSORS {
            let key = format!(
                "{}_WEBHOOK_SECRET",
                processor.to_uppercase().replace('-', "_")
            );
            if let Some(secret) = Self::env(&key) {
                processor_secrets.insert(processor.to_string(), secret);
            }
        }
        Config {
            bind_addr,
            db_path,
            signing_seed,
            processor_secrets,
        }
    }
}
