# natally — license bridge (`services/license-bridge`, ARCHITECTURE §9.4)

Operator-hosted Rust/axum service: receives the six processor webhooks
(HMAC/signature-verified, idempotent SQLite ledger keyed
`(processor, invoice_id)`), mints Ed25519 LicenseTokens with
`LICENSE_ED25519_PRIVATE_KEY`, issues single-use redeem codes (stored
SHA-256-hashed), publishes the signed deny-list, and exposes
`POST /verify` / `POST /redeem`. No processor secret and no signing key ever
ships in a client (§9.4).

## Run

```sh
cp .env.example .env   # fill from ~/Admin-Manual/CREDENTIALS/natally.md
set -a; . ./.env; set +a
cargo run --release --manifest-path services/license-bridge/Cargo.toml
# RC REST v2 verification (POST /mint):
cargo run --release --features http-rc --manifest-path services/license-bridge/Cargo.toml
```

Env: `PORT` (default 8088, binds `127.0.0.1`), `LEDGER_PATH` (required,
SQLite), `LICENSE_ED25519_PRIVATE_KEY` (required, base64 of the 32-byte
Ed25519 seed), the six per-processor secrets below, `RC_SECRET_KEY` /
`RC_API_KEY` (plus optional `RC_API_BASE`, `RC_PROJECT_ID`,
`RC_ENTITLEMENT_ID` for the `http-rc` verifier), `STRIPE_TOLERANCE_SECS`
(default 300).

## Routes

| Route | Purpose |
|---|---|
| `GET /healthz` | liveness |
| `POST /webhook/{stripe\|polar\|lemonsqueezy\|paypal\|square\|revenuecat}` | verified purchase events (see mapping) |
| `POST /verify` | `{appUserId}` → `{token: string\|null, denylist: {issuedAt, revokedJti, sig}}` |
| `POST /redeem` | `{code, appUserId?}` → `{token}`; reuse ⇒ **409**; invalid charset/shape ⇒ 400 |
| `POST /mint` | `{appUserId, purchaseRef}` → RC-verified mint; idempotent by `('revenuecat', purchaseRef)` |
| `GET /denylist` | the signed envelope `{issuedAt, revokedJti, sig}` |

An operator-facing `{prefix}` (e.g. `/bridge`) is a reverse-proxy concern;
routes are mounted at the service root.

## Webhook verification — exact header/secret mapping

Each row is exactly what `src/routes/webhooks.rs` implements. Secret env names
match `.env.example`.

