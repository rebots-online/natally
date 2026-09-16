//! natally — inference host, llama.cpp leg (task C.1, ARCHITECTURE §7.1).
//!
//! Compiled ONLY under the cargo feature `inference-llama` (declared and
//! documented in `super`/mod.rs). Per the C.1 architect ruling, the
//! `llama-cpp-2` dependency and the feature declaration land with I.2's
//! registry wiring — this file has therefore NOT been compiled by C.1 (no
//! crate in the tree by ruling; `cargo check` without features never reaches
//! this module). It is written against the `llama_cpp_2` 0.1.x API surface;
//! exact item paths / builder names are pinned when I.2 wires the dependency.
//!
//! # Turboquant law (§7.1) as implemented here
//!
//! - Weights: Q4_K_M catalogue tier — honoured by loading the artifact named
//!   by `model_ref` (M.1 storage path). Weight quantization is a property of
//!   the artifact, not a loader flag (mirrors the web leg in
//!   `apps/local/src/companion/inference-web.ts`).
//! - KV cache: q8_0 default, applied to BOTH the key and value caches via the
//!   context params (`with_type_k` / `with_type_v`); the optional q4r8
//!   recursor tier upgrades both. ggml has no literal `q4r8` KV type — the
//!   catalogue tier maps to q4_0 KV quantization here; the exact super-block
//!   refinement is settled when the crate is pinned (I.2).
//! - Streaming: greedy (deterministic) sampling, one `token` event per step on
//!   the §4 bus channel, in stream order — mirroring the web engine's delta
//!   stream.
//!
//! # Lifecycle
//!
//! The model lazy-loads exactly once into a process-wide cache (the expensive
//! part — mirrors the wllama handle's residency on the web leg) and is freed
//! by `super::inference_dispose`. A fresh `LlamaContext` (which owns the q8_0
//! KV cache) is built per completion; cross-turn KV reuse is reserved for the
//! recursor-tier follow-up. llama_cpp_2 documents `LlamaBackend`/`LlamaModel`
//! as Send+Sync (contexts are neither) — contexts never leave the blocking
//! task that created them.

use std::num::NonZeroU32;
use std::sync::{Mutex, OnceLock};

use tauri::Emitter;

use super::{
    ChatRole, InferencePayload, KvTier, QuantSpec, RecursorTier, TokenEventDto, WeightsTier,
    BUS_CHANNEL,
};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::ggml_type::GGMLType;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::{AddBos, LlamaModel, LlamaModelParams};
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::Special;

/// Companion context window until C.2 owns the fence budget law (§7.2).
/// Mirrors `CONTEXT_TOKENS` in inference-web.ts.
const CONTEXT_TOKENS: u32 = 4096;

/// Shared default completion budget (mirrors inference-web.ts).
const DEFAULT_MAX_TOKENS: u32 = 256;

fn fail(what: &str, error: impl std::fmt::Display) -> String {
    format!("natally inference: {what}: {error}")
}

fn weights_label(tier: WeightsTier) -> &'static str {
    match tier {
        WeightsTier::Q4KM => "Q4_K_M",
    }
}

/// §7.1 KV tier → ggml context-param type. q4r8 recursor tier overrides the
/// q8_0 default (see the module header for the tier-mapping note).
fn kv_ggml_type(quant: &QuantSpec) -> GGMLType {
    match (quant.kv, quant.recursor) {
        (KvTier::Q8_0, Some(RecursorTier::Q4R8)) => GGMLType::Q4_0,
        (KvTier::Q8_0, None) => GGMLType::Q8_0,
    }
}

fn context_params(payload: &InferencePayload) -> Result<LlamaContextParams, String> {
    let kv = kv_ggml_type(&payload.quant);
    let n_ctx = NonZeroU32::new(CONTEXT_TOKENS)
        .ok_or("natally inference: context window must be non-zero")?;
    Ok(LlamaContextParams::default()
        .with_n_ctx(Some(n_ctx))
        .with_type_k(kv)
        .with_type_v(kv))
}

/// Minimal renderer over the three-tier fence input (§7.2): C.2's fence hands
/// us the assembled tiers; this renders plain speaker lines (transcript
/// vocabulary: you/her). The model's embedded chat template routes through
/// llama_cpp_2's template API once the crate is pinned — this renderer is the
/// seam until then.
fn render_prompt(payload: &InferencePayload) -> String {
    let mut prompt = String::new();
    prompt.push_str(payload.system_prompt.trim_end());
    prompt.push('\n');
    for message in &payload.messages {
        let speaker = match message.role {
            ChatRole::User => "You",
            ChatRole::Assistant => "Her",
        };
        prompt.push_str(speaker);
        prompt.push_str(": ");
        prompt.push_str(message.content.trim_end());
        prompt.push('\n');
    }
    prompt.push_str("Her:");
    prompt
}

// ---------------------------------------------------------------------------
// Process-wide lazy model cache (the turboquant artifact loads once).
// ---------------------------------------------------------------------------

struct CachedModel {
    model: LlamaModel,
    model_ref: String,
}

static MODEL_CACHE: Mutex<Option<CachedModel>> = Mutex::new(None);

