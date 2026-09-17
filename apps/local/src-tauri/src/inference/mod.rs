//! C.1 native inference IPC. Parent registers these three commands and manages
//! InferenceHost::new(M.1_model_directory). No engine loads during app startup.
//! Required exact additions: llama-cpp-2 = =0.1.156, llama-cpp-sys-2 = =0.1.156,
//! encoding_rs = =0.8.35. The sys crate supplies the flash-attention enum constant.

pub mod llama;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{ipc::Channel, State};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InferenceParams {
    pub weights: String,
    pub cache_type_k: String,
    pub cache_type_v: String,
    pub recursor: String,
    pub context_size: u32,
    pub threads: i32,
}

impl InferenceParams {
    pub fn validate(&self) -> Result<(), String> {
        if self.weights != "Q4_K_M" || self.cache_type_k != "q8_0" || self.cache_type_v != "q8_0" {
            return Err("Inference requires atomic Q4_K_M weights and q8_0 K/V cache".into());
        }
        if self.recursor != "unsupported" {
            return Err("q4r8 recursor is unsupported by llama-cpp-2 0.1.156".into());
        }
        if !(32..=131072).contains(&self.context_size) || !(1..=256).contains(&self.threads) {
            return Err("Invalid inference context size or thread count".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FenceRole {
    System,
    User,
    Assistant,
}

impl FenceRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FenceMessage {
    pub role: FenceRole,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InferenceRequest {
    pub request_id: String,
    pub model_id: String,
    pub model_path: PathBuf,
    pub params: InferenceParams,
    pub messages: Vec<FenceMessage>,
    pub max_tokens: u32,
}

impl InferenceRequest {
    pub fn validate(&self) -> Result<(), String> {
        self.params.validate()?;
        if self.request_id.is_empty() || self.model_id.is_empty() || self.messages.is_empty() {
            return Err("Inference requires request/model identities and fenced messages".into());
        }
        if self.max_tokens == 0 || self.max_tokens >= self.params.context_size {
            return Err("maxTokens must be positive and smaller than the context".into());
        }
        if self
            .messages
            .iter()
            .any(|m| m.content.is_empty() || m.content.contains('\0'))
        {
            return Err("Inference requires nonempty fenced messages without NUL bytes".into());
        }
        Ok(())
    }
}

/// Token/error variants have the exact C.4 CompanionEvent wire shape.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InferenceEvent {
    Started,
    Ready,
    Token { token: String },
    Done,
    Error { message: String },
}

struct HostInner {
    model_root: PathBuf,
    engine: Mutex<llama::LlamaInference>,
    requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// One application-owned host; llama.cpp and its weights are lazily initialized.
pub struct InferenceHost(Arc<HostInner>);

impl InferenceHost {
    pub fn new(model_root: PathBuf) -> Self {
        Self(Arc::new(HostInner {
            model_root,
            engine: Mutex::new(llama::LlamaInference::default()),
            requests: Mutex::new(HashMap::new()),
        }))
    }
}

#[tauri::command]
pub async fn inference_complete(
    request: InferenceRequest,
    on_event: Channel<InferenceEvent>,
    host: State<'_, InferenceHost>,
) -> Result<(), String> {
    request.validate()?;
    let inner = Arc::clone(&host.inner().0);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut requests = inner
            .requests
            .lock()
            .map_err(|_| "Inference request lock poisoned")?;
        if requests.contains_key(&request.request_id) {
            return Err("Duplicate active inference request ID".into());
        }
        requests.insert(request.request_id.clone(), Arc::clone(&cancel));
    }
    let request_id = request.request_id.clone();
    let worker_inner = Arc::clone(&inner);
    let events = on_event.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        events
            .send(InferenceEvent::Started)
            .map_err(|e| e.to_string())?;
        let mut engine = worker_inner
            .engine
            .lock()
            .map_err(|_| "Inference engine lock poisoned")?;
        engine.complete(&worker_inner.model_root, &request, &cancel, |event| {
            events.send(event).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    inner
        .requests
        .lock()
        .map_err(|_| "Inference request lock poisoned")?
        .remove(&request_id);
    match result {
        Ok(()) => on_event
            .send(InferenceEvent::Done)
            .map_err(|e| e.to_string()),
        Err(message) => {
            let _ = on_event.send(InferenceEvent::Error {
                message: message.clone(),
            });
            Err(message)
        }
    }
}

#[tauri::command]
pub fn inference_cancel(request_id: String, host: State<'_, InferenceHost>) -> Result<(), String> {
    if let Some(cancel) = host
        .inner()
        .0
        .requests
        .lock()
        .map_err(|_| "Inference request lock poisoned")?
        .get(&request_id)
    {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn inference_unload(host: State<'_, InferenceHost>) -> Result<(), String> {
    let inner = Arc::clone(&host.inner().0);
    tauri::async_runtime::spawn_blocking(move || {
        inner
            .engine
            .lock()
            .map_err(|_| "Inference engine lock poisoned")?
            .unload();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
