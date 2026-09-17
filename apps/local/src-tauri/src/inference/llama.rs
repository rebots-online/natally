use super::{InferenceEvent, InferenceParams, InferenceRequest};
use llama_cpp_2::{
    context::params::{KvCacheType, LlamaContextParams},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaChatMessage, LlamaModel},
    sampling::LlamaSampler,
};
use std::{
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

// llama.cpp permits one backend initialization per process. Keep its lifetime
// longer than every model, including after unload/reload or multiple host handles.
static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();

/// Other native llama.cpp lanes must share this process-wide initialization.
pub fn backend() -> Result<&'static LlamaBackend, String> {
    BACKEND
        .get_or_init(|| LlamaBackend::init().map_err(|e| e.to_string()))
        .as_ref()
        .map_err(Clone::clone)
}

pub fn turboquant_context_params(params: &InferenceParams) -> Result<LlamaContextParams, String> {
    params.validate()?;
    let batch = params.context_size.min(512);
    Ok(LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(params.context_size))
        .with_n_batch(batch)
        .with_n_ubatch(batch)
        .with_n_threads(params.threads)
        .with_n_threads_batch(params.threads)
        .with_type_k(KvCacheType::Q8_0)
        .with_type_v(KvCacheType::Q8_0)
        .with_flash_attention_policy(llama_cpp_sys_2::LLAMA_FLASH_ATTN_TYPE_ENABLED)
        .with_offload_kqv(false))
}

struct LoadedModel {
    id: String,
    path: PathBuf,
    model: LlamaModel,
}

#[derive(Default)]
pub struct LlamaInference {
    loaded: Option<LoadedModel>,
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("Inference cancelled".into())
    } else {
        Ok(())
    }
}

impl LlamaInference {
    pub fn unload(&mut self) {
        self.loaded = None;
    }

    pub fn complete(
        &mut self,
        model_root: &Path,
        request: &InferenceRequest,
        cancel: &AtomicBool,
        mut emit: impl FnMut(InferenceEvent) -> Result<(), String>,
    ) -> Result<(), String> {
        request.validate()?;
        check_cancel(cancel)?;
        // M.1 supplies the installed file. Reject paths outside its application-owned root.
        let root = model_root
            .canonicalize()
            .map_err(|e| format!("M.1 model root: {e}"))?;
        let path = request
            .model_path
            .canonicalize()
            .map_err(|e| format!("M.1 model file: {e}"))?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err("Inference GGUF must be an installed file inside M.1 storage".into());
        }
        let backend = backend()?;
        if !self
            .loaded
            .as_ref()
            .is_some_and(|m| m.id == request.model_id && m.path == path)
        {
            self.unload();
            // CPU is universally available and keeps q8_0 K/V independent of GPU kernels.
            let model = LlamaModel::load_from_file(
                backend,
                &path,
                &LlamaModelParams::default().with_n_gpu_layers(0),
            )
            .map_err(|e| e.to_string())?;
            if model
                .meta_val_str("general.file_type")
                .map_err(|e| e.to_string())?
                != "15"
            {
                return Err("Installed GGUF is not Q4_K_M (general.file_type must be 15)".into());
            }
            self.loaded = Some(LoadedModel {
                id: request.model_id.clone(),
                path,
                model,
            });
        }
        check_cancel(cancel)?;
        let model = &self
            .loaded
            .as_ref()
            .ok_or("Inference model did not load")?
            .model;
        // A fresh context keeps preceding candidates/personas out of this fenced turn.
        let mut ctx = model
            .new_context(backend, turboquant_context_params(&request.params)?)
            .map_err(|e| e.to_string())?;
        let messages = request
            .messages
            .iter()
            .map(|m| {
                LlamaChatMessage::new(m.role.as_str().into(), m.content.clone())
                    .map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let template = model.chat_template(None).map_err(|e| e.to_string())?;
        let prompt = model
            .apply_chat_template(&template, &messages, true)
            .map_err(|e| e.to_string())?;
        // The GGUF template owns BOS/special tokens; do not prepend another BOS.
        let tokens = model
            .str_to_token(&prompt, AddBos::Never)
            .map_err(|e| e.to_string())?;
        if tokens.is_empty() || tokens.len() + request.max_tokens as usize > ctx.n_ctx() as usize {
            return Err(
                "Fenced prompt plus output budget exceeds context; Tier 1 was not truncated".into(),
            );
        }
        emit(InferenceEvent::Ready)?;

        let batch_size = request.params.context_size.min(512) as usize;
        let mut batch = LlamaBatch::new(batch_size, 1);
        for (chunk_index, chunk) in tokens.chunks(batch_size).enumerate() {
            check_cancel(cancel)?;
            batch.clear();
            for (offset, token) in chunk.iter().enumerate() {
                let position = chunk_index * batch_size + offset;
                batch
                    .add(*token, position as i32, &[0], position + 1 == tokens.len())
                    .map_err(|e| e.to_string())?;
            }
            ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        }

        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .subsec_nanos();
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::temp(0.7),
            LlamaSampler::dist(seed),
        ]);
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut position = tokens.len();
        for _ in 0..request.max_tokens {
            check_cancel(cancel)?;
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            sampler.accept(token);
            if model.is_eog_token(token) {
                // Flush only at an actual end-of-generation boundary.
                let mut tail = String::with_capacity(8);
                let (_, _, malformed) = decoder.decode_to_string(&[], &mut tail, true);
                if malformed {
                    return Err("Inference ended with incomplete UTF-8".into());
                }
                if !tail.is_empty() {
                    emit(InferenceEvent::Token { token: tail })?;
                }
                return Ok(());
            }
            let piece = model
                .token_to_piece(token, &mut decoder, false, None)
                .map_err(|e| e.to_string())?;
            check_cancel(cancel)?;
            if !piece.is_empty() {
                emit(InferenceEvent::Token { token: piece })?;
            }
            batch.clear();
            batch
                .add(token, position as i32, &[0], true)
                .map_err(|e| e.to_string())?;
            ctx.decode(&mut batch).map_err(|e| e.to_string())?;
            position += 1;
        }
        Err("Inference reached its token limit before completing the fenced candidate".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turboquant_maps_native_context_without_loading_weights() {
        let mut params = InferenceParams {
            weights: "Q4_K_M".into(),
            cache_type_k: "q8_0".into(),
            cache_type_v: "q8_0".into(),
            recursor: "unsupported".into(),
            context_size: 4096,
            threads: 2,
        };
        let ctx = turboquant_context_params(&params).unwrap();
        assert_eq!(ctx.type_k(), KvCacheType::Q8_0);
        assert_eq!(ctx.type_v(), KvCacheType::Q8_0);
        assert_eq!(ctx.n_ctx().unwrap().get(), 4096);
        assert_eq!(
            ctx.flash_attention_policy(),
            llama_cpp_sys_2::LLAMA_FLASH_ATTN_TYPE_ENABLED
        );
        params.recursor = "q4r8".into();
        assert!(turboquant_context_params(&params)
            .unwrap_err()
            .contains("unsupported"));
        params.recursor = "unsupported".into();
        params.cache_type_v = "f16".into();
        assert!(turboquant_context_params(&params).is_err());
    }
}