/// llama.cpp backend must be initialised once per process.
fn shared_backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
    if let Some(backend) = BACKEND.get() {
        return Ok(backend);
    }
    let backend = LlamaBackend::init().map_err(|e| fail("llama backend init", e))?;
    BACKEND
        .set(backend)
        .map_err(|_| "natally inference: llama backend raced initialisation".to_string())?;
    BACKEND
        .get()
        .ok_or_else(|| "natally inference: llama backend missing after init".to_string())
}

/// Lazy load (§7.1/M.1): ensures the turboquant artifact named by `model_ref`
/// is resident in the cache — loads on first use, reloads only when
/// `model_ref` changes. CPU params by default; device allowance (the recursor
/// tier's "when the device allows" gate) lands with the performance pass.
fn ensure_loaded(
    slot: &mut Option<CachedModel>,
    backend: &LlamaBackend,
    payload: &InferencePayload,
) -> Result<(), String> {
    let needs_load = match slot.as_ref() {
        Some(cached) => cached.model_ref != payload.model_ref,
        None => true,
    };
    if needs_load {
        let model =
            LlamaModel::new_from_file(backend, &payload.model_ref, LlamaModelParams::default())
                .map_err(|e| {
                    format!(
                        "natally inference: failed to load turboquant artifact {} ({} tier): {e}",
                        payload.model_ref,
                        weights_label(payload.quant.weights)
                    )
                })?;
        *slot = Some(CachedModel {
            model,
            model_ref: payload.model_ref.clone(),
        });
    }
    Ok(())
}

/// Frees the resident model (the `inference_dispose` command body).
pub(super) fn dispose() -> Result<(), String> {
    let mut slot = MODEL_CACHE
        .lock()
        .map_err(|_| "natally inference: model cache mutex poisoned".to_string())?;
    *slot = None; // dropping the LlamaModel frees it
    Ok(())
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/// Blocking body of `stream_complete` — never touches the async runtime with
/// the !Send context.
fn run(app: &tauri::AppHandle, payload: &InferencePayload) -> Result<(), String> {
    let backend = shared_backend()?;
    let mut slot = MODEL_CACHE
        .lock()
        .map_err(|_| "natally inference: model cache mutex poisoned".to_string())?;
    ensure_loaded(&mut slot, backend, payload)?;
    let Some(cached) = slot.as_ref() else {
        return Err("natally inference: model cache empty after load".into());
    };
    let model = &cached.model;

    let params = context_params(payload)?;
    let budget =
        usize::try_from(params.n_ctx()).map_err(|e| fail("context window", e))?;
    let mut ctx = model
        .new_context(backend, params)
        .map_err(|e| fail("context creation", e))?;

    let prompt = render_prompt(payload);
    let tokens = model
        .str_to_token(&prompt, AddBos::Always)
        .map_err(|e| fail("tokenize", e))?;
    if tokens.len() >= budget {
        return Err(
            "natally inference: the fence fills the context window — shorten the tiers (§7.2)"
                .into(),
        );
    }

    // Prefill the whole prompt; only the final prompt token asks for logits.
    let mut prompt_batch = LlamaBatch::new(tokens.len(), 1);
    for (index, token) in tokens.iter().enumerate() {
        let last = index + 1 == tokens.len();
        prompt_batch
            .add(*token, index as i32, &[0], last)
            .map_err(|e| fail("prefill batch", e))?;
    }
    ctx.decode(&mut prompt_batch).map_err(|e| fail("prefill decode", e))?;

    // Greedy sampler — deterministic companion output (same fence → same
    // tokens), no temperature lottery.
    let mut sampler = LlamaSampler::greedy();
    let max_new = usize::try_from(payload.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS))
        .map_err(|e| fail("maxTokens", e))?;
    let mut generated = 0usize;
    let mut pos = i32::try_from(tokens.len()).map_err(|e| fail("position", e))?;

    while generated < max_new {
        let token = match ctx.sample_token(&mut sampler) {
            Ok(Some(token)) => token,
            Ok(None) => break,
            Err(e) => return Err(fail("sampling", e)),
        };
        if model.is_eog_token(token) {
            break;
        }
        let piece = model
            .token_to_bytes(token, Special::Tokenize)
            .map_err(|e| fail("detokenize", e))?;
        let text = String::from_utf8_lossy(&piece).into_owned();
        if !text.is_empty() {
            app.emit(
                BUS_CHANNEL,
                TokenEventDto::token(&payload.turn_id, &text),
            )
            .map_err(|e| fail("token emit", e))?;
        }
        generated += 1;

        if generated < max_new {
            let mut step = LlamaBatch::new(1, 1);
            step.add(token, pos, &[0], true)
                .map_err(|e| fail("step batch", e))?;
            ctx.decode(&mut step).map_err(|e| fail("step decode", e))?;
            pos += 1;
        }
    }
    Ok(())
}

/// Async entry — runs the blocking generation on the blocking thread pool so
/// the !Send llama context never crosses an await on the runtime.
pub(super) async fn stream_complete(
    app: tauri::AppHandle,
    payload: InferencePayload,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run(&app, &payload))
        .await
        .map_err(|e| fail("generation task", e))?
}
