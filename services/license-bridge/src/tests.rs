//! Rust test suite (task B.6): webhook HMAC fail + pass + replay-idempotency, redeem four
//! outcomes + replay, refund → jti revoked → /verify rejects, deny-list signature
//! round-trip. Run: `cargo test --manifest-path services/license-bridge/Cargo.toml`.

use crate::codes;
use crate::config::{Config, PROCESSORS};
use crate::crypto;
use crate::db;
use crate::denylist;
use crate::router;
use crate::state::Bridge;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tower::ServiceExt;

fn test_bridge() -> Bridge {
    let mut rng_seed = [0u8; 32];
    rng_seed.copy_from_slice(&crypto::random_bytes(32));
    let cfg = Config {
        bind_addr: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        signing_seed: rng_seed,
        processor_secrets: PROCESSORS
            .iter()
            .map(|p| (p.to_string(), format!("secret-{p}")))
            .collect::<HashMap<String, String>>(),
    };
    Bridge::new(cfg, Mutex::new(db::open_in_memory()))
}

async fn post_json(app: &axum::Router, uri: &str, secret: Option<&str>, body: Value) -> (StatusCode, Value) {
    let payload = body.to_string();
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(secret) = secret {
        builder = builder.header(
            "x-natally-signature",
            format!("v1={}", crypto::hmac_sha256_hex(secret, payload.as_bytes())),
        );
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(payload)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

fn fulfilled(invoice: &str) -> Value {
    json!({ "event": "purchase.fulfilled", "invoiceId": invoice, "userId": "user-abc" })
}

#[tokio::test]
async fn webhook_hmac_fail_then_pass() {
    let bridge = test_bridge();
    let app = router(bridge);

    // Missing / bad signature -> 401.
    let (status, _) = post_json(&app, "/webhook/stripe", None, fulfilled("inv-1")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = post_json(&app, "/webhook/stripe", Some("wrong-secret"), fulfilled("inv-1")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Hidden rail (no secret configured) -> 404.
    let hidden = test_bridge_without_paypal();
    let app_hidden = router(hidden);
    let (status, body) = post_json(&app_hidden, "/webhook/paypal", Some("secret-paypal"), fulfilled("inv-9")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "unknown-rail");

    // Correct HMAC -> 200, token minted.
    let (status, body) = post_json(&app, "/webhook/stripe", Some("secret-stripe"), fulfilled("inv-1")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["result"], "minted");
    assert!(body["token"].as_str().unwrap().split('.').count() == 3);
    assert!(body["jti"].as_str().unwrap().len() >= 16);
}

fn test_bridge_without_paypal() -> Bridge {
    let mut rng_seed = [0u8; 32];
    rng_seed.copy_from_slice(&crypto::random_bytes(32));
    let secrets: HashMap<String, String> = PROCESSORS
        .iter()
        .filter(|p| **p != "paypal")
        .map(|p| (p.to_string(), format!("secret-{p}")))
        .collect();
    Bridge::new(
        Config {
            bind_addr: "127.0.0.1:0".to_string(),
            db_path: ":memory:".to_string(),
            signing_seed: rng_seed,
            processor_secrets: secrets,
        },
        Mutex::new(db::open_in_memory()),
    )
}

#[tokio::test]
async fn webhook_replay_idempotent() {
    let bridge = test_bridge();
    let app = router(bridge);

    let (status, first) = post_json(&app, "/webhook/stripe", Some("secret-stripe"), fulfilled("inv-2")).await;
    assert_eq!(status, StatusCode::OK);
    let (_, replay) = post_json(&app, "/webhook/stripe", Some("secret-stripe"), fulfilled("inv-2")).await;
    assert_eq!(first, replay, "replayed delivery must return the first outcome");

    // Same invoice on a different processor is a distinct delivery and mints its own token.
    let (_, other) = post_json(&app, "/webhook/polar", Some("secret-polar"), fulfilled("inv-2")).await;
    assert_eq!(other["result"], "minted");
    assert_ne!(first["jti"], other["jti"]);
}

#[tokio::test]
async fn redeem_four_outcomes_and_replay() {
    let bridge = test_bridge();

    // valid — then replay yields already-used with the matching codeHash.
    let (code, _) = codes::issue_code(&bridge, "unlimited", None);
    let outcome = codes::redeem(&bridge, &code);
    assert_eq!(outcome["result"], "valid");
    assert_eq!(outcome["tier"], "unlimited");
    assert_eq!(outcome["expiresAt"], Value::Null);
    let replay = codes::redeem(&bridge, &code.to_lowercase()); // normalization, same code
    assert_eq!(replay["result"], "already-used");
    assert_eq!(replay["codeHash"], codes::code_sha256_hex(&code));

    // invalid — shape (not the NATALLY- group shape).
    assert_eq!(codes::redeem(&bridge, "FOO")["result"], "invalid");
    assert_eq!(codes::redeem(&bridge, "FOO")["reason"], "shape");

    // invalid — charset (confusable I never appears in Crockford base32).
    let bad = codes::redeem(&bridge, "NATALLY-IIII-IIII-IIII");
    assert_eq!(bad["result"], "invalid");
    assert_eq!(bad["reason"], "charset");

    // invalid — payload (well-shaped but unregistered random).
    let unknown = codes::redeem(&bridge, "NATALLY-AAAA-BBBB-CCCC");
    assert_eq!(unknown["result"], "invalid");
    assert_eq!(unknown["reason"], "payload");

    // expired — issued with a past expiry.
    let stale_exp = crypto::unix_now() - 60;
    let (stale, _) = codes::issue_code(&bridge, "unlimited", Some(stale_exp));
    let outcome = codes::redeem(&bridge, &stale);
    assert_eq!(outcome["result"], "expired");
    assert_eq!(outcome["expiresAt"], json!(stale_exp));
    // Expired outcome replays verbatim.
    assert_eq!(codes::redeem(&bridge, &stale), outcome);
}

#[tokio::test]
async fn refund_revokes_jti_and_verify_rejects() {
    let bridge = test_bridge();
    let app = router(bridge);

    let (status, minted) = post_json(&app, "/webhook/stripe", Some("secret-stripe"), fulfilled("inv-7")).await;
    assert_eq!(status, StatusCode::OK);
    let token = minted["token"].as_str().unwrap().to_string();

    // Before refund: verify accepts.
    let (status, verdict) = post_json(&app, "/verify", None, json!({ "token": token })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(verdict["valid"], true);
    assert_eq!(verdict["payload"]["tier"], "unlimited");
    assert_eq!(verdict["payload"]["iss"], "natally-license-bridge");

    // Tampered token: signature failure surfaces as a reason code.
    let tampered = format!("{token}x");
    let (_, verdict) = post_json(&app, "/verify", None, json!({ "token": tampered })).await;
    assert_eq!(verdict["valid"], false);

    // Refund webhook revokes the minted jti — the only revocation path.
    let (status, outcome) = post_json(
        &app,
        "/webhook/stripe",
        Some("secret-stripe"),
        json!({ "event": "refund", "invoiceId": "inv-7" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(outcome["result"], "revoked");
    assert_eq!(outcome["jti"], minted["jti"]);
    // Refund replay returns the stored outcome.
    let (_, replay) = post_json(
        &app,
        "/webhook/stripe",
        Some("secret-stripe"),
        json!({ "event": "refund", "invoiceId": "inv-7" }),
    )
    .await;
    assert_eq!(replay, outcome);

    // /verify now rejects with the revoked reason.
    let (status, verdict) = post_json(&app, "/verify", None, json!({ "token": token })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(verdict["valid"], false);
    assert_eq!(verdict["reason"], "revoked");
}

#[tokio::test]
async fn deny_list_signature_roundtrip() {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let bridge = test_bridge();
    let app = router(bridge);
    let (_, minted) = post_json(&app, "/webhook/stripe", Some("secret-stripe"), fulfilled("inv-3")).await;
    let (_, minted2) = post_json(&app, "/webhook/revenuecat", Some("secret-revenuecat"), fulfilled("inv-4")).await;
    post_json(&app, "/webhook/stripe", Some("secret-stripe"), json!({ "event": "chargeback", "invoiceId": "inv-3" })).await;

    let response = app
        .clone()
        .oneshot(Request::builder().uri("/deny-list").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&bytes).unwrap();

    let payload = &list["payload"];
    assert_eq!(payload["revokedJti"], json!([minted["jti"]]));
    assert!(payload["issuedAt"].as_i64().is_some());

    // Round-trip against a Bridge whose key material we hold.
    let held = test_bridge_held();
    let signed = denylist::build_and_sign(&held);
    let canonical = denylist::deny_list_signing_input(&denylist::DenyListPayload {
        issuedAt: signed["payload"]["issuedAt"].as_i64().unwrap(),
        revokedJti: vec![],
    });
    let verifying = VerifyingKey::from_bytes(
        &ed25519_dalek::SigningKey::from_bytes(&held.cfg.signing_seed)
            .verifying_key()
            .to_bytes(),
    )
    .unwrap();
    let signature = Signature::from_slice(
        &crypto::b64url_decode(signed["signature"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    verifying
        .verify(&canonical, &signature)
        .expect("deny-list signature must verify");

    // Tampered payload does not verify.
    let mut tampered_canonical = canonical.clone();
    tampered_canonical[0] ^= 0xff;
    assert!(verifying.verify(&tampered_canonical, &signature).is_err());

    let _ = minted2;
}

/// A Bridge kept in scope so tests can assert against its actual key material.
fn test_bridge_held() -> Bridge {
    test_bridge()
}
