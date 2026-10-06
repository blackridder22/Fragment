use crate::state::FragmentState;
use fragment_core::{
    palette_jobs::{FragmentPalette, PaletteIndexStatus},
    previews::{MediaInfo, SvgPreview},
    DerivativesStatus,
};
use std::sync::{atomic::Ordering, Arc};
use std::time::Duration;
use tauri::{Emitter, State};

/// Fallback poll so work done by other processes (native-host captures) is
/// still picked up when nothing in this process wakes the worker.
const PALETTE_IDLE_POLL: Duration = Duration::from_secs(30);
/// Back-off while a foreground import or preview holds the pipeline.
const BACKGROUND_PAUSE: Duration = Duration::from_millis(500);
/// Launch delay before regeneration starts, so first paint is not contended.
pub const DERIVATIVES_START_DELAY: Duration = Duration::from_secs(3);
const DERIVATIVES_BATCH: usize = 8;

#[tauri::command]
pub fn start_palette_indexing(app: tauri::AppHandle, state: State<'_, FragmentState>) {
    if state.palette_started.swap(true, Ordering::AcqRel) {
        return;
    }
    let core = state.core.clone();
    let priority = Arc::clone(&state.palette_priority);
    let stopped = Arc::clone(&state.background_stopped);
    let frame = Arc::clone(&state.palette_frame);
    let waker = Arc::clone(&state.palette_waker);
    std::thread::Builder::new()
        .name("fragment-palette".into())
        .spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let priority = priority.lock().ok().and_then(|value| value.clone());
                let frame = frame.lock().ok().and_then(|value| value.clone());
                match core.process_palette_batch_in_frame(priority.as_deref(), frame.as_deref(), 25)
                {
                    Ok(ids) if !ids.is_empty() => {
                        tracing::debug!(count = ids.len(), "palette batch published");
                        let _ = app.emit("palette-changed", ids);
                        // Drain: more work is likely queued behind this batch.
                        continue;
                    }
                    Ok(_) if fragment_core::foreground_busy() => {
                        tracing::debug!("palette worker paused for foreground work");
                        waker.wait(BACKGROUND_PAUSE);
                        continue;
                    }
                    Ok(_) => {}
                    Err(error) => tracing::warn!(%error, "Palette indexing batch failed"),
                }
                tracing::debug!(
                    fallback_secs = PALETTE_IDLE_POLL.as_secs(),
                    "palette worker idle; waiting for work"
                );
                let notified = waker.wait(PALETTE_IDLE_POLL);
                tracing::debug!(notified, "palette worker woke");
            }
        })
        .expect("spawn palette worker");
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
    state.palette_waker.notify("priority");
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
    let waker = Arc::clone(&state.palette_waker);
    tauri::async_runtime::spawn_blocking(move || {
        let palette = core.get_fragment_palette(&id).map_err(|e| e.to_string())?;
        if palette.status == "pending" || palette.status == "processing" {
            waker.notify("open");
        }
        Ok(palette)
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
    let waker = Arc::clone(&state.palette_waker);
    tauri::async_runtime::spawn_blocking(move || {
        core.retry_fragment_palette(&id)
            .map_err(|e| e.to_string())?;
        waker.notify("retry");
        Ok(())
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

/// `{ pending, done, failed }` for the derivative regeneration job.
#[tauri::command]
pub async fn derivatives_status(
    state: State<'_, FragmentState>,
) -> Result<DerivativesStatus, String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.derivatives_status().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts the one-shot regeneration worker after `delay`. Idempotent. The worker
/// exits once nothing is pending; terminal failures are left for a manual retry.
pub fn start_derivative_regeneration(
    app: tauri::AppHandle,
    state: &FragmentState,
    delay: Duration,
) {
    if state.derivatives_started.swap(true, Ordering::AcqRel) {
        return;
    }
    let core = state.core.clone();
    let stopped = Arc::clone(&state.background_stopped);
    std::thread::Builder::new()
        .name("fragment-derivatives".into())
        .spawn(move || {
            // Derivatives replaced by an earlier launch are only now safe to delete:
            // this process loaded the new paths from the database, so no view holds
            // the old ones. Runs before the delay so the files are gone before any
            // new regeneration adds to the queue.
            match core.sweep_deferred_file_deletions() {
                Ok(report) if report.removed > 0 || report.deferred > 0 => {
                    tracing::info!(?report, "swept derivatives replaced by an earlier launch")
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "deferred derivative cleanup failed"),
            }
            let deadline = std::time::Instant::now() + delay;
            while std::time::Instant::now() < deadline {
                if stopped.load(Ordering::Acquire) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            match core.derivatives_status() {
                Ok(status) if status.pending == 0 => {
                    tracing::debug!(?status, "derivatives already current");
                    return;
                }
                Ok(status) => tracing::info!(?status, "regenerating derivatives in the background"),
                Err(error) => {
                    tracing::warn!(%error, "derivative status unavailable; skipping regeneration");
                    return;
                }
            }
            let started = std::time::Instant::now();
            let mut regenerated = 0_usize;
            while !stopped.load(Ordering::Acquire) {
                match core.process_derivatives_batch(DERIVATIVES_BATCH) {
                    Ok(batch) => {
                        regenerated += batch.completed.len();
                        let idle = batch.completed.is_empty() && batch.failed.is_empty();
                        if !batch.completed.is_empty() {
                            let _ = app.emit("derivatives-changed", batch.completed);
                        }
                        if batch.paused {
                            std::thread::sleep(BACKGROUND_PAUSE);
                            continue;
                        }
                        if idle {
                            match core.derivatives_status() {
                                Ok(status) if status.pending == 0 => break,
                                // Only leased or retrying rows remain; give them a moment.
                                _ => std::thread::sleep(Duration::from_secs(1)),
                            }
                        } else {
                            // Keep the SQLite mutex and CPU available to the UI between items.
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    }
                    Err(error) => {
                        tracing::warn!(%error, "derivative regeneration batch failed");
                        std::thread::sleep(Duration::from_secs(5));
                    }
                }
            }
            tracing::info!(
                regenerated,
                elapsed_ms = started.elapsed().as_millis(),
                status = ?core.derivatives_status().ok(),
                "derivative regeneration finished"
            );
        })
        .expect("spawn derivatives worker");
}
