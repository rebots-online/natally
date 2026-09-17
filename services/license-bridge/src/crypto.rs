//! Crypto + encoding helpers shared by token minting, verification and the deny-list.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub fn b64_decode_std(value: &str) -> Vec<u8> {
    STANDARD.decode(value).expect("bridge: invalid base64")
}

pub fn b64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn b64url_decode(value: &str) -> Option<Vec<u8>> {
    if value.chars().any(|c| c == '+' || c == '/' || c == '=') {
        return None;
    }
    URL_SAFE_NO_PAD.decode(value).ok()
}


/// HMAC-SHA256 over `body` with `secret`, lowercase hex.
pub fn hmac_sha256_hex(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time comparison of two hex signatures.
pub fn signatures_equal(a: &str, b: &str) -> bool {
    use subtle::ConstantTimeEq;
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

pub fn random_bytes(n: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

pub fn random_hex(n_bytes: usize) -> String {
    hex::encode(random_bytes(n_bytes))
}

pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_secs() as i64
}
