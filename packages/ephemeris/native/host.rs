//! P.3 native transport. The parent I2 integration mounts this module; it is not
//! automatically discovered as a plugin from this package path.
//!
//! Required direct dependencies: serde (derive), serde_json, tokio (sync).
//! Parent glue: a src/plugins/ephemeris.rs entrypoint, an async Tauri command that
//! awaits NativeHost::request, managed NativeHost state initialized in the
//! natally_plugin! setup hook, and matching permissions/capability grants.
//!
//! `engine::SwephEngine` implements the seam using the detached C source compiled
//! by this crate. The mounting application supplies its bundled table directory.
//! Construction, local integrity checks, calculations and destruction stay here
//! on the dedicated worker thread.

pub mod engine;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    io,
    panic::{catch_unwind, AssertUnwindSafe},
    thread,
};
use tokio::sync::{mpsc, oneshot};

const QUEUE_CAPACITY: usize = 64;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum RequestId {
    String(String),
    Number(u64),
}

impl RequestId {
    fn is_valid(&self) -> bool {
        match self {
            Self::String(value) => !value.is_empty(),
            Self::Number(value) => *value <= MAX_SAFE_INTEGER,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Request {
    pub id: RequestId,
    #[serde(flatten)]
    pub operation: Operation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "op",
    content = "params",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum Operation {
    Init(Map<String, Value>),
    Position {
        body: String,
        ut: f64,
    },
    Cusps {
        ut: f64,
        place: Value,
        system: String,
    },
    Aspects {
        a: Value,
        b: Value,
        orbs: Value,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HostError {
    pub name: String,
    pub message: String,
}

impl HostError {
    pub fn new(name: &str, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
        }
    }
}

/// The bool discriminator serializes exactly as the web protocol, not a string.
#[derive(Debug, Serialize)]
pub struct Response {
    pub id: Option<RequestId>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<HostError>,
}

impl Response {
    fn from_result(id: Option<RequestId>, result: Result<Value, HostError>) -> Self {
        match result {
            Ok(result) => Self {
                id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => Self {
                id,
                ok: false,
                result: None,
                error: Some(error),
            },
        }
    }
}

/// Implementations validate arguments/results against types.ts and honor seam.ts.
/// Methods may block: construction, initialization, calls AND drop all run on the
/// same dedicated OS thread. The engine intentionally has no Send/Sync bound,
/// permitting thread-affine JS/WASM runtimes. Only the factory crosses threads.
/// An adapter needing an async runtime must own and drive it on this thread.
pub trait NativeEphemerisEngine {
    fn init(&mut self, cfg: Map<String, Value>) -> Result<(), HostError>;
    fn position(&mut self, body: String, ut: f64) -> Result<Value, HostError>;
    fn cusps(&mut self, ut: f64, place: Value, system: String) -> Result<Value, HostError>;
    fn aspects(&mut self, a: Value, b: Value, orbs: Value) -> Result<Value, HostError>;
}

struct Envelope {
    request: Request,
    reply: oneshot::Sender<Response>,
}

#[derive(Clone)]
pub struct NativeHost {
    sender: mpsc::Sender<Envelope>,
}

impl NativeHost {
    pub fn spawn<F, E>(factory: F) -> io::Result<Self>
    where
        F: FnOnce() -> Result<E, HostError> + Send + 'static,
        E: NativeEphemerisEngine + 'static,
    {
        let (sender, mut receiver) = mpsc::channel::<Envelope>(QUEUE_CAPACITY);
        thread::Builder::new()
            .name("natally-ephemeris".into())
            .spawn(move || {
                let mut engine = catch_unwind(AssertUnwindSafe(factory)).unwrap_or_else(|_| {
                    Err(HostError::new(
                        "EnginePanic",
                        "Native engine construction panicked",
                    ))
                });
                let mut initialized = false;
                let mut poisoned = false;
                while let Some(envelope) = receiver.blocking_recv() {
                    // Cancellation before execution does not spend calculation time.
                    if envelope.reply.is_closed() {
                        continue;
                    }
                    let result = if poisoned {
                        Err(HostError::new(
                            "EnginePanic",
                            "Native engine panicked; recreate the host",
                        ))
                    } else {
                        let result = catch_unwind(AssertUnwindSafe(|| {
                            let engine = engine.as_mut().map_err(|error| error.clone())?;
                            match envelope.request.operation {
                                Operation::Init(cfg) => {
                                    // Failed re-init must not leave a misleading ready state.
                                    initialized = false;
                                    engine.init(cfg)?;
                                    initialized = true;
                                    Ok(Value::Null)
                                }
                                _ if !initialized => Err(HostError::new(
                                    "Error",
                                    "ephemeris host is not initialized; await init first",
                                )),
                                Operation::Position { body, ut } => engine.position(body, ut),
                                Operation::Cusps { ut, place, system } => {
                                    engine.cusps(ut, place, system)
                                }
                                Operation::Aspects { a, b, orbs } => engine.aspects(a, b, orbs),
                            }
                        }));
                        match result {
                            Ok(result) => result,
                            Err(_) => {
                                poisoned = true;
                                Err(HostError::new(
                                    "EnginePanic",
                                    "Native engine panicked; recreate the host",
                                ))
                            }
                        }
                    };
                    // A cancelled caller must never panic/kill the shared engine task.
                    let _ = envelope
                        .reply
                        .send(Response::from_result(Some(envelope.request.id), result));
                }
                // Dropping all handles closes mpsc; the engine is dropped here, never
                // in Tauri's UI/async command thread. No global engine mutex exists.
            })?;
        Ok(Self { sender })
    }

    pub async fn request(&self, request: Request) -> Response {
        let id = request.id.clone();
        if !id.is_valid() {
            return Response::from_result(
                None,
                Err(HostError::new("ProtocolError", "Invalid request ID")),
            );
        }
        let (reply, response) = oneshot::channel();
        // Bounded async send supplies backpressure without blocking Tauri's UI.
        if self.sender.send(Envelope { request, reply }).await.is_err() {
            return Response::from_result(
                Some(id),
                Err(HostError::new("HostClosed", "Native ephemeris host closed")),
            );
        }
        response.await.unwrap_or_else(|_| {
            Response::from_result(
                Some(id),
                Err(HostError::new(
                    "HostClosed",
                    "Native ephemeris host stopped before replying",
                )),
            )
        })
    }

    /// A Tauri command can accept Value and retain an ID even for malformed ops.
    pub async fn request_json(&self, input: Value) -> Response {
        let id = input
            .get("id")
            .cloned()
            .and_then(|id| serde_json::from_value::<RequestId>(id).ok())
            .filter(RequestId::is_valid);
        match serde_json::from_value(input) {
            Ok(request) => self.request(request).await,
            Err(error) => {
                Response::from_result(id, Err(HostError::new("ProtocolError", error.to_string())))
            }
        }
    }
}
