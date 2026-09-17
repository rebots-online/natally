// I.2: build.rs regenerates the ordered plugin module list from src/plugins.
// Keep the generated machine-specific paths in OUT_DIR, not in Git.
include!(concat!(env!("OUT_DIR"), "/natally_plugin_registry.rs"));
