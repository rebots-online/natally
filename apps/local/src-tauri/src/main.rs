// Prevents an extra console window on Windows in release builds; harmless on
// the other desktop targets.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Builder function emitted by `natally_plugin!` from the generated
    // registry — see the contract in `src/lib.rs` (task T0.3).
    natally_lib::run()
}
