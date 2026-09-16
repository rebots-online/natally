// natally — prod RevenueCat verifier (§9.4 `POST /mint`), behind
// `--features http-rc`. NOT compiled by the default build and never exercised
// by tests (house rule: no network in tests) — the trait injection
// (`state::RcVerifier`) is the seam; see README's honest-gaps section for the
// live-response-grammar caveat.

use crate::error::ApiError;
use crate::state::RcVerifier;

pub struct HttpRcVerifier {
    pub client: reqwest::Client,
    pub api_key: String,
    pub base_url: String,
    pub project_id: String,
    pub entitlement_id: String,
}

impl HttpRcVerifier {
    /// Env: RC_API_KEY (required here), RC_API_BASE (default
    /// `https://api.revenuecat.com/v2`), RC_PROJECT_ID (required),
    /// RC_ENTITLEMENT_ID (default `unlimited`).
    pub fn from_env() -> Result<Self, String> {
        let api_key = require_env("RC_API_KEY")?;
        let project_id = require_env("RC_PROJECT_ID")?;
        let base_url = std::env::var("RC_API_BASE")
            .unwrap_or_else(|_| "https://api.revenuecat.com/v2".to_string());
        let entitlement_id =
            std::env::var("RC_ENTITLEMENT_ID").unwrap_or_else(|_| "unlimited".to_string());
        Ok(HttpRcVerifier {
            client: reqwest::Client::new(),
            api_key,
            base_url: base_url.trim_end_matches('/').to_string(),
            project_id,
            entitlement_id,
        })
    }
}

fn require_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("{name} is required for the http-rc RevenueCat verifier"))
}

#[async_trait::async_trait]
impl RcVerifier for HttpRcVerifier {
    async fn verify_purchase(
        &self,
        app_user_id: &str,
        _purchase_ref: &str,
    ) -> Result<bool, ApiError> {
        // RC REST v2: the customer's active entitlements. `purchaseRef` is
        // already the ledger dedup key; entitlement presence is the
        // entitlement decision.
        let url = format!(
            "{}/projects/{}/customers/{}/active_entitlements",
            self.base_url, self.project_id, app_user_id
        );
        let response = self
            .client
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))?;
        if !response.status().is_success() {
            return Err(ApiError::Upstream(format!(
                "RevenueCat REST v2 answered {}",
                response.status()
            )));
        }
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ApiError::Upstream(e.to_string()))?;
        let entitled = value
            .get("active_entitlements")
            .and_then(serde_json::Value::as_array)
            .map(|entries| {
                entries.iter().any(|entry| {
                    entry.get("entitlement_id").and_then(serde_json::Value::as_str)
                        == Some(self.entitlement_id.as_str())
                })
            })
            .unwrap_or(false);
        Ok(entitled)
    }
}
