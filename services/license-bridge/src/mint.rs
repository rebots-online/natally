// natally — LicenseToken minting + signed deny-list envelope (§9.3).
//
// BYTE-EXACT PARITY CONTRACT with packages/billing/src/token/format.ts (the
// client half of this format):
//
//   token = base64url(header) "." base64url(payload) "." base64url(sig64)
//
// - header is the CONSTANT canonical JSON `{"alg":"EdDSA","typ":"JWT+COSE-ish v1"}`
//   (the TS `canonicalJson` sorts keys; alg < typ).
// - payload is canonical JSON with keys recursively sorted — for the license
//   payload that is exactly
//   `{"exp":null,"iat":<s>,"iss":"natally-license-bridge","jti":"<j>","sub":"<s>","tier":"unlimited"}`
//   (exp < iat < iss < jti < sub < tier). `iat` is epoch SECONDS (CWT
//   NumericDate convention, per §9.3 / types.ts `epochSeconds`); `exp` is
//   always null (perpetual purchase; revocation is the deny-list's job).
// - the signature is Ed25519 over the UTF-8 bytes of ascii(header).ascii(payload).
// - base64url is RFC 4648 §5 UNPADDED (the TS bytesToBase64Url strips '=').
//
// String escaping (`json_string`) mirrors both JSON.stringify and serde_json:
// short escapes for " \ \b \f \n \r \t, `\u00xx` (lowercase hex) for the rest
// of the C0 range, all other characters verbatim. Identifiers minted here
// (jti = 32 hex chars, sub = caller-supplied app user id) stay well inside the
// unambiguous range.
//
// The deny-list envelope (§9.3, types.ts `DenyListSchema`) is
// `{issuedAt, revokedJti, sig}` where `sig` is the Ed25519 signature (standard
// padded base64, matching the TS "base64" comment) over
// utf8(canonicalJson({issuedAt, revokedJti})). The revoked list is sorted so
// the envelope is deterministic.

use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use serde_json::{json, Value};

/// Token algorithm — must equal the TS `TOKEN_ALG` byte for byte.
pub const TOKEN_ALG: &str = "EdDSA";
/// Token type marker — must equal the TS `TOKEN_TYP` byte for byte.
pub const TOKEN_TYP: &str = "JWT+COSE-ish v1";
/// The only issuer (§9.3).
pub const TOKEN_ISS: &str = "natally-license-bridge";
/// The only paid tier (§9.3/§9.4).
pub const TOKEN_TIER: &str = "unlimited";

/// The fixed canonical header JSON (TS: `canonicalJson(TOKEN_HEADER)`).
pub const CANONICAL_HEADER_JSON: &str = "{\"alg\":\"EdDSA\",\"typ\":\"JWT+COSE-ish v1\"}";

// ---------------------------------------------------------------------------
// base64url (unpadded, RFC 4648 §5) — parity with format.ts
// ---------------------------------------------------------------------------

pub fn b64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Lenient base64url decode (accepts padded input too), like the TS decoder.
pub fn b64url_decode(encoded: &str) -> Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(encoded).or_else(|_| URL_SAFE.decode(encoded))
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/// JSON string escaping matching JSON.stringify and serde_json.
pub fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The canonical license payload (§9.3), keys pre-sorted: exp, iat, iss, jti,
/// sub, tier. Byte-identical to `canonicalJson(payload)` on the TS side.
pub fn canonical_license_payload(sub: &str, iat: u64, jti: &str) -> String {
    format!(
        "{{\"exp\":null,\"iat\":{iat},\"iss\":\"{TOKEN_ISS}\",\"jti\":{},\"sub\":{},\"tier\":\"{TOKEN_TIER}\"}}",
        json_string(jti),
        json_string(sub),
    )
}

/// The canonical deny-list payload: keys sorted (issuedAt < revokedJti), the
/// revoked list sorted for determinism.
pub fn canonical_denylist_payload(issued_at: u64, revoked_jti: &[String]) -> String {
    let mut sorted: Vec<&String> = revoked_jti.iter().collect();
    sorted.sort();
    let items: Vec<String> = sorted.iter().map(|s| json_string(s)).collect();
    format!(
        "{{\"issuedAt\":{issued_at},\"revokedJti\":[{}]}}",
        items.join(",")
    )
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

/// Mint the compact three-segment LicenseToken (§9.3) — deterministic for a
/// given (key, sub, iat, jti).
pub fn mint_license_token(key: &SigningKey, sub: &str, iat: u64, jti: &str) -> String {
    let header_segment = b64url_encode(CANONICAL_HEADER_JSON.as_bytes());
    let payload_segment = b64url_encode(canonical_license_payload(sub, iat, jti).as_bytes());
    let signing_input = format!("{header_segment}.{payload_segment}");
    let signature = key.sign(signing_input.as_bytes());
    format!("{signing_input}.{}", b64url_encode(&signature.to_bytes()))
}

/// The signed deny-list envelope (§9.3) — `{issuedAt, revokedJti, sig}` with
/// `sig` = standard base64 Ed25519 over the canonical payload.
pub fn sign_denylist_envelope(key: &SigningKey, issued_at: u64, revoked_jti: &[String]) -> Value {
    let mut sorted: Vec<String> = revoked_jti.to_vec();
    sorted.sort();
    let payload = canonical_denylist_payload(issued_at, revoked_jti);
    let signature = key.sign(payload.as_bytes());
    json!({
        "issuedAt": issued_at,
        "revokedJti": sorted,
        "sig": STANDARD.encode(signature.to_bytes()),
    })
}

/// Parse `LICENSE_ED25519_PRIVATE_KEY`: base64 (standard, url-safe, padded or
/// not) of the raw 32-byte Ed25519 seed. Honest error text — never panic.
pub fn parse_license_key(encoded: &str) -> Result<SigningKey, String> {
    let trimmed = encoded.trim();
    if trimmed.is_empty() {
        return Err("LICENSE_ED25519_PRIVATE_KEY is empty".to_string());
    }
    let decoded = STANDARD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(trimmed))
        .or_else(|_| URL_SAFE_NO_PAD.decode(trimmed))
        .map_err(|e| format!("LICENSE_ED25519_PRIVATE_KEY is not valid base64: {e}"))?;
    let seed: [u8; 32] = decoded
        .try_into()
        .map_err(|v: Vec<u8>| {
            format!(
                "LICENSE_ED25519_PRIVATE_KEY must decode to 32 raw Ed25519 seed bytes, got {}",
                v.len()
            )
        })?;
    Ok(SigningKey::from_bytes(&seed))
}

/// Verify helper (used by tests to close the parity loop the same way
/// verify-web.ts does: over the transmitted bytes verbatim).
pub fn verify_token_signature(
    verifying_key: &ed25519_dalek::VerifyingKey,
    token: &str,
) -> Result<(), String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("token is not three segments".to_string());
    }
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let sig_bytes = b64url_decode(parts[2]).map_err(|e| e.to_string())?;
    let arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|v: Vec<u8>| format!("signature must be 64 bytes, got {}", v.len()))?;
    let signature = Signature::from_bytes(&arr);
    verifying_key
        .verify(signing_input.as_bytes(), &signature)
        .map_err(|e| format!("signature invalid: {e}"))
}