| processor | secret env | header(s) | scheme implemented |
|---|---|---|---|
| stripe | `STRIPE_WEBHOOK_SECRET` | `Stripe-Signature: t=<unix-sec>,v1=<hex>` | HMAC-SHA256 (hex, lowercase compare, constant-time) over ascii(`{t}.{raw body}`); `t` must be within `STRIPE_TOLERANCE_SECS` of the bridge clock (replay window). Stripe's documented scheme. |
| polar | `POLAR_WEBHOOK_SECRET` | `X-Polar-Signature: <hex>` | HMAC-SHA256 hex of the raw body (constant-time). The standard scheme both Polar and Lemon Squeezy document (hex HMAC of the raw body). |
| lemonsqueezy | `LEMONSQUEEZY_WEBHOOK_SECRET` | `X-Signature: <hex>` | HMAC-SHA256 hex of the raw body (constant-time). |
| paypal | `PAYPAL_WEBHOOK_SECRET` | `Paypal-Auth-Algorithm` (= `SHA256withRSA`), `Paypal-Transmission-Id`, `Paypal-Cert-Url`, `Paypal-Transmission-Time`, `Paypal-Transmission-Sig` | HMAC-SHA256 (base64) over the **documented message composition** `algo\|transmissionId\|certUrl\|transmissionTime\|webhookId\|crc32(raw body)` (CRC-32 IEEE, decimal; `webhookId` = the secret env value). **Honest gap:** live PayPal signs that message with RSA-SHA256 using the key in `Paypal-Cert-Url` and also offers a `/verify-webhook-signature` API; full RSA verification needs cert fetch + trust chain, which cannot be honored offline. The composition, algorithm check and CRC are real; the RSA leg is the documented gap — not fake verification. |
| square | `SQUARE_WEBHOOK_SECRET` | `x-square-hmacsha256-signature: <base64>` | HMAC-SHA256 (base64) over `POST` + path (e.g. `/webhook/square`) + raw body (note-prescribed). **Honest divergence:** Square's live docs sign `notification_url + raw body`; if you run Square, prefer configuring the notification URL to equal `https://<host>/webhook/square` and confirm the live scheme before going public with that rail — the HMAC core itself is real. |
| revenuecat | `REVENUECAT_WEBHOOK_SECRET` | `Authorization: Bearer <secret>` (RC's documented webhook auth) or `X-Signature: <secret>` (task-note carrier) | constant-time equality with the configured secret; no body signature exists in this scheme. |

Unknown processor ⇒ 404; missing secret for a known rail ⇒ 503
`rail-not-configured` (honest absence); bad signature ⇒ 401; verified body
that is not JSON ⇒ 400; verified body without the required fields ⇒ 422
(processors retry).

### Event envelope

After signature verification the bridge reads, from the JSON body:

- `appUserId` — top level, or `metadata.appUserId` (e.g. a Stripe
  `checkout.session.completed` carrying `metadata[appUserId]`);
- `invoiceId` | `invoice_id` | `id` — the processor's unique purchase/event id
  (string or integer).

Configure each processor's payload/webhook template so those fields reach the
bridge; they are the ledger's idempotency and attribution keys.

### Idempotency (§9.4)

On a verified event the bridge inserts `purchase_events` with PK
`(processor, invoice_id)` — INSERT-only, `ON CONFLICT DO NOTHING`, inside one
IMMEDIATE transaction that also stores the minted issuance. A redelivered
event answers `200 {"status":"duplicate","jti":…}` (the original jti) and
mints nothing.

## Token format (client parity)

`packages/billing/src/token/format.ts` is normative for the wire format; this
service mints byte-compatible tokens:

- `base64url(header).base64url(payload).base64url(sig)` — base64url **unpadded**;
- header canonical JSON: `{"alg":"EdDSA","typ":"JWT+COSE-ish v1"}`;
- payload canonical JSON, keys sorted:
  `{"exp":null,"iat":<epoch-sec>,"iss":"natally-license-bridge","jti":"<32hex>","sub":"<appUserId>","tier":"unlimited"}`;
- signature: Ed25519 over utf8(`header.payload`).

`POST /verify` returns `null` when no verified purchase exists for the app
user — never a synthetic token (INC-19: honest absence).

## Redeem codes (§9.5)

Canonical form `NATALLY-XXXX-XXXX-XXXX` (Crockford base32; I/L→1, O→0, U
invalid; 12 or 20 chars). Single-use registry keyed by SHA-256 (lowercase hex)
of the canonical dashed string, so confusable typings collide identically.
First redemption mints a LicenseToken; reuse ⇒ 409. Without `appUserId` the
token's sub is the honest registry-scoped `code:<hash16>` (the TS
`LicensePayloadSchema` requires only a non-empty sub). Codes minted here are
12 random Crockford chars (`mint_random_code`, same draw rule as the TS
`mintRandom`); hash-based 20-char codes are minted client-side
(`packages/billing/src/codes.ts`), not here.

## Deny-list (§9.3)

`GET /denylist` and every `POST /verify` return `{issuedAt, revokedJti, sig}`
where `sig` is Ed25519 (standard base64) over
utf8(canonicalJson({issuedAt, revokedJti})) — the TS `DenyListPayload` shape;
`revokedJti` is sorted for determinism. The operator write path is the
ledger's `revocations(jti PRIMARY KEY, revoked_at)` table (INSERT-only;
e.g. `sqlite3 $LEDGER_PATH "INSERT INTO revocations (jti, revoked_at) VALUES
('<jti>', strftime('%s','now')*1000);"`). Revocation never blocks a verified
unexpired token offline — clients check only when online.

## RevenueCat purchase verification (`POST /mint`)

Injected as `state::RcVerifier`:

- **tests / default build:** in-memory impls — zero network (house rule).
- **default build binary:** `DisabledRcVerifier` ⇒ /mint answers 502 with the
  honest reason.
- **`--features http-rc`:** `HttpRcVerifier` — `GET
  {RC_API_BASE}/projects/{RC_PROJECT_ID}/customers/{appUserId}/active_entitlements`
  with `Authorization: Bearer {RC_API_KEY}`; entitled iff the response's
  `active_entitlements[]` contains `entitlement_id == RC_ENTITLEMENT_ID`
  (default `unlimited`). **Honest caveat:** the exact v2 response grammar
  should be confirmed against live RevenueCat docs before that rail goes
  public; it is not exercised by tests (no network in tests).

## Tests

`cargo test --manifest-path services/license-bridge/Cargo.toml` — axum tests
via `tower::ServiceExt::oneshot`, SQLite in-memory, injected clock, six HMAC
fixtures (valid ⇒ 200 + recorded, tampered ⇒ 401, double delivery ⇒ one
issuance), mint→verify roundtrip with byte-exact TS-format parity, redeem
reuse rejected, denylist envelope signature verified.

## License

AGPL-3.0-or-later (repo-level; see LICENSE).
