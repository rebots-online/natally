//! natally — inference host, native leg (task C.1, ARCHITECTURE §7.1):
//! the chat-turboquant llama.cpp lane over the static command registry.
//!
//! # Registration (house protocol — same shape as `lore_commands.rs`)
//!
//! `src/registry_generated.rs` is GENERATED and owned by task I.2. This module
//! never invokes `natally_plugin!`. I.2 joins it to the IPC surface by
//! declaring `pub mod inference;` at the crate root and listing
//! `inference::inference_complete, inference::inference_dispose` in the macro.
//! `lib.rs` and `main.rs` are never touched.
//!
//! # The `inference-llama` feature (architect ruling on C.1)
//!
//! `llama.rs` is real llama.cpp-binding code, gated behind the cargo feature
//! `inference-llama` (`#[cfg(feature = "inference-llama")] mod llama;` below).
//! Per the C.1 ruling, `Cargo.toml` is NOT touched here: the `llama-cpp-2`
//! dependency AND the `[features] inference-llama = ["dep:llama-cpp-2"]`
//! declaration land with I.2's registry wiring. Until then the default build
//! compiles this module with the gated code absent and `inference_complete`
//! answers with the honest-absence error — every `llama_cpp_2` import lives
//! behind the feature, so `cargo check` (no features) stays clean.
//!
//! # Turboquant law (§7.1)
//!
//! Atomic chat-turboquant: quantized weights (Q4_K_M default catalogue tier)
//! **and** KV-cache compression (q8_0 KV default; q4r8 recursor tier when the
//! device allows — the `recursor` flag), streamed token by token. The params
//! are mapped once in `apps/local/src/companion/lane.ts` and arrive here
//! already in this module's tier enums; serde rejects any unknown tier name.
//! Models lazy-load from M.1 storage (`model_ref` — the resolved path of the
//! Q4_K_M artifact from the frozen `RobinsAIWorld/natally-models` mirror; M.1
//! owns resolution/verification, this module owns loading, exactly once).
//!
//! # Wire contract
//!
//! Consumed by the companion's native lane (engine factory injected in
//! `lane.ts`; the actual invoke wiring is I.3's). camelCase serde, mirroring
//! `InferenceContext`/`TurboQuantParams` in lane.ts. Streamed tokens ride the
//! §4 bus channel [`BUS_CHANNEL`] (`companion:event`) as the `token` variant
//! of the `CompanionEvent` union (`@natally/lore/types`:
//! `{ type: "token", turnId, text }`); the bus re-publishes to
//! stage/transcript/voice — that wiring is I.3's, not this module's.

use serde::{Deserialize, Serialize};

/// §4 companion event bus channel; payload values are `CompanionEvent`s.
pub const BUS_CHANNEL: &str = "companion:event";

// ---------------------------------------------------------------------------
// Tier enums — turboquant law (§7.1) as serde-checked vocabulary.
// ---------------------------------------------------------------------------

/// Weight quantization tier. Q4_K_M is the (only, default) catalogue tier; the
/// artifact itself is selected by `model_ref`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum WeightsTier {
    #[serde(rename = "Q4_K_M")]
    Q4KM,
}

/// KV-cache compression tier: q8_0 default (§7.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum KvTier {
    #[serde(rename = "q8_0")]
    Q8_0,
}

/// Recursor tier — the optional §7.1 flag upgrading KV compression to q4r8
/// when the device allows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum RecursorTier {
    #[serde(rename = "q4r8")]
    Q4R8,
}

/// Chat-turboquant parameters, mirroring `TurboQuantParams` in lane.ts.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantSpec {
    pub weights: WeightsTier,
    pub kv: KvTier,
    pub recursor: Option<RecursorTier>,
}

// ---------------------------------------------------------------------------
// Wire DTOs — mirroring `InferenceContext` in lane.ts (camelCase).
// ---------------------------------------------------------------------------

