//! Native Tauri shell. Feature implementations live in independently registered plugins.

/// Defines a feature's real Tauri plugin initializer and command handler.
///
/// Put an entrypoint at `src/plugins/<name>.rs` or `src/plugins/<name>/mod.rs`.
/// It defines its `#[tauri::command]` functions (or imports a commands submodule)
/// and calls `crate::natally_plugin!("<name>", [command, commands::other_command]);`.
/// The literal plugin name must equal its file/directory name. `build.rs` discovers
/// these entrypoints, orders them by name, and registers them without editing this file.
/// Commands use Tauri's `plugin:<name>|<command>` invoke names.
///
/// A feature also provides `permissions/<name>/*.toml` and its own
/// `capabilities/<name>.json` to grant its commands to the appropriate windows.
/// The optional `setup = ...` hook initializes actual feature state through Tauri.
#[macro_export]
macro_rules! natally_plugin {
    ($name:literal, [$($command:path),* $(,)?] $(, setup = $setup:expr)? $(,)?) => {
        pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
            tauri::plugin::Builder::new($name)
                .invoke_handler(tauri::generate_handler![$($command),*])
                $(.setup($setup))?
                .build()
        }
    };
}

mod registry_generated;

/// Builds the shell with all statically discovered native feature plugins.
pub fn builder() -> tauri::Builder<tauri::Wry> {
    registry_generated::register(tauri::Builder::default())
}

/// Shared desktop and mobile application entrypoint.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    builder()
        .run(tauri::generate_context!())
        .expect("failed to run the native application");
}
