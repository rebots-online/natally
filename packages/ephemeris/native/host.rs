//! Ephemeris host — native leg (task P.3, ARCHITECTURE §4).
//!
//! A tokio `mpsc`-served task speaking the SAME JSON host protocol as
//! `src/host/protocol.ts`: request `{id, op, params}` in, response
//! `{id, ok, result|error}` out. Requests and replies cross the channel
//! boundary as raw protocol JSON strings, so the web worker and this task are
//! interchangeable hosts behind one contract.
//!
//! The Tauri command registry (task I.2) mounts `serve(rx, engine)`; this
//! crate is deliberately standalone (its own Cargo.toml, detached from the
//! apps/local/src-tauri crate root) and carries the protocol-loop unit tests
//! against a synthetic, injectable engine.

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

/// One request crossing the channel boundary: the raw protocol JSON payload
/// plus the reply path for the raw protocol JSON response.
pub struct HostEnvelope {
    pub payload: String,
    pub reply: oneshot::Sender<String>,
}

/// Wire shell of a protocol request (`src/host/protocol.ts` is normative).
/// Params stay at the JSON boundary: the zod schemas in protocol.ts are the
/// normative param contracts, and a concrete engine parses exactly the fields
/// it serves. An absent `params` arrives as `Null` (serde default).
#[derive(Debug, Clone, Deserialize)]
pub struct HostRequest {
    pub id: String,
    pub op: String,
    #[serde(default)]
    pub params: Value,
}

/// The engine the host serves. Sync by contract: the served task performs one
/// op at a time off the UI thread (§4); a real backend (native Swiss
/// Ephemeris build) plugs in behind this trait without touching the loop.
pub trait HostEngine {
    fn init(&mut self, params: &Value) -> Result<Value, String>;
    fn position(&self, params: &Value) -> Result<Value, String>;
    fn cusps(&self, params: &Value) -> Result<Value, String>;
    fn aspects(&self, params: &Value) -> Result<Value, String>;
}

/// Handle one raw protocol request against the engine. Infallible: every
/// failure path — undecodable payload, unknown op, engine error — comes back
/// as `{id, ok: false, error}` per the protocol.
pub fn handle<E: HostEngine>(engine: &mut E, payload: &str) -> String {
    let request: HostRequest = match serde_json::from_str(payload) {
        Ok(request) => request,
        Err(error) => {
            return error_response("unknown", &format!("protocol: undecodable request: {error}"))
        }
    };
    let outcome = match request.op.as_str() {
        "init" => engine.init(&request.params),
        "position" => engine.position(&request.params),
        "cusps" => engine.cusps(&request.params),
        "aspects" => engine.aspects(&request.params),
        other => Err(format!("protocol: unknown op \"{other}\"")),
    };
    match outcome {
        Ok(result) => json!({ "id": request.id, "ok": true, "result": result }).to_string(),
        Err(error) => error_response(&request.id, &error),
    }
}

fn error_response(id: &str, error: &str) -> String {
    json!({ "id": id, "ok": false, "error": error }).to_string()
}

