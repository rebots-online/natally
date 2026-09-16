// natally — `GET /healthz`: liveness only (no dependency probes; the honest
// answer to "is the process up").

use axum::Json;
use serde_json::{json, Value};

pub async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
