//! natally — native license token storage design (ARCHITECTURE §9.3).
//!
//! ⚠ THIS FILE IS A COMMENT-ONLY DESIGN STUB.
//!
//! It pins the native half of B.3's storage seam: the OS-keychain storage the
//! desktop/mobile legs use in place of the web leg's IndexedDB+AES-GCM
//! envelope (`storage-web.ts`). Same file pattern and same ownership rule as
//! `packages/lore/src/embed/native.rs` and this directory's `verify.rs`: the
//! `keyring` crate is deliberately NOT a dependency of
//! `apps/local/src-tauri/Cargo.toml` (B.3 may not add deps), so the design
//! lives here as comments; C-phase (Tauri shell / native bridge) owns adding
//! `keyring = "3"` to the manifest and registering these commands in the
//! invoke_handler registry macro.
//!
//! # Contract recap (normative, from §9.3)
//!
//! - Exactly one license record per install, stored in the OS keychain under
//!   service `"natally"`, account `"license"`: the compact LicenseToken
//!   string, VERBATIM (the token is already Ed25519-verified content; the
//!   keychain is the confidentiality/at-rest layer, verification stays in
//!   `verify.rs` — the web leg's AES-GCM envelope has no native analogue).
//! - Values never logged, never serialized into crash reports; a missing or
//!   unreadable entry is "no license" (honest absence), not an error dialog.
//! - `clear` deletes the entry (per-install reset); the house never-delete
//!   rule governs repo artifacts, not the user's own license record.
//!
//! # Planned command surface (C.1 wiring)
//!
//! ```ignore
//! use keyring::Entry;
//!
//! const SERVICE: &str = "natally";
//! const ACCOUNT: &str = "license";
//!
//! fn entry() -> Result<Entry, String> {
//!     Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("keychain-entry: {e}"))
//! }
//!
//! /// Store or replace the license token. Idempotent overwrite (a re-deposit
//! /// after a bridge re-mint replaces the old token atomically enough for a
//! /// single-user desktop; no concurrent writer exists in-process).
//! #[tauri::command]
//! pub fn license_token_set(token: String) -> Result<(), String> {
//!     let entry = entry()?;
//!     entry.set_password(&token).map_err(|e| format!("keychain-set: {e}"))
//! }
//!
//! /// `Ok(None)` = no stored license (honest absence; caller treats exactly
//! /// like unlicensed). A keychain backend error is Err, distinguishable.
//! #[tauri::command]
//! pub fn license_token_get() -> Result<Option<String>, String> {
//!     let entry = entry()?;
//!     match entry.get_password() {
//!         Ok(token) => Ok(Some(token)),
//!         Err(keyring::Error::NoEntry) => Ok(None),
//!         Err(e) => Err(format!("keychain-get: {e}")),
//!     }
//! }
//!
//! /// Remove the record; absent-is-fine so reset flows are idempotent.
//! #[tauri::command]
//! pub fn license_token_clear() -> Result<(), String> {
//!     let entry = entry()?;
//!     match entry.delete_credential() {
//!         Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
//!         Err(e) => Err(format!("keychain-clear: {e}")),
//!     }
//! }
//! ```
//!
//! # Lane notes
//!
//! - `keyring = "3"` names the Linux keyutils / Secret Service, Windows
//!   Credential Manager, macOS Keychain and Android Keystore-backed backends
//!   behind one API — matching §9.3's "OS keychain (native)" without per-OS
//!   code on this side. Platform backend selection is C-phase build config.
//! - Registration: `apps/local/src-tauri/src/main.rs` adds the three commands
//!   to the `generate_handler!` registry macro alongside the lore commands —
//!   the "native command via registry macro" wording of the B.3 block.
//! - The web leg never reaches this file: `storage-web.ts` is complete and
//!   real for the PWA; this document only pins the native contract so the
//!   licensing task's storage seam can target both legs symmetrically.