/// The served task: pull envelopes until the channel closes and answer each
/// one on its reply path. Mounted by the Tauri command registry (I.2).
pub async fn serve<E: HostEngine>(mut rx: mpsc::Receiver<HostEnvelope>, mut engine: E) {
    while let Some(envelope) = rx.recv().await {
        let response = handle(&mut engine, &envelope.payload);
        // A dropped reply path only means the caller went away; keep serving.
        let _ = envelope.reply.send(response);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Synthetic engine (task notes: synthetic impl in tests, real injectable).
    /// Serves canned values after a completed init; refuses ops before it.
    struct FakeEngine {
        initialized: bool,
    }

    impl FakeEngine {
        fn new() -> Self {
            Self { initialized: false }
        }

        fn refuse_uninitialized(&self) -> Result<(), String> {
            if self.initialized {
                Ok(())
            } else {
                Err("engine not initialized".to_string())
            }
        }
    }

    impl HostEngine for FakeEngine {
        fn init(&mut self, params: &Value) -> Result<Value, String> {
            self.initialized = true;
            let moshier = params.get("moshier").and_then(Value::as_bool).unwrap_or(false);
            Ok(json!({ "engine": "fake-host-engine", "moshier": moshier }))
        }

        fn position(&self, _params: &Value) -> Result<Value, String> {
            self.refuse_uninitialized()?;
            Ok(json!({ "lon": 42.0, "lat": 0.0, "speed": 1.0 }))
        }

        fn cusps(&self, _params: &Value) -> Result<Value, String> {
            self.refuse_uninitialized()?;
            Ok(json!({
                "cusps": [10.0, 40.0, 70.0, 100.0, 130.0, 160.0, 190.0, 220.0, 250.0, 280.0, 310.0, 340.0],
                "asc": 10.0,
                "mc": 70.0,
                "armc": 68.0,
            }))
        }

        fn aspects(&self, _params: &Value) -> Result<Value, String> {
            self.refuse_uninitialized()?;
            Ok(json!([]))
        }
    }

    #[test]
    fn host_protocol_loop_init_then_cusps_roundtrip() {
        let mut engine = FakeEngine::new();

        let raw = handle(
            &mut engine,
            r#"{"id":"i1","op":"init","params":{"tablesUrl":"native-test","moshier":true}}"#,
        );
        let init: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(init["id"], "i1");
        assert_eq!(init["ok"], true);
        assert_eq!(init["result"]["engine"], "fake-host-engine");
        assert_eq!(init["result"]["moshier"], true);

        let raw = handle(
            &mut engine,
            r#"{"id":"c1","op":"cusps","params":{"ut":2448014.105555556,"place":{"lat":55.6,"lon":13.0},"system":"P"}}"#,
        );
        let cusps: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(cusps["id"], "c1");
        assert_eq!(cusps["ok"], true);
        assert_eq!(cusps["result"]["cusps"].as_array().map(Vec::len), Some(12));
        assert_eq!(cusps["result"]["asc"], 10.0);
        assert_eq!(cusps["result"]["mc"], 70.0);
    }

    #[test]
    fn host_unknown_op_yields_error_response_with_echoed_id() {
        let mut engine = FakeEngine::new();
        let raw = handle(&mut engine, r#"{"id":"b1","op":"bogus","params":{}}"#);
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["id"], "b1");
        assert_eq!(response["ok"], false);
        let error = response["error"].as_str().unwrap();
        assert!(error.contains("unknown op"), "unexpected error: {error}");
    }

    #[test]
    fn host_undecodable_payload_yields_unknown_id_error() {
        let mut engine = FakeEngine::new();
        let raw = handle(&mut engine, "not json at all");
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["id"], "unknown");
        assert_eq!(response["ok"], false);
        assert!(response["error"].as_str().unwrap().contains("undecodable"));
    }

    #[test]
    fn host_engine_error_yields_error_response() {
        let mut engine = FakeEngine::new();
        // cusps before init ⇒ engine refusal surfaces as {ok: false, error}.
        let raw = handle(&mut engine, r#"{"id":"e1","op":"cusps","params":{}}"#);
        let response: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(response["id"], "e1");
        assert_eq!(response["ok"], false);
        assert!(response["error"].as_str().unwrap().contains("not initialized"));
    }

    #[tokio::test]
    async fn host_serve_roundtrips_over_mpsc_channel() {
        let (tx, rx) = mpsc::channel::<HostEnvelope>(8);
        tokio::spawn(serve(rx, FakeEngine::new()));

        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(HostEnvelope {
            payload: r#"{"id":"s1","op":"init","params":{"moshier":true}}"#.to_string(),
            reply: reply_tx,
        })
        .await
        .unwrap();
        let init: Value = serde_json::from_str(&reply_rx.await.unwrap()).unwrap();
        assert_eq!(init["id"], "s1");
        assert_eq!(init["ok"], true);

        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(HostEnvelope {
            payload: r#"{"id":"s2","op":"cusps","params":{}}"#.to_string(),
            reply: reply_tx,
        })
        .await
        .unwrap();
        let cusps: Value = serde_json::from_str(&reply_rx.await.unwrap()).unwrap();
        assert_eq!(cusps["id"], "s2");
        assert_eq!(cusps["result"]["cusps"].as_array().map(Vec::len), Some(12));
    }
}
