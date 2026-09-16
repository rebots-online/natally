// natally — bridge acceptance tests (TEST_RUBRIC TR-3, B.6).
//
// Accept line (CHECKLIST B.6):
//   "bridge: 6 webhook fixtures verified idempotently; mint→verify; redeem reuse rejected"
//
// Zero network: the RcVerifier is injected, SQLite is in-memory, axum is
// driven through tower::ServiceExt::oneshot, the clock is the system one but
// fixtures are computed against it (Stripe tolerance 300 s).
//
// Test names carry the `bridge__` prefix so the Accept clauses are readable
// straight from the runner output.
#![allow(non_snake_case)]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use http_body_util::BodyExt;
use license_bridge::codes;
use license_bridge::ledger;
use license_bridge::mint;
use license_bridge::routes;
use license_bridge::state::{lock_db, AppState, Config, RcVerifier};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ACCEPT_LINE: &str =
    "bridge: 6 webhook fixtures verified idempotently; mint→verify; redeem reuse rejected";

struct TestRcVerifier {
    entitled: bool,
}

#[async_trait::async_trait]
impl RcVerifier for TestRcVerifier {
    async fn verify_purchase(
        &self,
        _app_user_id: &str,
        _purchase_ref: &str,
    ) -> Result<bool, license_bridge::error::ApiError> {
        Ok(self.entitled)
    }
}

/// Fixed deterministic seed — tokens are reproducible in tests.
fn test_signer() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[42u8; 32])
}

fn test_config() -> Config {
    Config {
        stripe_webhook_secret: Some("whsec_stripe_test".to_string()),
        polar_webhook_secret: Some("whsec_polar_test".to_string()),
        lemonsqueezy_webhook_secret: Some("whsec_ls_test".to_string()),
        paypal_webhook_secret: Some("paypal_webhook_id_test".to_string()),
        square_webhook_secret: Some("sq_signature_key_test".to_string()),
        revenuecat_webhook_secret: Some("rc_webhook_secret_test".to_string()),
        rc_secret_key: Some("rc_secret_key_test".to_string()),
        rc_api_key: Some("rc_api_key_test".to_string()),
        stripe_tolerance_secs: 300,
        now: Arc::new(license_bridge::state::system_now_ms),
    }
}

fn test_state(entitled: bool) -> Arc<AppState> {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    ledger::init(&db).unwrap();
    Arc::new(AppState::new(
        db,
        test_signer(),
        test_config(),
        Arc::new(TestRcVerifier { entitled }),
    ))
}

fn now_secs() -> u64 {
    license_bridge::state::system_now_ms() / 1000
}

fn hmac_sha256(secret: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().to_vec()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

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

/// The exact signature headers each processor scheme produces (the same math
/// as src/routes/webhooks.rs documents in the README mapping table).
fn fixture_headers(processor: &str, secret: &str, body: &str) -> Vec<(String, String)> {
    match processor {
        "stripe" => {
            let t = now_secs();
            let signature = to_hex(&hmac_sha256(
                secret.as_bytes(),
                &[t.to_string().as_bytes(), b".", body.as_bytes()],
            ));
            vec![("stripe-signature".to_string(), format!("t={t},v1={signature}"))]
        }
        "polar" => vec![(
            "x-polar-signature".to_string(),
            to_hex(&hmac_sha256(secret.as_bytes(), &[body.as_bytes()])),
        )],
        "lemonsqueezy" => vec![(
            "x-signature".to_string(),
            to_hex(&hmac_sha256(secret.as_bytes(), &[body.as_bytes()])),
        )],
        "paypal" => {
            let t = "2026-09-16T00:00:00Z";
            let message = format!(
                "SHA256withRSA|txid-{processor}|https://certs.paypal.com/test.pem|{t}|{secret}|{}",
                crc32(body.as_bytes())
            );
            vec![
                ("paypal-auth-algorithm".to_string(), "SHA256withRSA".to_string()),
                ("paypal-transmission-id".to_string(), format!("txid-{processor}")),
                ("paypal-cert-url".to_string(), "https://certs.paypal.com/test.pem".to_string()),
                ("paypal-transmission-time".to_string(), t.to_string()),
                (
                    "paypal-transmission-sig".to_string(),
                    STANDARD.encode(hmac_sha256(secret.as_bytes(), &[message.as_bytes()])),
                ),
            ]
        }
        "square" => {
            let message: Vec<u8> = [b"POST", "/webhook/square".as_bytes(), body.as_bytes()].concat();
            vec![(
                "x-square-hmacsha256-signature".to_string(),
                STANDARD.encode(hmac_sha256(secret.as_bytes(), &[&message])),
            )]
        }
        "revenuecat" => vec![("x-signature".to_string(), secret.to_string())],
        other => panic!("unknown fixture processor {other}"),
    }
}

fn request(method: &str, uri: &str, headers: &[(String, String)], body: String) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    builder.body(Body::from(body)).unwrap()
}

