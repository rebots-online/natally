// natally — processor webhooks (§9.4): one route, six rails, six documented
// signature schemes. The exact header/secret mapping this module implements
// is the README's mapping table (single source of truth for the operator).
//
// Per the task notes, where a live processor scheme cannot be fully honored
// offline the HMAC core is implemented and the exact gap is documented in the
// README — no fake verification anywhere:
//
// - stripe:        Stripe-Signature `t=…,v1=…` hex HMAC-SHA256 over
//                  `{t}.{raw body}` + replay-tolerance window (docs scheme).
// - polar:         X-Polar-Signature hex HMAC-SHA256 of the raw body.
// - lemonsqueezy:  X-Signature hex HMAC-SHA256 of the raw body.
// - paypal:        documented message composition
//                  `algo|transmissionId|certUrl|transmissionTime|webhookId|crc32(body)`
//                  HMAC'd with PAYPAL_WEBHOOK_SECRET, base64 — GAP: live
//                  PayPal verifies SHA256withRSA against PayPal's cert (see
//                  README).
// - square:        x-square-hmacsha256-signature base64 HMAC-SHA256 over
//                  METHOD + path + raw body (note-prescribed; Square's live
//                  docs use notification_url + body — README documents the
//                  divergence).
// - revenuecat:    constant-time equality of the configured RC webhook auth
//                  secret presented in `Authorization: Bearer …` (RC's
//                  documented scheme) or `X-Signature` (task note).

use crate::error::ApiError;
use crate::state::{lock_db, Config, SharedState};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

/// The six §9.4 rails.
pub const PROCESSORS: [&str; 6] = [
    "stripe",
    "polar",
    "lemonsqueezy",
    "paypal",
    "square",
    "revenuecat",
];

/// HMAC-SHA256 — total: `new_from_slice` accepts every key length, so the
/// error case is statically impossible and mapped to an honest 500.
fn hmac_sha256(secret: &[u8], parts: &[&[u8]]) -> Result<Vec<u8>, ApiError> {
    let mut mac = HmacSha256::new_from_slice(secret)
        .map_err(|_| ApiError::Internal("HMAC key setup failed".to_string()))?;
    for part in parts {
        mac.update(part);
    }
    Ok(mac.finalize().into_bytes().to_vec())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Constant-time string equality (hex or base64 text).
fn ct_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiError::BadSignature)
}

/// CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) — the checksum PayPal's
/// documented webhook message includes.
fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

// ---------------------------------------------------------------------------
// Per-processor verification
// ---------------------------------------------------------------------------

fn verify_stripe(secret: &str, headers: &HeaderMap, body: &[u8], config: &Config) -> Result<(), ApiError> {
    let raw = header(headers, "stripe-signature")?;
    let mut timestamp: Option<u64> = None;
    let mut signatures: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let part = part.trim();
        if let Some((key, value)) = part.split_once('=') {
            match key {
                "t" => timestamp = value.parse().ok(),
                "v1" => signatures.push(value.to_lowercase()),
                _ => {}
            }
        }
    }
    let t = timestamp.ok_or(ApiError::BadSignature)?;
    if t.abs_diff((config.now)() / 1000) > config.stripe_tolerance_secs {
        return Err(ApiError::BadSignature); // replay window, per Stripe docs
    }
    let t_str = t.to_string();
    let expected = to_hex(&hmac_sha256(secret.as_bytes(), &[t_str.as_bytes(), b".", body])?);
    if signatures.iter().any(|sig| ct_eq(sig, &expected)) {
        return Ok(());
    }
    Err(ApiError::BadSignature)
}

fn verify_hex_hmac(secret: &str, headers: &HeaderMap, header_name: &str, body: &[u8]) -> Result<(), ApiError> {
    let provided = header(headers, header_name)?;
    let expected = to_hex(&hmac_sha256(secret.as_bytes(), &[body])?);
    if ct_eq(&provided.to_lowercase(), &expected) {
        Ok(())
    } else {
        Err(ApiError::BadSignature)
    }
}

fn verify_paypal(secret: &str, headers: &HeaderMap, body: &[u8]) -> Result<(), ApiError> {
    let algo = header(headers, "paypal-auth-algorithm")?;
    if !algo.eq_ignore_ascii_case("SHA256withRSA") {
        return Err(ApiError::BadSignature);
    }
    let transmission_id = header(headers, "paypal-transmission-id")?;
    let cert_url = header(headers, "paypal-cert-url")?;
    let transmission_time = header(headers, "paypal-transmission-time")?;
    let provided = header(headers, "paypal-transmission-sig")?;
    let message = format!(
        "{algo}|{transmission_id}|{cert_url}|{transmission_time}|{secret}|{}",
        crc32(body)
    );
    let expected = STANDARD.encode(hmac_sha256(secret.as_bytes(), &[message.as_bytes()])?);
    if ct_eq(provided, &expected) {
        Ok(())
    } else {
        Err(ApiError::BadSignature)
    }
}

