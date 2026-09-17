# natally — Privacy Policy

**Effective date: 2026-09-17 · Operator: Robin L. M. Cheung, MBA (mba.robin) · Applies to: the natally web app (natally.robin.mba), this website, the landing page, and all order/checkout pages.**

## Summary

natally is designed so your personal information stays on your device. The web app stores your data in your own browser storage. We operate no user accounts, no telemetry, no analytics, and no crash reporting. The only network connections the app makes are: downloading the AI models and voice files it needs from public Hugging Face repositories (unauthenticated — no account, no identifying request), and the license/checkout calls needed if you choose to buy something. If you never purchase, the app never contacts our servers at all.

## 1. Who we are

The operator and data controller is Robin L. M. Cheung, MBA ("we", "us"), publishing natally at natally.robin.mba. Contact: the address published on the landing page contact block.

## 2. Exactly what is stored, and where

Everything below is stored **on your device**, in your browser's local storage (IndexedDB/OPFS) and the app's service-worker caches. It is not transmitted to us.

| Record | Fields | Notes |
|---|---|---|
| Person (you or someone you add, e.g. for a compatibility reading) | name, birth date, birth time or "unknown", birth place, time-zone identifier | classification: **birth data is quasi-PII (§12)** — it identifies an individual when combined and must be treated as sensitive personal information |
| Conversations (sessions and turns) | every message you send and natally sends back, with timestamps; records of in-app actions natally performed at your request | tool-action records are part of the transcript |
| Computed charts | the astronomical positions calculated from birth data | derived from the ephemeris engine; content-addressed |
| natally's memory ("lore") | summaries, facts, and vector embeddings derived from your conversations | derived data; generated memory, never presented as astronomical fact |
| Usage ledger | reading counts, dates, chart references | append-only for billing integrity |
| Redeemed codes | hashed code values, redemption times | hashed, not the codes themselves |
| License material | your signed license confirmation and a cached revocation list | stored wrapped/encrypted in browser storage — never plaintext |
| Downloaded models/voice files | public AI model files, hash-verified | not personal data; may be shared with other compatible apps on your device |

**Third-party birth data:** if you add another person (for example for a synastry/compatibility reading), you confirm you have that person's permission to enter their birth data.

**Minors:** natally is not directed to children under 13 (or the equivalent minimum age in your jurisdiction), and you must not enter birth data of such children.

## 3. What ever leaves your device

Exactly two categories, and nothing else:

1. **Model downloads (inbound only).** The app downloads its AI model and voice files directly from public, unauthenticated Hugging Face repositories. No account is created, no identifying information is sent. Files are SHA-256-verified before use.
2. **License and checkout (only if you choose to purchase or redeem).** The app contacts our license service and the payment processor you select. Payment processors may include Stripe, RevenueCat, Polar, Lemon Squeezy, PayPal, and Square, as presented in your checkout. **We never receive or store your card details** — we receive only a cryptographically signed license confirmation and a purchase reference. The signed revocation list is fetched at app start, before any checkout or restore, and at most once every 24 hours.

Voice synthesis runs entirely in your browser; your text is never sent anywhere to be spoken. There are no tracking cookies, no advertising identifiers, and no third-party scripts on the app, the website, the landing page, or the order pages.

## 4. $ROCHE credits (order pages)

If you buy $ROCHE chat credits, your balance is held by the payment/revenue platform on your account there. Each billed chat request reserves the quoted maximum before it runs and settles once when it completes; failures are refunded. A depleted balance never revokes an unlimited purchase, and we never silently switch you to paid remote features.

## 5. Your rights

- **Export:** Settings › Data exports all of your data (people, conversations, charts, natally's memory, code history) as one plain-text JSON document you own.
- **Delete everything:** Settings › Data performs real deletion — records, derived memory, and vectors are erased, not hidden. Shared model files are not personal data and may remain for other apps on your device.
- **Remove one person:** removes that person, natally's memory of them, and their cached charts; the broader conversation transcript remains until you delete everything.
- **Correction:** birth data can be edited at any time; charts recompute from the corrected inputs.

The usage ledger is append-only (with correcting entries) for financial-integrity reasons; it contains no conversation content.

## 6. Retention, changes, contact

Your data persists exactly until you delete it; nothing is retained server-side because nothing is stored server-side. If this policy changes, the effective date above changes and the previous version remains available on request at the landing-page contact address.