async fn send(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

async fn post_json(
    app: &axum::Router,
    uri: &str,
    body: Value,
) -> (StatusCode, Value) {
    let headers = vec![("content-type".to_string(), "application/json".to_string())];
    send(
        app,
        request("POST", uri, &headers, serde_json::to_string(&body).unwrap()),
    )
    .await
}

fn webhook_body(processor: &str) -> String {
    format!(r#"{{"appUserId":"user-{processor}","invoiceId":"inv-{processor}-1"}}"#)
}

fn token_jti(token: &str) -> String {
    let parts: Vec<&str> = token.split('.').collect();
    let payload = mint::b64url_decode(parts[1]).unwrap();
    let value: Value = serde_json::from_slice(&payload).unwrap();
    value["jti"].as_str().unwrap().to_string()
}

// ---------------------------------------------------------------------------
// Accept clause 1: 6 webhook fixtures verified idempotently
// ---------------------------------------------------------------------------

/// TR-3/B.6: "6 webhook fixtures: valid HMAC accepted, bad signature 401,
/// double delivery is idempotent (ledger PK (processor, invoice_id))".
#[tokio::test]
async fn bridge__6_webhook_fixtures_verified_idempotently() {
    println!("Accept: {ACCEPT_LINE}");
    let state = test_state(true);
    let app = routes::build_router(state.clone());

    const FIXTURES: [&str; 6] = [
        "stripe",
        "polar",
        "lemonsqueezy",
        "paypal",
        "square",
        "revenuecat",
    ];
    let secrets: [(&str, &str); 6] = [
        ("stripe", "whsec_stripe_test"),
        ("polar", "whsec_polar_test"),
        ("lemonsqueezy", "whsec_ls_test"),
        ("paypal", "paypal_webhook_id_test"),
        ("square", "sq_signature_key_test"),
        ("revenuecat", "rc_webhook_secret_test"),
    ];

    for processor in FIXTURES {
        let secret = secrets.iter().find(|(p, _)| *p == processor).unwrap().1;
        let body = webhook_body(processor);
        let headers = fixture_headers(processor, secret, &body);
        let path = format!("/webhook/{processor}");

        // 1. valid signature ⇒ 200 recorded
        let (status, value) = send(&app, request("POST", &path, &headers, body.clone())).await;
        assert_eq!(status, StatusCode::OK, "{processor}: valid HMAC must be accepted");
        assert_eq!(value["status"], "recorded", "{processor}: {value}");
        let jti_first = value["jti"].as_str().unwrap().to_string();

        // 2. the token is retrievable via POST /verify
        let (status, verified) = post_json(&app, "/verify", json!({"appUserId": format!("user-{processor}")})).await;
        assert_eq!(status, StatusCode::OK);
        let token_1 = verified["token"].as_str().unwrap().to_string();
        assert!(!token_1.is_empty(), "{processor}: /verify must return the token");
        assert_eq!(token_jti(&token_1), jti_first, "{processor}: /verify token is the webhook's issuance");

        // 3. double delivery ⇒ 200 duplicate, same jti, ONE issuance (token unchanged)
        let (status, value_again) = send(&app, request("POST", &path, &headers, body.clone())).await;
        assert_eq!(status, StatusCode::OK, "{processor}: duplicate delivery stays 200");
        assert_eq!(value_again["status"], "duplicate", "{processor}: {value_again}");
        assert_eq!(value_again["jti"], Value::String(jti_first.clone()), "{processor}: duplicate reports the original jti");
        let (_, verified_again) = post_json(&app, "/verify", json!({"appUserId": format!("user-{processor}")})).await;
        assert_eq!(verified_again["token"], Value::String(token_1.clone()), "{processor}: double delivery minted nothing new");

        // 4. tampered body (headers signed over the original) ⇒ 401.
        //    Exception: revenuecat's documented scheme is sender
        //    authentication (secret equality) — it does NOT sign the body, so
        //    a tampered body under a valid secret is honestly accepted
        //    (documented in the README; transport security is HTTPS's job).
        let tampered = format!(r#"{{"appUserId":"attacker-{processor}","invoiceId":"inv-{processor}-1"}}"#);
        let (status, _) = send(&app, request("POST", &path, &headers, tampered.clone())).await;
        if processor == "revenuecat" {
            assert_eq!(status, StatusCode::OK, "{processor}: body-unsigned scheme accepts (sender-auth only)");
        } else {
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{processor}: tampered body must 401");
        }

        // 5. wrong secret (freshly signed with a foreign key) ⇒ 401
        let wrong_headers = fixture_headers(processor, "whsec_wrong_secret_for_test", &body);
        let (status, _) = send(&app, request("POST", &path, &wrong_headers, body.clone())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{processor}: wrong secret must 401");
    }

    // Each processor recorded exactly one event for its user: 6 events, and a
    // redelivery of ALL six still answers duplicate.
    for processor in FIXTURES {
        let body = webhook_body(processor);
        let secret = secrets.iter().find(|(p, _)| *p == processor).unwrap().1;
        let headers = fixture_headers(processor, secret, &body);
        let (status, value) = send(&app, request("POST", &format!("/webhook/{processor}"), &headers, body)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["status"], "duplicate", "{processor}: still idempotent");
    }
    let conn = lock_db(&state).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM purchase_events", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 6, "six processors ⇒ exactly six ledger rows");
    let issuances: i64 = conn.query_row("SELECT COUNT(*) FROM issuances", [], |r| r.get(0)).unwrap();
    assert_eq!(issuances, 6, "double delivery ⇒ one issuance per event");
}

/// RevenueCat's documented `Authorization: Bearer <secret>` carrier must also
/// verify (the fixture uses the `X-Signature` carrier).
#[tokio::test]
async fn bridge__revenuecat_bearer_authorization_carrier_accepted() {
    let state = test_state(true);
    let app = routes::build_router(state);
    let body = r#"{"appUserId":"user-rc-bearer","invoiceId":"inv-rc-bearer-1"}"#;
    let headers = vec![(
        "authorization".to_string(),
        "Bearer rc_webhook_secret_test".to_string(),
    )];
    let (status, value) = send(&app, request("POST", "/webhook/revenuecat", &headers, body.to_string())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value["status"], "recorded");
    let (status, _) = send(&app, request("POST", "/webhook/revenuecat", &headers, body.to_string())).await;
    assert_eq!(status, StatusCode::OK, "idempotent on the bearer carrier too");
}

/// A rail whose secret is absent from .env answers 503 (honest absence).
#[tokio::test]
async fn bridge__unconfigured_rail_answers_503() {
    let mut config = test_config();
    config.stripe_webhook_secret = None;
    let db = rusqlite::Connection::open_in_memory().unwrap();
    ledger::init(&db).unwrap();
    let state = Arc::new(AppState::new(db, test_signer(), config, Arc::new(TestRcVerifier { entitled: true })));
    let app = routes::build_router(state);
    let body = webhook_body("stripe");
    let headers = fixture_headers("stripe", "whsec_stripe_test", &body);
    let (status, value) = send(&app, request("POST", "/webhook/stripe", &headers, body)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(value["error"], "rail-not-configured");
}

// ---------------------------------------------------------------------------
// Accept clause 2: mint→verify (TS-format parity roundtrip)
// ---------------------------------------------------------------------------

/// TR-3/B.6: "mint→verify roundtrip" — decode the token with the SAME
/// canonical format (header/payload base64url pieces roundtrip, canonical
/// bytes identical, Ed25519 verifies over the transmitted prefix).
#[tokio::test]
async fn bridge__mint_verify_roundtrip_ts_format_parity() {
    println!("Accept: {ACCEPT_LINE}");
    let state = test_state(true);
    let app = routes::build_router(state.clone());
    let verifying_key = VerifyingKey::from(&state.signer);

    // 1. /mint (RC adapter path, injected verifier says entitled)
    let (status, minted) = post_json(
        &app,
        "/mint",
        json!({"appUserId": "user-roundtrip", "purchaseRef": "rc-purchase-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{minted}");
    assert_eq!(minted["status"], "minted");
    let token = minted["token"].as_str().unwrap().to_string();

    // 2. /verify returns the same token
    let (status, verified) = post_json(&app, "/verify", json!({"appUserId": "user-roundtrip"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(verified["token"], Value::String(token.clone()), "/verify returns the minted token");

    // 3. three segments, base64url pieces roundtrip
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(parts.len(), 3);
    for segment in &parts {
        let decoded = mint::b64url_decode(segment).unwrap();
        assert_eq!(mint::b64url_encode(&decoded), *segment, "base64url piece roundtrips");
    }

    // 4. header is byte-exact with the TS canonical header
    let header_bytes = mint::b64url_decode(parts[0]).unwrap();
    assert_eq!(header_bytes, mint::CANONICAL_HEADER_JSON.as_bytes());
    assert_eq!(
        parts[0],
        mint::b64url_encode(mint::CANONICAL_HEADER_JSON.as_bytes())
    );

    // 5. payload is the canonical byte string (rebuild from parsed fields)
    let payload_bytes = mint::b64url_decode(parts[1]).unwrap();
    let payload: Value = serde_json::from_slice(&payload_bytes).unwrap();
    assert_eq!(payload["tier"], "unlimited");
    assert_eq!(payload["exp"], Value::Null);
    assert_eq!(payload["iss"], "natally-license-bridge");
    assert_eq!(payload["sub"], "user-roundtrip");
    let iat = payload["iat"].as_u64().unwrap();
    let jti = payload["jti"].as_str().unwrap();
    assert_eq!(
        payload_bytes,
        mint::canonical_license_payload("user-roundtrip", iat, jti).as_bytes(),
        "payload re-serializes to the exact transmitted bytes (canonicalJson parity)"
    );

    // 6. deterministic: re-minting with the same (sub, iat, jti) is byte-identical
    assert_eq!(
        mint::mint_license_token(&state.signer, "user-roundtrip", iat, jti),
        token,
        "mint is deterministic (same payload ⇒ identical signature input)"
    );

    // 7. Ed25519 verifies over the transmitted header.payload bytes verbatim
    mint::verify_token_signature(&verifying_key, &token)
        .unwrap_or_else(|e| panic!("signature must verify: {e}"));
    let signature_bytes = mint::b64url_decode(parts[2]).unwrap();
    assert_eq!(signature_bytes.len(), 64);
    // and a tampered token does NOT verify
    let tampered = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
    let flipped = flip_signature_byte(&token);
    assert_ne!(flipped, tampered);
    assert!(mint::verify_token_signature(&verifying_key, &flipped).is_err());

    // 8. /mint idempotency: same purchaseRef ⇒ existing token, not a second mint
    let (status, again) = post_json(
        &app,
        "/mint",
        json!({"appUserId": "user-roundtrip", "purchaseRef": "rc-purchase-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["status"], "existing");
    assert_eq!(again["token"], Value::String(token), "repeat mint returns the original token");
}

/// Not entitled ⇒ honest absence: 403, and /verify stays null.
#[tokio::test]
async fn bridge__mint_without_entitlement_is_honest_403() {
    let state = test_state(false);
    let app = routes::build_router(state);
    let (status, value) = post_json(
        &app,
        "/mint",
        json!({"appUserId": "user-none", "purchaseRef": "rc-none-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(value["error"], "purchase-not-verified");
    let (_, verified) = post_json(&app, "/verify", json!({"appUserId": "user-none"})).await;
    assert_eq!(verified["token"], Value::Null, "no verified purchase ⇒ token null");
    assert!(verified["denylist"]["sig"].as_str().is_some(), "denylist envelope still present");
}

fn flip_signature_byte(token: &str) -> String {
    let parts: Vec<&str> = token.split('.').collect();
    let mut signature = mint::b64url_decode(parts[2]).unwrap();
    signature[0] ^= 0x01;
    format!("{}.{}.{}", parts[0], parts[1], mint::b64url_encode(&signature))
}

// ---------------------------------------------------------------------------
// Accept clause 3: redeem reuse rejected
// ---------------------------------------------------------------------------

/// TR-3/B.6: "redeem reuse rejected" — single-use registry keyed by
/// sha256(canonical code); confusable typings hash identically (§9.5).
#[tokio::test]
async fn bridge__redeem_reuse_rejected() {
    println!("Accept: {ACCEPT_LINE}");
    let state = test_state(true);
    let app = routes::build_router(state.clone());

    // A fixed code whose confusable typings normalize to one canonical string.
    let canonical = codes::normalize_code("NATALLY-AB10-CDEF-2345").unwrap();
    assert_eq!(canonical, "NATALLY-AB10-CDEF-2345");
    let raw_lower_confusable = "natally-abIo-cdef-2345"; // i→1, o→0
    assert_eq!(codes::normalize_code(raw_lower_confusable), Some(canonical.clone()));

    // 1. first redemption ⇒ 200 + token
    let (status, first) = post_json(
        &app,
        "/redeem",
        json!({"code": canonical, "appUserId": "user-redeem"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let token = first["token"].as_str().unwrap().to_string();
    assert!(!token.is_empty());

    // 2. the token is the redeemer's /verify token
    let (_, verified) = post_json(&app, "/verify", json!({"appUserId": "user-redeem"})).await;
    assert_eq!(verified["token"], Value::String(token.clone()));

    // 3. reuse — same code, different (confusable) typing ⇒ 409
    let (status, value) = post_json(&app, "/redeem", json!({"code": raw_lower_confusable})).await;
    assert_eq!(status, StatusCode::CONFLICT, "reuse must be rejected: {value}");
    assert_eq!(value["error"], "conflict");

    // 4. reuse — the exact original spelling ⇒ 409
    let (status, _) = post_json(&app, "/redeem", json!({"code": canonical})).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // 5. invalid inputs ⇒ 400 (U is excluded from Crockford; wrong prefix; wrong length)
    for bad in ["NATALLY-AB1U-CDEF-2345", "WRONG-AB10-CDEF-2345", "NATALLY-AB10-CDEF"] {
        let (status, value) = post_json(&app, "/redeem", json!({"code": bad})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {value}");
        assert_eq!(value["error"], "bad-request");
    }

    // 6. ledger key is sha256(canonical), stored (§9.5)
    let conn = lock_db(&state).unwrap();
    let hash = codes::code_hash_hex(&canonical);
    let stored: String = conn
        .query_row("SELECT code_hash FROM consumed_codes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, hash, "registry stores the sha256 of the canonical code");
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM consumed_codes", [], |r| r.get(0)).unwrap();
    assert_eq!(rows, 1, "exactly one consumed row despite four redeem attempts");
}

/// Bridge-minted random codes are canonical NATALLY-XXXX-XXXX-XXXX handles.
#[tokio::test]
async fn bridge__minted_random_codes_are_canonical_and_redeemable() {
    let state = test_state(true);
    let app = routes::build_router(state);
    let code = codes::mint_random_code();
    assert_eq!(codes::normalize_code(&code), Some(code.clone()));
    assert_eq!(code.len(), "NATALLY-XXXX-XXXX-XXXX".len());
    let (status, value) = post_json(&app, "/redeem", json!({"code": code})).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    // No appUserId ⇒ honest registry-scoped sub
    let token = value["token"].as_str().unwrap();
    let parts: Vec<&str> = token.split('.').collect();
    let payload: Value =
        serde_json::from_slice(&mint::b64url_decode(parts[1]).unwrap()).unwrap();
    assert!(payload["sub"].as_str().unwrap().starts_with("code:"));
}

// ---------------------------------------------------------------------------
// Accept clause 4 (rubric): denylist envelope signature verified
// ---------------------------------------------------------------------------

/// TR-3/B.6: "denylist envelope signature verified" — Ed25519 (standard
/// base64) over canonicalJson({issuedAt, revokedJti}), TS DenyListPayload shape.
#[tokio::test]
async fn bridge__denylist_envelope_signature_verifies() {
    println!("Accept: {ACCEPT_LINE}");
    let state = test_state(true);
    let app = routes::build_router(state.clone());
    let verifying_key = VerifyingKey::from(&state.signer);

    // Operator write path: revoke two jtis in the ledger.
    {
        let conn = lock_db(&state).unwrap();
        ledger::revoke_jti(&conn, "jti-revoked-1", license_bridge::state::system_now_ms()).unwrap();
        ledger::revoke_jti(&conn, "jti-revoked-2", license_bridge::state::system_now_ms()).unwrap();
    }

    let response = app.clone().oneshot(request("GET", "/denylist", &[], String::new())).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let envelope: Value = serde_json::from_slice(&bytes).unwrap();

    let issued_at = envelope["issuedAt"].as_u64().expect("issuedAt epoch ms");
    let revoked: Vec<String> = envelope["revokedJti"]
        .as_array()
        .expect("revokedJti array")
        .iter()
        .map(|v| v.as_str().expect("jti strings").to_string())
        .collect();
    assert_eq!(revoked, vec!["jti-revoked-1", "jti-revoked-2"], "sorted, complete");

    // Verify the Ed25519 signature over the canonical payload (TS parity:
    // canonicalJson({issuedAt, revokedJti})).
    let canonical = mint::canonical_denylist_payload(issued_at, &revoked);
    let sig_bytes = STANDARD.decode(envelope["sig"].as_str().unwrap()).unwrap();
    assert_eq!(sig_bytes.len(), 64);
    let signature = Signature::from_bytes(&sig_bytes.try_into().unwrap());
    verifying_key
        .verify(canonical.as_bytes(), &signature)
        .expect("denylist envelope signature must verify");

    // POST /verify carries the same signed envelope next to the token.
    let (_, verified) = post_json(&app, "/verify", json!({"appUserId": "nobody"})).await;
    assert_eq!(verified["token"], Value::Null);
    let denylist = &verified["denylist"];
    let revoked_2: Vec<String> = denylist["revokedJti"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let canonical_2 = mint::canonical_denylist_payload(denylist["issuedAt"].as_u64().unwrap(), &revoked_2);
    let sig_2 = STANDARD.decode(denylist["sig"].as_str().unwrap()).unwrap();
    verifying_key
        .verify(
            canonical_2.as_bytes(),
            &Signature::from_bytes(&sig_2.try_into().unwrap()),
        )
        .expect("/verify denylist envelope signature must verify");
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bridge__healthz_ok_and_unknown_processor_404() {
    println!("Accept: {ACCEPT_LINE}");
    let state = test_state(true);
    let app = routes::build_router(state);
    let health = app
        .clone()
        .oneshot(request("GET", "/healthz", &[], String::new()))
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    let bytes = health.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["status"], "ok");

    let (status, value) = send(
        &app,
        request(
            "POST",
            "/webhook/unknown",
            &[("x-signature".to_string(), "whatever".to_string())],
            "{}".to_string(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(value["error"], "not-found");
}
