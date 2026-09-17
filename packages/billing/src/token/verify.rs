//! Native counterpart of format.ts/verify-web.ts. Signed timestamps are Unix seconds.
//! Parent dependency: ed25519-dalek 2.2, base64 0.22, serde 1 (derive), serde_json 1.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const DENY_LIST_MAX_AGE: u64 = 86_400;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LicenseTokenPayload {
    pub sub: String,
    pub tier: String,
    pub iat: u64,
    pub exp: Option<u64>,
    pub iss: String,
    pub jti: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DenyList {
    pub issued_at: u64,
    pub revoked_jti: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SignedDenyList {
    pub payload: DenyList,
    pub signature: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
}

fn decode(value: &str) -> Result<Vec<u8>, String> {
    if value.is_empty() {
        return Err("invalid-base64url".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "invalid-base64url")?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err("noncanonical-base64url".into());
    }
    Ok(bytes)
}

pub fn decode_license_public_key(encoded: &str) -> Result<VerifyingKey, String> {
    let raw: [u8; 32] = decode(encoded)?
        .try_into()
        .map_err(|_| "invalid-public-key")?;
    let key = VerifyingKey::from_bytes(&raw).map_err(|_| "invalid-public-key")?;
    let point = key.to_edwards();
    if key.is_weak() || !point.is_torsion_free() || point.compress().to_bytes() != raw {
        return Err("invalid-public-key".into());
    }
    Ok(key)
}

pub fn verify_ed25519(key: &VerifyingKey, message: &[u8], signature: &[u8]) -> Result<(), String> {
    let signature = Signature::from_slice(signature).map_err(|_| "invalid-signature")?;
    key.verify_strict(message, &signature)
        .map_err(|_| "invalid-signature".into())
}

pub fn verify_signed_deny_list(
    signed: &SignedDenyList,
    key: &VerifyingKey,
    now: u64,
) -> Result<DenyList, String> {
    if now > MAX_SAFE_INTEGER || signed.payload.issued_at > MAX_SAFE_INTEGER {
        return Err("invalid-clock".into());
    }
    if signed.payload.issued_at > now {
        return Err("future-deny-list".into());
    }
    if signed.payload.revoked_jti.len() > 100_000
        || signed.payload.revoked_jti.iter().any(String::is_empty)
    {
        return Err("invalid-deny-list".into());
    }
    // Struct declaration fixes the same field order as denyListSigningInput.
    let bytes = serde_json::to_vec(&signed.payload).map_err(|_| "invalid-deny-list")?;
    verify_ed25519(key, &bytes, &decode(&signed.signature)?)?;
    Ok(signed.payload.clone())
}

pub fn verify_license_token(
    token: &str,
    app_user_id: &str,
    key: &VerifyingKey,
    now: u64,
    online: bool,
    deny_list: Option<&SignedDenyList>,
) -> Result<LicenseTokenPayload, String> {
    if now > MAX_SAFE_INTEGER {
        return Err("invalid-clock".into());
    }
    if token.len() > 16_384 {
        return Err("malformed-token".into());
    }
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err("malformed-token".into());
    }
    let header: Header =
        serde_json::from_slice(&decode(parts[0])?).map_err(|_| "invalid-claims")?;
    if header.alg != "EdDSA" {
        return Err("invalid-claims".into());
    }
    let payload_bytes = decode(parts[1])?;
    // Serde Option accepts an absent field by default; the web contract requires exp.
    let value: serde_json::Value =
        serde_json::from_slice(&payload_bytes).map_err(|_| "invalid-claims")?;
    if value.get("exp").is_none() {
        return Err("invalid-claims".into());
    }
    let payload: LicenseTokenPayload =
        serde_json::from_slice(&payload_bytes).map_err(|_| "invalid-claims")?;
    if payload.sub.is_empty()
        || payload.jti.is_empty()
        || payload.tier != "unlimited"
        || payload.iss != "natally-license-bridge"
        || payload.iat > MAX_SAFE_INTEGER
        || payload.exp.is_some_and(|exp| exp > MAX_SAFE_INTEGER)
    {
        return Err("invalid-claims".into());
    }
    let input = format!("{}.{}", parts[0], parts[1]);
    verify_ed25519(key, input.as_bytes(), &decode(parts[2])?)?;
    if payload.sub != app_user_id {
        return Err("wrong-subject".into());
    }
    if payload.iat > now {
        return Err("future-token".into());
    }
    if payload
        .exp
        .is_some_and(|exp| exp <= now || exp <= payload.iat)
    {
        return Err("expired-token".into());
    }
    if online {
        if let Some(signed) = deny_list {
            let list = verify_signed_deny_list(signed, key, now)?;
            if list.revoked_jti.contains(&payload.jti) {
                return Err("revoked-token".into());
            }
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn unhex(text: &str) -> Vec<u8> {
        (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn rfc8032_empty_message() {
        let raw = unhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        let key = decode_license_public_key(&URL_SAFE_NO_PAD.encode(raw)).unwrap();
        let signature = unhex(concat!(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155",
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        ));
        assert!(verify_ed25519(&key, b"", &signature).is_ok());
        assert!(verify_ed25519(&key, b"tampered", &signature).is_err());
        assert!(decode_license_public_key(&URL_SAFE_NO_PAD.encode([0u8; 32])).is_err());
    }

    #[test]
    fn token_valid_expired_forged_revoked_and_offline() {
        // The TS suite additionally exercises OS-generated random keypairs.
        let signer = SigningKey::from_bytes(&[42; 32]);
        let key = signer.verifying_key();
        let mint = |exp| {
            let payload = LicenseTokenPayload {
                sub: "alice".into(),
                tier: "unlimited".into(),
                iat: 100,
                exp,
                iss: "natally-license-bridge".into(),
                jti: "purchase-1".into(),
            };
            let input = format!(
                "{}.{}",
                URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA"}"#),
                URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
            );
            format!(
                "{}.{}",
                input,
                URL_SAFE_NO_PAD.encode(signer.sign(input.as_bytes()).to_bytes())
            )
        };
        let token = mint(None);
        assert!(verify_license_token(&token, "alice", &key, 200, false, None).is_ok());
        assert!(verify_license_token(&mint(Some(201)), "alice", &key, 200, false, None).is_ok());
        assert!(verify_license_token(&mint(Some(200)), "alice", &key, 200, false, None).is_err());
        assert!(verify_license_token(&token, "bob", &key, 200, false, None).is_err());
        assert!(verify_license_token(
            &token,
            "alice",
            &SigningKey::from_bytes(&[43; 32]).verifying_key(),
            200,
            false,
            None
        )
        .is_err());
        let payload = DenyList {
            issued_at: 200,
            revoked_jti: vec!["purchase-1".into()],
        };
        let signature = URL_SAFE_NO_PAD.encode(
            signer
                .sign(&serde_json::to_vec(&payload).unwrap())
                .to_bytes(),
        );
        let signed = SignedDenyList { payload, signature };
        assert!(verify_license_token(&token, "alice", &key, 200, true, Some(&signed)).is_err());
        assert!(verify_license_token(&token, "alice", &key, 200, false, Some(&signed)).is_ok());
    }
}
