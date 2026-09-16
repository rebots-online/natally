//! natally — native embedding bridge (ARCHITECTURE §7.1, §8.1, §13).
//!
//! ⚠ THIS FILE IS A COMMENT-ONLY DESIGN STUB.
//!
//! It documents the llama.cpp embedding entry the Tauri side of the native legs
//! (Linux/Windows/Android, D8) exposes to the TypeScript lore pipeline. The
//! shipping Rust implementation belongs to C.1's lane (Tauri shell / native
//! bridge), which owns the workspace `Cargo.toml`; this crate's dependencies
//! (`tauri`, `llama_cpp` bindings) are not declared here yet, so — per the L.2
//! task block — this file carries the design as comments only. It is NOT a
//! mock of shipped TS code: the TypeScript seam (`embedder.ts`) is complete and
//! real; this document pins the native contract that will be adapted onto
//! `WllamaLike`.
//!
//! # Contract recap (normative, from §8.1 / §13 / embedder.ts)
//!
//! - Model: the mirror's embedder GGUF, kind `"embedder"` in
//!   `RobinsAIWorld/natally-models/manifest.json` (§13), sha256-verified at
//!   download, resident under the platform cache dir.
//! - Dim: `VITE_LORE_EMBED_DIM` from config (§8.1, default 384) must equal the
//!   loaded model's `n_embd`; a mismatch is a hard error (dim-mismatch), never
//!   truncated or padded.
//! - Output: raw (unnormalized) components; normalization happens at the TS
//!   seam (`l2Normalize`), so the bridge must NOT pre-normalize (single source
//!   of truth for the contract, and cheaper in the bridge).
//! - On-device only: the bridge touches no network; the GGUF is already local.
//!
//! # Planned command surface (C.1)
//!
//! ```ignore
//! /// Loaded state is per-process; the GGUF is mmapped once and kept resident
//! /// (the embedder is small; §12 performance mandates make re-load cost
//! /// unacceptable on the write-every-turn path, §8.3).
//! static EMBED_CTX: OnceLock<LlamaEmbedder> = OnceLock::new();
//!
//! #[derive(Serialize)]
//! #[serde(rename_all = "camelCase")]
//! pub struct EmbedResult {
//!     /// Raw components, len == n_embd. Bridge errors on n_embd != dim.
//!     pub embedding: Vec<f32>,
//! }
//!
//! /// The entry the TS side adapts onto `WllamaLike`:
//! ///   loadModel  → ensure_embedder_loaded (idempotent, cached)
//! ///   createEmbedding → lore_embed
//! #[tauri::command]
//! pub async fn ensure_embedder_loaded(
//!     state: State<'_, LoreState>,
//! ) -> Result<(), String> {
//!     // - resolve the embedder asset from the local mirror cache (§13),
//!     //   re-verifying sha256 if the file changed underneath us;
//!     // - llama_backend_init once; load with n_ctx >= 1 (embeddings only,
//!     //   no KV-cache tail), n_threads from device profile;
//!     // - assert model.n_embd() == state.embed_dim (VITE_LORE_EMBED_DIM);
//!     //   mismatch → Err("dim-mismatch: …").
//! }
//!
//! #[tauri::command]
//! pub async fn lore_embed(
//!     state: State<'_, LoreState>,
//!     text: String,
//! ) -> Result<EmbedResult, String> {
//!     // - ensure_embedder_loaded is implied (idempotent);
//!     // - tokenize + llama_tokenize; empty text short-circuits at the TS seam
//!     //   and must not reach here;
//!     // - decode with pooling = MEAN over the last non-pad sequence;
//!     // - return RAW components (do NOT normalize here — TS seam owns it);
//!     // - any backend failure → Err("embed-failed: …") (typed at the seam).
//! }
//! ```
//!
//! # Lane notes
//!
//! - Windows/Linux: in-process command as above. Android: same command via the
//!   Tauri plugin surface; GGUF stays in the app cache dir (D8).
//! - The web leg (PWA) bypasses this bridge entirely — wllama runs the same
//!   GGUF in-browser via onnxruntime-web/wasm-simd, adapted to `WllamaLike`
//!   directly (§7.1 "WASM (PWA)").
//! - Error strings here are transport plumbing only; the TS seam wraps them in
//!   `EmbedderError` with the canonical codes ("load-failed", "embed-failed",
//!   "dim-mismatch").
