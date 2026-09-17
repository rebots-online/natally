//! Shared bridge state.

use crate::config::Config;
use ed25519_dalek::SigningKey;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct Bridge {
    pub cfg: Config,
    pub db: Mutex<Connection>,
    pub signing: SigningKey,
}

impl Bridge {
    pub fn new(cfg: Config, db: Mutex<Connection>) -> Bridge {
        let signing = SigningKey::from_bytes(&cfg.signing_seed);
        Bridge { cfg, db, signing }
    }

    /// Ed25519 public key, base64 (std) — the value mirrored to `VITE_LICENSE_PUBKEY`.
    pub fn public_key_b64(&self) -> String {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        STANDARD.encode(self.signing.verifying_key().as_bytes())
    }

    pub fn secret_for(&self, processor: &str) -> Option<&str> {
        self.cfg.processor_secrets.get(processor).map(|s| s.as_str())
    }
}
