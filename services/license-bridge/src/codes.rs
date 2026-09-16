// natally — redeem codes (§9.5), bridge half.
//
// PARITY CONTRACT with packages/billing/src/codes.ts:
//
// - canonical form `NATALLY-XXXX-XXXX-XXXX` (12 chars) or
//   `NATALLY-XXXX-XXXX-XXXX-XXXX-XXXX` (20 chars);
// - Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
//   (I/L/O/U excluded); normalization on input: uppercase, strip dashes,
//   I/i and L/l → 1, O/o → 0, U/u is invalid, everything outside the alphabet
//   invalid; the `NATALLY` prefix is required;
// - the single-use ledger key is SHA-256 (lowercase hex) of the CANONICAL
//   dashed code string — confusable typings hash identically;
// - individually-redeemable codes minted by the bridge are 12 random
//   Crockford chars from a 64-bit draw shifted right 4 bits — byte-for-byte
//   the same distribution rule as the TS `mintRandom`
//   (8 random bytes → big-endian u64 → >> 4 → 60 bits → 12 chars).

use sha2::{Digest, Sha256};

/// The literal code prefix; required, case-insensitive on input.
pub const CODE_PREFIX: &str = "NATALLY";

/// Crockford base32 alphabet — I, L, O, U excluded (§9.5).
pub const CROCKFORD_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Compact shape: 12 chars (the bridge-registry handle / individually
/// redeemable form).
pub const COMPACT_CHARS: usize = 12;
/// Extended shape: 20 chars (hash-based, offline-verifiable — mints live on
/// the client, not here).
pub const EXTENDED_CHARS: usize = 20;

/// Crockford normalization (§9.5) — returns the canonical dashed form or None.
pub fn normalize_code(raw: &str) -> Option<String> {
    let upper = raw.to_uppercase();
    let rest = upper.strip_prefix(CODE_PREFIX)?;
    let body_raw: String = rest.chars().filter(|c| *c != '-').collect();
    if body_raw.chars().count() != COMPACT_CHARS && body_raw.chars().count() != EXTENDED_CHARS {
        return None;
    }
    let mut body = String::with_capacity(body_raw.len());
    for ch in body_raw.chars() {
        match ch {
            'I' | 'L' => body.push('1'),
            'O' => body.push('0'),
            'U' => return None,
            other if CROCKFORD_ALPHABET.contains(&(other as u8)) => body.push(other),
            _ => return None,
        }
    }
    Some(group_chars(&body))
}

fn group_chars(body: &str) -> String {
    let groups: Vec<String> = body
        .chars()
        .collect::<Vec<char>>()
        .chunks(4)
        .map(|chunk| chunk.iter().collect())
        .collect();
    format!("{CODE_PREFIX}-{}", groups.join("-"))
}

/// The single-use ledger key: SHA-256 lowercase hex of the CANONICAL code
/// string (§9.5; identical to the TS `consumedCodeHash`).
pub fn code_hash_hex(canonical_code: &str) -> String {
    let digest = Sha256::digest(canonical_code.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Mint an individually-redeemable code: 12 random Crockford chars — a
/// registry handle with no offline meaning; /redeem is the registry.
pub fn mint_random_code() -> String {
    let bytes: [u8; 8] = rand::random();
    let mut value = u64::from_be_bytes(bytes);
    value >>= 4; // 60 usable bits, same as the TS mintRandom draw
    let mut chars = String::with_capacity(COMPACT_CHARS);
    for i in 0..COMPACT_CHARS {
        let index = ((value >> (5 * (COMPACT_CHARS - 1 - i))) & 0x1f) as usize;
        chars.push(CROCKFORD_ALPHABET[index] as char);
    }
    group_chars(&chars)
}

/// A fresh 128-bit jti (32 lowercase hex chars).
pub fn random_jti() -> String {
    let bytes: [u8; 16] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
