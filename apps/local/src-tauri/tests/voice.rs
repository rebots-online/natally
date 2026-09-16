//! Compile/test vehicle for task V.1 (voice native, ARCHITECTURE §4/§10).
//!
//! `src/registry_generated.rs` is GENERATED and owned by task I.2, which is
//! what will declare `pub mod voice;` at the crate root. Until that wiring
//! lands, this harness `#[path]`-includes the voice module directly so the
//! V.1 Verify command —
//! `cargo test --manifest-path apps/local/src-tauri/Cargo.toml voice` —
//! compiles the un-gated core (chunking, RMS envelope, queue, DTO) and runs
//! its fixtures WITHOUT any feature and WITHOUT touching `lib.rs`,
//! `main.rs`, or `registry_generated.rs`.
//!
//! The `#[cfg(test)]` fixtures inside `src/voice/mod.rs` run from here
//! (cfg(test) is active in an integration target); once I.2 declares the
//! module at the crate root they run from the lib target instead and this
//! harness is redundant — retire it to `~/outbox/` then (never delete, I-0).
//!
//! `voice-kokoro` gated legs (`kokoro.rs`, `audio.rs`) stay uncompiled here:
//! no `ort`/`cpal` crate in the tree by ruling (V.1 architect ruling).

#![allow(dead_code, unused_imports)]

#[path = "../src/voice/mod.rs"]
mod voice;
