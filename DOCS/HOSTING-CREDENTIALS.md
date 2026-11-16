# Hosting credentials — Surge

Account: **shannon-coinbase@robin.mba**.

The shared private infrastructure credential authority is Admin-Manual:

- `CREDENTIALS/global-infrastructure/surge-deploy-account.md` — account and recovery provenance.
- `CREDENTIALS/global-infrastructure/surge.env` — concrete `SURGE_LOGIN` and `SURGE_TOKEN`.
- `INFRA/HOSTING/surge.md` — infrastructure discovery entry.

Resolve `kstore://admin-manual/CREDENTIALS/global-infrastructure/surge.env#SURGE_LOGIN` and `kstore://admin-manual/CREDENTIALS/global-infrastructure/surge.env#SURGE_TOKEN` into the deployment process environment. The private Admin-Manual checkout carries the same file when direct authority access is required. Unresolved pointers are not Surge tokens.

Verified 2026-11-15: saved login recovered from msi4090 ~/.netrc, Surge list authenticated, Natally v1.54.13274 published to natally.robin.mba. The default robinsai.world account is a different account; a denial under that login is not missing permission for the Shannon credential. Existing other-account credentials remain preserved in Admin-Manual.

No secret belongs in this repository, public source, logs or issues. Use this repository's existing release entry and configured domains; this credential reference does not authorize a domain change.

Association: this repository contains a configuration or architecture reference to natally.robin.mba. This record identifies the shared account for that domain and does not assert a new deployment of this repository.
