// Copied only into disposable QA applications. Not compiled into the shipping app.
#[tauri::command]
pub fn qa_record_metrics(
    state: tauri::State<'_, crate::state::FragmentState>,
    label: String,
    intervals: Vec<f64>,
    details: serde_json::Value,
) -> Result<(), String> {
    if std::env::var_os("FRAGMENT_APP_DATA_DIR").is_none()
        || label.len() > 40
        || !label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || intervals.len() > 20000
    {
        return Err("Invalid QA metrics request".into());
    }
    let root = state.core.paths().root().join("logs");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let body = serde_json::json!({"label":label,"version":env!("CARGO_PKG_VERSION"),"recordedAtUnixMs":now,"intervalsMs":intervals,"details":details});
    std::fs::write(
        root.join(format!("qa-{now}-{label}.json")),
        serde_json::to_vec_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
