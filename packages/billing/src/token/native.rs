//! Parent assembly: expose this module from src/plugins/license.rs, forward init,
//! and manage NativeTokenStorage during setup. T0.3 discovers that entrypoint.
//! Supply permissions/capability entries for plugin:license|license_* commands.
//! Dependencies beyond verify.rs: tauri 2, keyring 3.6 with real platform features,
//! aes-gcm 0.10, sha2 0.10, zeroize 1. No platform's default mock keyring is acceptable.
//! Encrypted-file initialization requires a securely provisioned 32-byte wrapping key;
//! never persist it alongside ciphertext, derive it from public config, or send it to JS.

#[path = "verify.rs"]
pub mod verify;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use verify::{
    decode_license_public_key, verify_license_token, LicenseTokenPayload, SignedDenyList,
};
use zeroize::Zeroizing;

enum Backend {
    Keychain {
        service: String,
    },
    EncryptedFile {
        directory: PathBuf,
        key: Zeroizing<[u8; 32]>,
    },
}

pub struct NativeTokenStorage {
    backend: Backend,
    key: ed25519_dalek::VerifyingKey,
    lock: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub backend: &'static str,
    pub disclosure: &'static str,
}

fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| "invalid-clock".into())
}

fn file_name(context: &str) -> String {
    let hash = Sha256::digest(context.as_bytes());
    let hex: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("license-{hex}.enc")
}

impl NativeTokenStorage {
    pub fn keychain(service: String) -> Result<Self, String> {
        if service.is_empty() {
            return Err("keychain-service-required".into());
        }
        Ok(Self {
            backend: Backend::Keychain { service },
            key: Self::baked_key()?,
            lock: Mutex::new(()),
        })
    }

    pub fn encrypted_file(
        directory: PathBuf,
        wrapping_key: Zeroizing<[u8; 32]>,
    ) -> Result<Self, String> {
        if wrapping_key.iter().all(|byte| *byte == 0) || !directory.is_absolute() {
            return Err("secure-wrapping-key-and-app-data-path-required".into());
        }
        let key = Self::baked_key()?;
        fs::create_dir_all(&directory).map_err(|_| "encrypted-storage-create-failed")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| "encrypted-storage-permissions-failed")?;
        }
        Ok(Self {
            backend: Backend::EncryptedFile {
                directory,
                key: wrapping_key,
            },
            key,
            lock: Mutex::new(()),
        })
    }

    fn baked_key() -> Result<ed25519_dalek::VerifyingKey, String> {
        decode_license_public_key(
            option_env!("VITE_LICENSE_PUBKEY").ok_or("license-key-unconfigured")?,
        )
    }

    pub fn status(&self) -> StorageStatus {
        match &self.backend {
            Backend::Keychain { .. } => StorageStatus { backend: "os-keychain", disclosure: "License data is stored in the operating system keychain." },
            Backend::EncryptedFile { .. } => StorageStatus { backend: "encrypted-app-data", disclosure: "No operating system keychain is available. License data is stored in an encrypted app-data file." },
        }
    }

    fn read(&self, context: &str) -> Result<Option<Zeroizing<String>>, String> {
        match &self.backend {
            Backend::Keychain { service } => {
                let entry =
                    keyring::Entry::new(service, context).map_err(|_| "keychain-unavailable")?;
                match entry.get_password() {
                    Ok(value) => Ok(Some(Zeroizing::new(value))),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(_) => Err("keychain-read-failed".into()),
                }
            }
            Backend::EncryptedFile { directory, key } => {
                let bytes = match fs::read(directory.join(file_name(context))) {
                    Ok(bytes) => bytes,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(_) => return Err("encrypted-storage-read-failed".into()),
                };
                if bytes.len() < 4 + 12 + 16 || &bytes[..4] != b"NTL1" {
                    return Err("invalid-storage-envelope".into());
                }
                let cipher =
                    Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "invalid-wrapping-key")?;
                let plaintext = Zeroizing::new(
                    cipher
                        .decrypt(
                            Nonce::from_slice(&bytes[4..16]),
                            Payload {
                                msg: &bytes[16..],
                                aad: context.as_bytes(),
                            },
                        )
                        .map_err(|_| "storage-authentication-failed")?,
                );
                let text = std::str::from_utf8(&plaintext).map_err(|_| "invalid-storage-utf8")?;
                Ok(Some(Zeroizing::new(text.to_owned())))
            }
        }
    }

    fn write(&self, context: &str, value: Option<&str>) -> Result<(), String> {
        match &self.backend {
            Backend::Keychain { service } => {
                let entry =
                    keyring::Entry::new(service, context).map_err(|_| "keychain-unavailable")?;
                if let Some(value) = value {
                    entry
                        .set_password(value)
                        .map_err(|_| "keychain-write-failed".into())
                } else {
                    match entry.delete_credential() {
                        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                        Err(_) => Err("keychain-clear-failed".into()),
                    }
                }
            }
            Backend::EncryptedFile { directory, key } => {
                let path = directory.join(file_name(context));
                let Some(value) = value else {
                    return match fs::remove_file(path) {
                        Ok(()) => Ok(()),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                        Err(_) => Err("encrypted-storage-clear-failed".into()),
                    };
                };
                let cipher =
                    Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "invalid-wrapping-key")?;
                let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
                let encrypted = cipher
                    .encrypt(
                        &nonce,
                        Payload {
                            msg: value.as_bytes(),
                            aad: context.as_bytes(),
                        },
                    )
                    .map_err(|_| "storage-encryption-failed")?;
                let suffix: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
                let staging = directory.join(format!("STAGING_license-{suffix}.enc"));
                let mut options = OpenOptions::new();
                options.create_new(true).write(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options
                    .open(&staging)
                    .map_err(|_| "encrypted-storage-write-failed")?;
                file.write_all(b"NTL1")
                    .and_then(|_| file.write_all(&nonce))
                    .and_then(|_| file.write_all(&encrypted))
                    .and_then(|_| file.sync_all())
                    .map_err(|_| "encrypted-storage-write-failed")?;
                drop(file);
                fs::rename(&staging, &path).map_err(|_| "encrypted-storage-commit-failed")?;
                #[cfg(unix)]
                fs::File::open(directory)
                    .and_then(|dir| dir.sync_all())
                    .map_err(|_| "encrypted-storage-sync-failed")?;
                Ok(())
            }
        }
    }

    pub fn load(&self, app_user_id: &str) -> Result<Option<String>, String> {
        let _guard = self.lock.lock().map_err(|_| "storage-lock-failed")?;
        let value = self.read(&format!("natally-license:v1:token:{app_user_id}"))?;
        if let Some(token) = value {
            verify_license_token(&token, app_user_id, &self.key, now()?, false, None)?;
            Ok(Some(token.to_string()))
        } else {
            Ok(None)
        }
    }

    pub fn store(&self, token: &str, app_user_id: &str) -> Result<(), String> {
        verify_license_token(token, app_user_id, &self.key, now()?, false, None)?;
        let _guard = self.lock.lock().map_err(|_| "storage-lock-failed")?;
        self.write(
            &format!("natally-license:v1:token:{app_user_id}"),
            Some(token),
        )
    }
}

