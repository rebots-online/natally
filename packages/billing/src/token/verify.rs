//! natally — native license token verification design (ARCHITECTURE §9.3).
//!
//! ⚠ THIS FILE IS A COMMENT-ONLY DESIGN STUB.
//!
//! It pins the Rust half of B.3's verification seam: the exact mirror of
//! `packages/billing/src/token/verify-web.ts`, to run in-process on the native
//! legs (Linux/Windows/Android desktop+mobile shell) so token verification
//! never depends on a JS engine being alive at license-check time. It is a
//! design document, NOT shipped Rust: `ed25519-dalek` is deliberately NOT a
//! dependency of `apps/local/src-tauri/Cargo.toml` yet (this task may not add
//! deps), so the file cannot compile under
//! `cargo check --manifest-path apps/local/src-tauri/Cargo.toml` — per the B.3
//! block, C-phase (Tauri shell / native bridge) owns adding
//! `ed25519-dalek = "2"` to that manifest and wiring these modules into the
//! command registry. Same pattern as `packages/lore/src/embed/native.rs`.
//!
//! # Contract recap (normative, from §9.3 / format.ts / verify-web.ts)
//!
//! - Token: `base64url(header).base64url(payload).base64url(sig)`, header
//!   `{"alg":"EdDSA","typ":"JWT+COSE-ish v1"}`; Ed25519 signature (64 bytes)
//!   over the UTF-8 bytes of the dotted `header.payload` prefix, VERIFIED
//!   VERBATIM — no re-serialization on this side (canonical key-sorted JSON is
//!   a mint-time concern, owned by the license bridge).
//! - Public key: `VITE_LICENSE_PUBKEY`, base64 of the raw 32-byte Ed25519
//!   verify key, baked into the binary at build; verification is fully
//!   OFFLINE — this module performs no I/O and no network access.
//! - Semantics (each a distinct error, mirroring `TokenVerifyReason`):
//!   malformed → sig → iss ("natally-license-bridge") → sub (must equal the
//!   install's appUserId) → expired (`exp` null-or-future) → revoked (deny
//!   list blocks ONLY listed jtis; consulted from the cached, bridge-signed
//!   payload when present — absence never blocks).
//!
//! # Planned module (C.1 wiring)
//!
//! ```ignore
//! use ed25519_dalek::{Signature, Verifier, VerifyingKey};
//! use serde::Deserialize;
//!
//! /// Reasons mirror verify-web.ts `TokenVerifyReason` one-for-one; the TS
//! /// bridge layer maps them onto the same strings over the IPC seam.
//! #[derive(Debug, thiserror::Error)]
//! pub enum TokenVerifyError {
//!     #[error("malformed")] Malformed,
//!     #[error("sig")]       Sig,
//!     #[error("iss")]       Iss,
//!     #[error("sub")]       Sub,
//!     #[error("expired")]   Expired,
//!     #[error("revoked")]   Revoked,
//! }
//!
//! #[derive(Deserialize)]
//! struct TokenHeader { alg: String, typ: String }
//!
//! /// Exp widened to Option<i64>: None is perpetual (§9.3 pins the bridge to
//! /// minting null; a future Some(ts) is honored exactly like the web leg).
//! #[derive(Deserialize)]
//! struct TokenPayload {
//!     sub: String,
//!     tier: String,
//!     iat: i64,
//!     exp: Option<i64>,
//!     iss: String,
//!     jti: String,
//! }
//!
//! /// `deny_list`: cached DenyListPayload `{ issuedAt, revokedJti }` — the
//! /// envelope's Ed25519 `sig` is checked by the online refresh path (bridge
//! /// task) BEFORE this cache is replaced; offline consult never re-checks it.
//! pub fn verify_compact_token(
//!     token: &str,
//!     public_key_b64: &str,          // VITE_LICENSE_PUBKEY value, baked
//!     now_unix: i64,                 // injected clock, never SystemTime::now
//!     app_user_id: &str,
//!     deny_list: Option<&[String]>,  // revokedJti
//! ) -> Result<TokenPayload, TokenVerifyError> {
//!     let malformed = |_| TokenVerifyError::Malformed;
//!     let parts: Vec<&str> = token.split('.').collect();
//!     if parts.len() != 3 { return Err(TokenVerifyError::Malformed); }
//!     let (h, p, s) = (parts[0], parts[1], parts[2]);
//!     if h.is_empty() || p.is_empty() || s.is_empty() { return Err(TokenVerifyError::Malformed); }
//!     let header_bytes = base64url_decode(h).map_err(malformed)?;
//!     let payload_bytes = base64url_decode(p).map_err(malformed)?;
//!     let sig_bytes = base64url_decode(s).map_err(malformed)?;
//!     let header: TokenHeader = serde_json::from_slice(&header_bytes).map_err(malformed)?;
//!     if header.alg != "EdDSA" || header.typ != "JWT+COSE-ish v1" {
//!         return Err(TokenVerifyError::Malformed);
//!     }
//!     let payload: TokenPayload = serde_json::from_slice(&payload_bytes).map_err(malformed)?;
//!     if sig_bytes.len() != 64 { return Err(TokenVerifyError::Sig); }
//!
//!     // Verbatim signing input: the transmitted "h.p" bytes, byte for byte.
//!     let mut signing_input = Vec::with_capacity(h.len() + 1 + p.len());
//!     signing_input.extend_from_slice(h.as_bytes());
//!     signing_input.push(b'.');
//!     signing_input.extend_from_slice(p.as_bytes());
//!
//!     let key_bytes: [u8; 32] = base64_decode_32(public_key_b64).map_err(|_| TokenVerifyError::Sig)?;
//!     let verifying_key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| TokenVerifyError::Sig)?;
//!     let signature = Signature::from_slice(&sig_bytes).map_err(|_| TokenVerifyError::Sig)?;
//!     verifying_key.verify(&signing_input, &signature).map_err(|_| TokenVerifyError::Sig)?;
//!
//!     if payload.iss != "natally-license-bridge" { return Err(TokenVerifyError::Iss); }
//!     if payload.sub != app_user_id || payload.sub.is_empty() { return Err(TokenVerifyError::Sub); }
//!     if payload.tier != "unlimited" { return Err(TokenVerifyError::Malformed); }
//!     if let Some(exp) = payload.exp {
//!         if exp <= now_unix { return Err(TokenVerifyError::Expired); }
//!     }
//!     if let Some(revoked) = deny_list {
//!         if revoked.iter().any(|jti| jti == &payload.jti) {
//!             return Err(TokenVerifyError::Revoked);
//!         }
//!     }
//!     Ok(payload)
//! }
//! ```
//!
//! # Lane notes
//!
//! - `base64url_decode` is a small local helper (unpadded RFC 4648 §5); no
//!   new crate is justified for 20 lines, and B.3 adds no deps by contract.
//! - The injected `now_unix` keeps the TR-3 "injected clock only" rule: the
//!   caller (license task's native surface) owns the clock source.
//! - Cross-leg agreement: identical bytes in, identical verdict out — the TR-5
//!   ±1e-3-style cross-leg fixtures have a licensing analogue in TR-3 (same
//!   fixture tokens verified on both legs must classify identically).
