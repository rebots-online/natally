// natally static command registry — GENERATED FILE.
//
// Owned by task I.2 (⛓ integrator), which regenerates this file whenever the
// set of `natally_plugin!` command modules under src-tauri changes. Re-running
// the regeneration from the same module set yields this file identically.
//
// NOTE: plain `//` comments only — this file is pulled in via `include!`,
// and macro expansions may not contain inner doc comments (`//!`).
//
// Regeneration contract (full text in `src/lib.rs`):
// - declare feature modules at crate root with `pub mod ...;`
// - invoke `natally_plugin!` exactly once with the complete list of
//   `#[tauri::command]` fn paths
// - `lib.rs` and `main.rs` are never touched.
//
// Inventory at generation time (I.2, branch sync/msi4090-d10-arch-paywall):
// registered = lore_commands (L.1), inference (C.1), voice (V.1);
// absent = keychain, mirror-cache (B.3/native storage seams — see the
// commented placeholders below; regeneration picks them up when they land).

// -- Registered command modules (present under src/) -------------------------

pub mod lore_commands; // L.1 — LoreStore native commands over rusqlite (§8)
pub mod inference; // C.1 — chat-turboquant llama.cpp lane (§7.1); gated leg behind `inference-llama`
pub mod voice; // V.1 — voice subsystem (§4/§10); gated legs behind `voice-kokoro`

// -- Absent command modules — commented placeholders, not compiled ----------

// PLACEHOLDER (B.3, native storage seam — module not yet on disk):
//   pub mod keychain_commands; // OS keychain access, LicenseToken storage (§9.3)
// ...with its `#[tauri::command]` fns appended to the `natally_plugin!` list
// below as `keychain_commands::<fn>` once the module lands.

// PLACEHOLDER (B.3, native storage seam — module not yet on disk):
//   pub mod mirror_cache; // RobinsAIWorld/natally-models mirror cache (§13)
// ...with its `#[tauri::command]` fns appended to the `natally_plugin!` list
// below as `mirror_cache::<fn>` once the module lands.

// -- The registry ------------------------------------------------------------

natally_plugin!(
    lore_commands::lore_upsert_turn,
    lore_commands::lore_query,
    lore_commands::lore_export,
    lore_commands::lore_delete_all,
    lore_commands::lore_stats,
    inference::inference_complete,
    inference::inference_dispose,
    voice::voice_set_mute,
    voice::voice_mute_state,
);
