# license-bridge

Operator-hosted Rust/axum service — DOCS/ARCHITECTURE.md §9.3 (license tokens) and
§9.4 (processor rails & the license bridge). This service never runs client-side; no
processor secret and no signing key ever appears in a response.

## Surface (exactly)

- `POST /webhook/{stripe|revenuecat|polar|lemonsqueezy|paypal|square}` — processor
  webhooks. HMAC-SHA256 of the raw body, sent as `X-Natally-Signature: v1=<hex>`;
  verified against the per-processor secret. Idempotent via the SQLite ledger keyed
  `(processor, invoiceId)`: a replayed delivery returns the first outcome, never re-mints.
  Event body: `{"event": "purchase.fulfilled"|"refund"|"chargeback", "invoiceId": "...",
  "userId": "..."}` (`userId` required for fulfillment). Refund/chargeback events that
  identify a fulfilled purchase revoke the minted `jti` onto the signed deny-list — the
  ONLY revocation path. A rail with no configured secret answers 404 (hidden, §9.4).
- `POST /redeem` `{"code": "NATALLY-XXXX-XXXX-XXXX"}` — single-use codes; 128-bit random
  generated server-side, stored SHA-256-hashed. Outcomes mirror
  `packages/billing/src/codes.ts` `CodeOutcome`: `valid | invalid(shape|charset|signature|payload)
  | already-used | expired`; a replayed code returns the original outcome (a successfully
  redeemed one replays as `already-used`).
- `POST /verify` `{"token": "..."}` — Ed25519 check plus deny-list membership;
  `{"valid": true, "payload": {...}}` or `{"valid": false, "reason": "malformed" |
  "signature" | "claims" | "revoked"}`.
- `GET /deny-list` — `{payload: {issuedAt, revokedJti[]}, signature}`; the signature is
  Ed25519 over the canonical fixed-field-order JSON `{"issuedAt":N,"revokedJti":[...]}`,
  base64url — identical to `denyListSigningInput` in `packages/billing/src/token/format.ts`.

## Run

```sh
cp .env.example .env   # fill real values; .env is gitignored and never committed
cargo run --manifest-path services/license-bridge/Cargo.toml
```

Defaults to `127.0.0.1:47231` (high, non-patterned port — I-16/INC-11).

## Test

```sh
cargo test --manifest-path services/license-bridge/Cargo.toml
```

Covers: webhook HMAC fail + pass + replay-idempotency, redeem four outcomes + replay,
refund → jti revoked → `/verify` rejects, deny-list signature round-trip.
