use natally_ephemeris::{engine::SwephEngine, NativeHost, Response};
use serde_json::Value;
use tauri::Manager;

#[tauri::command]
async fn ephemeris_request(host: tauri::State<'_, NativeHost>, request: Value) -> Result<Response, String> {
    Ok(host.request_json(request).await)
}

crate::natally_plugin!("ephemeris", [ephemeris_request], setup = |app, _| {
    let tables = app.path().resource_dir()?.join("ephemeris");
    let host = NativeHost::spawn(move || SwephEngine::new(tables))?;
    app.manage(host);
    Ok(())
});