fn verify_square(secret: &str, headers: &HeaderMap, path: &str, body: &[u8]) -> Result<(), ApiError> {
    let provided = header(headers, "x-square-hmacsha256-signature")?;
    let expected = STANDARD.encode(hmac_sha256(
        secret.as_bytes(),
        &[b"POST", path.as_bytes(), body],
    )?);
    if ct_eq(provided, &expected) {
        Ok(())
    } else {
        Err(ApiError::BadSignature)
    }
}

fn verify_revenuecat(secret: &str, headers: &HeaderMap) -> Result<(), ApiError> {
    // RC's documented webhook authorization: the request presents the
    // configured auth secret as `Authorization: Bearer <secret>`; the task
    // note additionally names `X-Signature`. Either carrier must equal the
    // secret (constant-time).
    if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(bearer) = auth.strip_prefix("Bearer ") {
            if ct_eq(bearer.trim(), secret) {
                return Ok(());
            }
        }
    }
    if let Some(sig) = headers.get("x-signature").and_then(|v| v.to_str().ok()) {
        if ct_eq(sig.trim(), secret) {
            return Ok(());
        }
    }
    Err(ApiError::BadSignature)
}

fn verify_signature(
    processor: &str,
    secret: &str,
    headers: &HeaderMap,
    path: &str,
    body: &[u8],
    config: &Config,
) -> Result<(), ApiError> {
    match processor {
        "stripe" => verify_stripe(secret, headers, body, config),
        "polar" => verify_hex_hmac(secret, headers, "x-polar-signature", body),
        "lemonsqueezy" => verify_hex_hmac(secret, headers, "x-signature", body),
        "paypal" => verify_paypal(secret, headers, body),
        "square" => verify_square(secret, headers, path, body),
        "revenuecat" => verify_revenuecat(secret, headers),
        _ => Err(ApiError::NotFound), // unreachable: gated by PROCESSORS
    }
}

fn rail_secret(state: &AppStateAlias, processor: &str) -> Result<String, ApiError> {
    let config = &state.config;
    let secret = match processor {
        "stripe" => &config.stripe_webhook_secret,
        "polar" => &config.polar_webhook_secret,
        "lemonsqueezy" => &config.lemonsqueezy_webhook_secret,
        "paypal" => &config.paypal_webhook_secret,
        "square" => &config.square_webhook_secret,
        "revenuecat" => &config.revenuecat_webhook_secret,
        _ => return Err(ApiError::NotFound),
    };
    secret.clone().ok_or(ApiError::RailNotConfigured)
}

type AppStateAlias = SharedState;

/// The event envelope the bridge reads out of a verified webhook body:
/// `appUserId` (or `metadata.appUserId`) and `invoiceId` / `invoice_id` / `id`.
/// Documented in the README so operators configure their processor payloads
/// accordingly.
fn extract_event(value: &Value) -> Option<(String, String)> {
    let app_user_id = value
        .get("appUserId")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/metadata/appUserId").and_then(Value::as_str))?
        .to_string();
    if app_user_id.is_empty() {
        return None;
    }
    let invoice_id = ["invoiceId", "invoice_id", "id"]
        .iter()
        .find_map(|key| value.get(*key))
        .and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })?;
    if invoice_id.is_empty() {
        return None;
    }
    Some((app_user_id, invoice_id))
}

/// `POST /webhook/{processor}` — verify that rail's signature, extract the
/// event, record it idempotently (PK `(processor, invoice_id)`), mint a
/// LicenseToken on first sight. Duplicate deliveries answer 200 with the
/// original jti and mint nothing.
pub async fn webhook(
    State(state): State<SharedState>,
    Path(processor): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let processor = processor.to_lowercase();
    if !PROCESSORS.contains(&processor.as_str()) {
        return Err(ApiError::NotFound);
    }
    let secret = rail_secret(&state, &processor)?;
    let path = format!("/webhook/{processor}");
    verify_signature(&processor, &secret, &headers, &path, &body, &state.config)?;

    let value: Value = serde_json::from_slice(&body)
        .map_err(|e| ApiError::BadRequest(format!("webhook body is not JSON: {e}")))?;
    let (app_user_id, invoice_id) =
        extract_event(&value).ok_or(ApiError::UnprocessableEvent)?;

    let now_ms = (state.config.now)();
    let iat = now_ms / 1000;
    let jti = crate::codes::random_jti();
    let token = crate::mint::mint_license_token(&state.signer, &app_user_id, iat, &jti);

    let mut conn = lock_db(&state)?;
    let outcome = crate::ledger::record_purchase_and_issuance(
        &mut conn,
        &processor,
        &invoice_id,
        &app_user_id,
        &jti,
        &token,
        iat,
        &format!("webhook:{processor}"),
        now_ms,
    )?;
    match outcome {
        crate::ledger::PurchaseOutcome::Recorded => Ok(Json(json!({
            "status": "recorded",
            "jti": jti,
        }))),
        crate::ledger::PurchaseOutcome::Duplicate { jti } => Ok(Json(json!({
            "status": "duplicate",
            "jti": jti,
        }))),
    }
}