/// Role of one fence message. Tool results (§7.3) are collapsed into the live
/// turn by the fence (C.2) before the call, so only user/assistant arrive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ChatRole {
    #[serde(rename = "user")]
    User,
    #[serde(rename = "assistant")]
    Assistant,
}

#[derive(Debug, Deserialize)]
pub struct InferenceMessage {
    pub role: ChatRole,
    pub content: String,
}

/// One completion request. `turn_id` labels every emitted `token` event;
/// `model_ref` is the M.1 storage path of the turboquant artifact.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferencePayload {
    pub turn_id: String,
    pub system_prompt: String,
    pub messages: Vec<InferenceMessage>,
    pub max_tokens: Option<u32>,
    pub model_ref: String,
    pub quant: QuantSpec,
}

/// The `token` variant of the §4 `CompanionEvent` union (`@natally/lore/types`):
/// `{ type: "token", turnId, text }`.
// Clone: tauri's `Emitter::emit` requires the payload `Serialize + Clone`
// (the token event is emitted per generated token on the §4 bus).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEventDto {
    #[serde(rename = "type")]
    event_type: &'static str,
    turn_id: String,
    text: String,
}

impl TokenEventDto {
    pub fn token(turn_id: &str, text: &str) -> Self {
        Self {
            event_type: EVENT_TYPE_TOKEN,
            turn_id: turn_id.to_string(),
            text: text.to_string(),
        }
    }
}

const EVENT_TYPE_TOKEN: &str = "token";

/// Honest validation before any engine work: a malformed request can never
/// reach the model or emit a malformed event.
fn validate(payload: &InferencePayload) -> Result<(), String> {
    if payload.turn_id.trim().is_empty() {
        return Err("natally inference: turnId must be non-empty (CompanionEvent contract)".into());
    }
    if payload.system_prompt.trim().is_empty() {
        return Err("natally inference: systemPrompt must be non-empty (persona law, D13)".into());
    }
    if payload.model_ref.trim().is_empty() {
        return Err("natally inference: modelRef must be non-empty (M.1 storage path)".into());
    }
    if payload.messages.is_empty() {
        return Err("natally inference: at least one message is required (the live turn, §7.2 tier 3)".into());
    }
    for (index, message) in payload.messages.iter().enumerate() {
        if message.content.trim().is_empty() {
            return Err(format!(
                "natally inference: message {index} has empty content"
            ));
        }
    }
    if payload.max_tokens == Some(0) {
        return Err("natally inference: maxTokens must be greater than zero".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands — registered by I.2 (see the module header).
// ---------------------------------------------------------------------------

/// Streams one completion on the native lane, emitting a `token` event on the
/// §4 bus per generated token (in stream order).
#[tauri::command]
pub async fn inference_complete(
    app: tauri::AppHandle,
    payload: InferencePayload,
) -> Result<(), String> {
    validate(&payload)?;

    #[cfg(feature = "inference-llama")]
    let outcome = llama::stream_complete(app, payload).await;

    #[cfg(not(feature = "inference-llama"))]
    let outcome: Result<(), String> = {
        let _ = app; // emission ownership arrives with the gated leg below
        Err("natally inference: the native llama.cpp leg is not compiled into this build — \
             the `inference-llama` feature (llama-cpp-2 crate + feature declaration) lands \
             with I.2's registry wiring (C.1 architect ruling)"
            .into())
    };

    outcome
}

/// Frees the resident turboquant model (feature-gated no-op otherwise).
#[tauri::command]
pub async fn inference_dispose() -> Result<(), String> {
    #[cfg(feature = "inference-llama")]
    let outcome = llama::dispose();

    #[cfg(not(feature = "inference-llama"))]
    let outcome: Result<(), String> = Ok(());

    outcome
}

// ---------------------------------------------------------------------------
// llama.cpp leg — compiled only under the `inference-llama` feature.
// ---------------------------------------------------------------------------

#[cfg(feature = "inference-llama")]
mod llama;
