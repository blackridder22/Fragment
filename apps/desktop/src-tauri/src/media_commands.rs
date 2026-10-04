use crate::state::FragmentState;
use fragment_core::{
    palette_jobs::{FragmentPalette, PaletteIndexStatus},
    previews::{MediaInfo, SvgPreview},
};
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, State};

#[tauri::command]
pub fn start_palette_indexing(app: tauri::AppHandle, state: State<'_, FragmentState>) {
    if state.palette_started.swap(true, Ordering::AcqRel) {
        return;
    }
    let core = state.core.clone();
    let priority = Arc::clone(&state.palette_priority);
    let stopped = Arc::clone(&state.palette_stopped);
    let frame = Arc::clone(&state.palette_frame);
    std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            let priority = priority.lock().ok().and_then(|value| value.clone());
            let frame = frame.lock().ok().and_then(|value| value.clone());
            match core.process_palette_batch_in_frame(priority.as_deref(), frame.as_deref(), 25) {
                Ok(ids) if !ids.is_empty() => {
                    let _ = app.emit("palette-changed", ids);
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error,"Palette indexing batch failed"),
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

#[tauri::command]
pub fn set_palette_priority(
    state: State<'_, FragmentState>,
    fragment_id: Option<String>,
    frame_id: Option<String>,
) {
    if let Ok(mut priority) = state.palette_priority.lock() {
        *priority = fragment_id;
    }
    if let Ok(mut frame) = state.palette_frame.lock() {
        *frame = frame_id;
    }
}

#[tauri::command]
pub async fn get_fragment_palette(
    state: State<'_, FragmentState>,
    id: String,
) -> Result<FragmentPalette, String> {
    if let Ok(mut priority) = state.palette_priority.lock() {
        *priority = Some(id.clone());
    }
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.get_fragment_palette(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn get_palette_index_status(
    state: State<'_, FragmentState>,
) -> Result<PaletteIndexStatus, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.palette_index_status().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn retry_fragment_palette(
    state: State<'_, FragmentState>,
    id: String,
) -> Result<(), String> {
    if let Ok(mut priority) = state.palette_priority.lock() {
        *priority = Some(id.clone());
    }
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.retry_fragment_palette(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn get_fragment_media_info(
    state: State<'_, FragmentState>,
    id: String,
) -> Result<MediaInfo, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.fragment_media_info(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ensure_svg_preview(
    state: State<'_, FragmentState>,
    id: String,
    max_edge: u32,
    request_id: String,
    repair: Option<bool>,
) -> Result<SvgPreview, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.ensure_svg_preview_with_repair(&id, max_edge, &request_id, repair.unwrap_or(false))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_svg_preview(request_id: String) {
    fragment_core::previews::cancel_preview(&request_id);
}