#[tauri::command]
pub fn license_token_load(
    storage: tauri::State<'_, NativeTokenStorage>,
    app_user_id: String,
) -> Result<Option<String>, String> {
    storage.load(&app_user_id)
}

#[tauri::command]
pub fn license_token_store(
    storage: tauri::State<'_, NativeTokenStorage>,
    token: String,
    app_user_id: String,
) -> Result<(), String> {
    storage.store(&token, &app_user_id)
}

#[tauri::command]
pub fn license_token_clear(
    storage: tauri::State<'_, NativeTokenStorage>,
    app_user_id: String,
) -> Result<(), String> {
    let _guard = storage.lock.lock().map_err(|_| "storage-lock-failed")?;
    storage.write(&format!("natally-license:v1:token:{app_user_id}"), None)
}

#[tauri::command]
pub fn license_storage_status(storage: tauri::State<'_, NativeTokenStorage>) -> StorageStatus {
    storage.status()
}

#[tauri::command]
pub fn license_token_verify(
    storage: tauri::State<'_, NativeTokenStorage>,
    token: String,
    app_user_id: String,
    online: bool,
    deny_list: Option<SignedDenyList>,
) -> Result<LicenseTokenPayload, String> {
    verify_license_token(
        &token,
        &app_user_id,
        &storage.key,
        now()?,
        online,
        deny_list.as_ref(),
    )
}

#[tauri::command]
pub fn license_deny_list_load(
    storage: tauri::State<'_, NativeTokenStorage>,
) -> Result<Option<SignedDenyList>, String> {
    let _guard = storage.lock.lock().map_err(|_| "storage-lock-failed")?;
    let Some(value) = storage.read("natally-license:v1:deny-list")? else {
        return Ok(None);
    };
    let signed: SignedDenyList = serde_json::from_str(&value).map_err(|_| "invalid-deny-list")?;
    verify::verify_signed_deny_list(&signed, &storage.key, now()?)?;
    Ok(Some(signed))
}

#[tauri::command]
pub fn license_deny_list_store(
    storage: tauri::State<'_, NativeTokenStorage>,
    signed: SignedDenyList,
) -> Result<(), String> {
    let list = verify::verify_signed_deny_list(&signed, &storage.key, now()?)?;
    if now()?.saturating_sub(list.issued_at) >= verify::DENY_LIST_MAX_AGE {
        return Err("stale-deny-list".into());
    }
    let _guard = storage.lock.lock().map_err(|_| "storage-lock-failed")?;
    if let Some(old) = storage.read("natally-license:v1:deny-list")? {
        let old: SignedDenyList = serde_json::from_str(&old).map_err(|_| "invalid-deny-list")?;
        verify::verify_signed_deny_list(&old, &storage.key, now()?)?;
        if list.issued_at < old.payload.issued_at
            || (list.issued_at == old.payload.issued_at
                && serde_json::to_vec(&list).map_err(|_| "invalid-deny-list")?
                    != serde_json::to_vec(&old.payload).map_err(|_| "invalid-deny-list")?)
        {
            return Err("deny-list-rollback".into());
        }
    }
    let value = serde_json::to_string(&signed).map_err(|_| "invalid-deny-list")?;
    storage.write("natally-license:v1:deny-list", Some(&value))
}

crate::natally_plugin!(
    "license",
    [
        license_token_load,
        license_token_store,
        license_token_clear,
        license_storage_status,
        license_token_verify,
        license_deny_list_load,
        license_deny_list_store
    ]
);
