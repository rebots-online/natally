//! L.2 llama.cpp bridge. Parent includes this module, manages Arc<LoreEmbedderState>,
//! and registers lore_embed. Configuration uses verified mirror storage, never a
//! caller-supplied filesystem path. API references and wiring are in SDK.md.

use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use llama_cpp_2::context::params::{LlamaContextParams, LlamaPoolingType};
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};

pub struct NativeEmbedderConfig {
    pub model_path: PathBuf,
    /// Pass the same resolved VITE_LORE_EMBED_DIM as the client (default 384).
    pub dim: usize,
    /// Same token budget as WebEmbedderOptions.contextSize (default 512).
    pub context_size: NonZeroU32,
}

pub struct LoreEmbedderState {
    // Fields drop in declaration order: model must outlive contexts and precede
    // the backend's destruction. The app shares its one initialized backend.
    model: Mutex<Option<LlamaModel>>,
    backend: Arc<LlamaBackend>,
    config: NativeEmbedderConfig,
}

impl LoreEmbedderState {
    pub fn new(backend: Arc<LlamaBackend>, config: NativeEmbedderConfig) -> Result<Self, String> {
        if config.dim == 0 || config.dim > i32::MAX as usize {
            return Err("Embedding dimension must be a positive 32-bit integer".into());
        }
        if config.context_size.get() > i32::MAX as u32 {
            return Err("Embedding context size exceeds the llama.cpp batch limit".into());
        }
        if !config.model_path.is_absolute() {
            return Err("Embedding model must have an absolute mirror storage path".into());
        }
        Ok(Self {
            model: Mutex::new(None),
            backend,
            config,
        })
    }

    pub fn embed(&self, text: &str, dim: usize) -> Result<Vec<f64>, String> {
        if dim != self.config.dim {
            return Err(format!(
                "Embedding dimension mismatch: configured {}, requested {dim}",
                self.config.dim
            ));
        }
        if text.trim().is_empty() || text.contains('\0') {
            return Err("Embedding text must be non-empty and contain no NUL".into());
        }
        let mut model_slot = self
            .model
            .lock()
            .map_err(|_| "Embedding model lock poisoned")?;
        if model_slot.is_none() {
            let model = LlamaModel::load_from_file(
                &self.backend,
                &self.config.model_path,
                &LlamaModelParams::default().with_n_gpu_layers(0),
            )
            .map_err(|error| format!("Loading mirror embedding GGUF failed: {error}"))?;
            if usize::try_from(model.n_embd_out()).ok() != Some(dim) {
                return Err(format!(
                    "Embedding dimension mismatch: expected {dim}, model outputs {}",
                    model.n_embd_out()
                ));
            }
            *model_slot = Some(model);
        }
        let model = model_slot.as_ref().ok_or("Embedding model not loaded")?;
        // AddBos::Always enables the GGUF tokenizer's model-defined special tokens.
        let tokens = model
            .str_to_token(text, AddBos::Always)
            .map_err(|error| format!("Embedding tokenization failed: {error}"))?;
        let n_ctx = self.config.context_size.get().min(model.n_ctx_train());
        if tokens.is_empty() || tokens.len() > n_ctx as usize {
            return Err(format!(
                "Embedding input has {} tokens; supported range is 1..={n_ctx}",
                tokens.len()
            ));
        }
        // A fresh context prevents one request's tokens from contaminating another.
        // The large GGUF remains cached, and the mutex bounds inference concurrency.
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(n_ctx))
            .with_n_batch(n_ctx)
            .with_n_ubatch(n_ctx)
            .with_embeddings(true)
            .with_pooling_type(LlamaPoolingType::Mean);
        let mut context = model
            .new_context(&self.backend, params)
            .map_err(|error| format!("Embedding context creation failed: {error}"))?;
        let mut batch = LlamaBatch::new(tokens.len(), 1);
        batch
            .add_sequence(&tokens, 0, false)
            .map_err(|error| format!("Embedding batch creation failed: {error}"))?;
        context
            .decode(&mut batch)
            .map_err(|error| format!("llama.cpp embedding inference failed: {error}"))?;
        let embedding = context
            .embeddings_seq_ith(0)
            .map_err(|error| format!("Reading pooled embedding failed: {error}"))?;
        normalize(embedding, dim)
    }
}

fn normalize(input: &[f32], dim: usize) -> Result<Vec<f64>, String> {
    if input.len() != dim {
        return Err(format!(
            "Embedding dimension mismatch: expected {dim}, got {}",
            input.len()
        ));
    }
    if input.iter().any(|value| !value.is_finite()) {
        return Err("Embedding contains non-finite values".into());
    }
    // f64 accumulation also keeps squared subnormal f32 values representable.
    let norm = input
        .iter()
        .map(|&value| f64::from(value).powi(2))
        .sum::<f64>()
        .sqrt();
    if norm == 0.0 {
        return Err("Cannot normalize a zero embedding".into());
    }
    Ok(input.iter().map(|&value| f64::from(value) / norm).collect())
}

#[tauri::command]
pub async fn lore_embed(
    text: String,
    dim: usize,
    state: tauri::State<'_, Arc<LoreEmbedderState>>,
) -> Result<Vec<f64>, String> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || state.embed(&text, dim))
        .await
        .map_err(|error| format!("Embedding worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn dimensions_and_normalization() {
        assert_eq!(normalize(&[3.0, 4.0], 2).unwrap(), vec![0.6, 0.8]);
        assert!(normalize(&[3.0, 4.0], 3).is_err());
        for values in [[f32::MAX, f32::MAX], [f32::MIN_POSITIVE, f32::MIN_POSITIVE]] {
            let vector = normalize(&values, 2).unwrap();
            let norm = vector.iter().map(|value| value * value).sum::<f64>().sqrt();
            assert!((norm - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn invalid_vectors_fail() {
        for values in [[0.0, 0.0], [f32::NAN, 1.0], [f32::INFINITY, 1.0]] {
            assert!(normalize(&values, 2).is_err());
        }
    }
}
