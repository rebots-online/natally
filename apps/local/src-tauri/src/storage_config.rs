//! SS.1 — Build-time storage-scope config, Rust side (architecture §19.1).
//!
//! Reads the same generated file as the TypeScript side
//! (`config/asset-storage.generated.json`, produced by
//! `scripts/generate-storage-config.mjs`). The scope is a public frozen
//! constant baked at build time — never a secret, never an entitlement, never
//! a Settings switch.
//!
//! Rebuild wiring: the crate's existing `build.rs` carries
//! `cargo:rerun-if-changed=config/asset-storage.generated.json` so cargo
//! recompiles when the scope is regenerated.

/// Baked-in storage scope selected at build time.
pub fn storage_scope() -> &'static str {
    pub const CONFIG: &str = include_str!("../../../../config/asset-storage.generated.json");
    static SCOPE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SCOPE
        .get_or_init(|| {
            let value: serde_json::Value =
                serde_json::from_str(CONFIG).expect("asset-storage.generated.json is valid JSON");
            value
                .get("scope")
                .and_then(|s| s.as_str())
                .expect("asset-storage.generated.json has a string scope")
                .to_owned()
        })
        .as_str()
}
