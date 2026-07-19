use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use fragment_core::{Fragment, Frame, ImportDuplicateCheck};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};
use url::Url;

use crate::state::FragmentState;

type CommandResult<T> = Result<T, String>;
const MAX_ASSET_DATA_URL_BYTES: u64 = 20 * 1024 * 1024;
const DEFAULT_FRAGMENT_PAGE_SIZE: usize = 60;
const MAX_FRAGMENT_PAGE_SIZE: usize = 200;
const MAX_IMPORT_BATCH_SIZE: usize = 500;
const IMPORT_CONCURRENCY: usize = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    default_frame: Frame,
    frames: Vec<Frame>,
    fragments: Vec<Fragment>,
    fragment_total: usize,
    revision: String,
    asset_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentPage {
    items: Vec<Fragment>,
    offset: usize,
    limit: usize,
    total: usize,
    has_more: bool,
    revision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchItem {
    request_id: String,
    frame_id: Option<String>,
    file_path: String,
    title_override: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchResult {
    request_id: String,
    ok: bool,
    fragment: Option<Fragment>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ImportBatchEvent {
    Queued {
        job_id: String,
        request_id: String,
    },
    Preparing {
        job_id: String,
        request_id: String,
    },
    Complete {
        job_id: String,
        request_id: String,
        fragment: Fragment,
    },
    Failed {
        job_id: String,
        request_id: String,
        error: String,
    },
    Cancelled {
        job_id: String,
        request_id: String,
    },
    Finished {
        job_id: String,
        completed: usize,
        failed: usize,
        cancelled: usize,
    },
}

fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn library_revision(frames: &[Frame], fragments: &[Fragment]) -> String {
    let mut hasher = DefaultHasher::new();
    frames.len().hash(&mut hasher);
    fragments.len().hash(&mut hasher);

    for frame in frames {
        frame.id.hash(&mut hasher);
        frame.updated_at.hash(&mut hasher);
    }
    for fragment in fragments {
        fragment.id.hash(&mut hasher);
        fragment.frame_id.hash(&mut hasher);
        fragment.updated_at.hash(&mut hasher);
        fragment.deleted_at.hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

fn page_size(limit: Option<u32>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_FRAGMENT_PAGE_SIZE)
        .clamp(1, MAX_FRAGMENT_PAGE_SIZE)
}

fn fragment_page(
    fragments: Vec<Fragment>,
    offset: usize,
    limit: usize,
    revision: String,
) -> FragmentPage {
    let total = fragments.len();
    let items = fragments.into_iter().skip(offset).take(limit).collect();
    FragmentPage {
        items,
        offset,
        limit,
        total,
        has_more: offset.saturating_add(limit) < total,
        revision,
    }
}

#[tauri::command]
pub async fn load_library_snapshot(
    state: State<'_, FragmentState>,
    limit: Option<u32>,
) -> CommandResult<LibrarySnapshot> {
    let core = state.core.clone();
    let limit = page_size(limit);
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let default_frame = core.ensure_default_frame().map_err(safe_error)?;
        let frames = core.list_frames().map_err(safe_error)?;
        let mut fragments = core.list_all_fragments().map_err(safe_error)?;
        let fragment_total = fragments.len();
        let revision = library_revision(&frames, &fragments);
        fragments.truncate(limit);
        tracing::info!(
            elapsed_ms = started_at.elapsed().as_millis(),
            frame_count = frames.len(),
            fragment_total,
            returned_fragments = fragments.len(),
            "loaded initial library snapshot"
        );
        Ok(LibrarySnapshot {
            default_frame,
            frames,
            fragments,
            fragment_total,
            revision,
            asset_root: core.paths().root().to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn list_fragment_page(
    state: State<'_, FragmentState>,
    frame_id: Option<String>,
    trashed: Option<bool>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> CommandResult<FragmentPage> {
    let core = state.core.clone();
    let offset = offset.unwrap_or_default() as usize;
    let limit = page_size(limit);
    tauri::async_runtime::spawn_blocking(move || {
        let frames = core.list_frames().map_err(safe_error)?;
        let fragments = if trashed.unwrap_or(false) {
            core.list_trashed_fragments().map_err(safe_error)?
        } else if let Some(frame_id) = frame_id {
            core.list_fragments(frame_id).map_err(safe_error)?
        } else {
            core.list_all_fragments().map_err(safe_error)?
        };
        let revision = library_revision(&frames, &fragments);
        Ok(fragment_page(fragments, offset, limit, revision))
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn get_library_revision(state: State<'_, FragmentState>) -> CommandResult<String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let frames = core.list_frames().map_err(safe_error)?;
        let fragments = core.list_all_fragments().map_err(safe_error)?;
        Ok(library_revision(&frames, &fragments))
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub fn ensure_default_frame(state: State<'_, FragmentState>) -> CommandResult<Frame> {
    state.core.ensure_default_frame().map_err(safe_error)
}

#[tauri::command]
pub fn create_frame(
    state: State<'_, FragmentState>,
    parent_id: Option<String>,
    name: String,
) -> CommandResult<Frame> {
    state.core.create_frame(parent_id, name).map_err(safe_error)
}

#[tauri::command]
pub fn list_frames(state: State<'_, FragmentState>) -> CommandResult<Vec<Frame>> {
    state.core.list_frames().map_err(safe_error)
}

#[tauri::command]
pub fn list_child_frames(
    state: State<'_, FragmentState>,
    parent_id: Option<String>,
) -> CommandResult<Vec<Frame>> {
    state.core.list_child_frames(parent_id).map_err(safe_error)
}

#[tauri::command]
pub fn rename_frame(
    state: State<'_, FragmentState>,
    id: String,
    name: String,
) -> CommandResult<Frame> {
    state.core.rename_frame(id, name).map_err(safe_error)
}

#[tauri::command]
pub fn delete_frame(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    state.core.delete_frame(id).map_err(safe_error)
}

#[tauri::command]
pub fn list_all_fragments(state: State<'_, FragmentState>) -> CommandResult<Vec<Fragment>> {
    state.core.list_all_fragments().map_err(safe_error)
}

#[tauri::command]
pub fn list_trashed_fragments(state: State<'_, FragmentState>) -> CommandResult<Vec<Fragment>> {
    state.core.list_trashed_fragments().map_err(safe_error)
}

#[tauri::command]
pub fn list_fragments(
    state: State<'_, FragmentState>,
    frame_id: String,
) -> CommandResult<Vec<Fragment>> {
    state.core.list_fragments(frame_id).map_err(safe_error)
}

#[tauri::command]
pub fn get_fragment(state: State<'_, FragmentState>, id: String) -> CommandResult<Fragment> {
    state.core.get_fragment(id).map_err(safe_error)
}

#[tauri::command]
pub fn update_fragment(
    state: State<'_, FragmentState>,
    id: String,
    title: Option<String>,
    note: Option<String>,
) -> CommandResult<Fragment> {
    state
        .core
        .update_fragment(id, title, note)
        .map_err(safe_error)
}

#[tauri::command]
pub async fn import_image(
    state: State<'_, FragmentState>,
    frame_id: Option<String>,
    file_path: String,
    title_override: Option<String>,
) -> CommandResult<Fragment> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.import_image(frame_id, file_path, title_override)
            .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn check_import_duplicate(
    state: State<'_, FragmentState>,
    frame_id: Option<String>,
    file_path: String,
) -> CommandResult<ImportDuplicateCheck> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.check_import_duplicate(frame_id, file_path)
            .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn import_image_batch(
    state: State<'_, FragmentState>,
    job_id: String,
    items: Vec<ImportBatchItem>,
    on_event: Channel<ImportBatchEvent>,
) -> CommandResult<Vec<ImportBatchResult>> {
    if job_id.trim().is_empty() {
        return Err("Import job ID cannot be empty".to_string());
    }
    if items.len() > MAX_IMPORT_BATCH_SIZE {
        return Err(format!(
            "Import batch exceeds the {MAX_IMPORT_BATCH_SIZE}-image limit"
        ));
    }

    let mut request_ids = std::collections::HashSet::with_capacity(items.len());
    if items
        .iter()
        .any(|item| !request_ids.insert(item.request_id.clone()))
    {
        return Err("Import batch request IDs must be unique".to_string());
    }

    state
        .cancelled_import_jobs
        .lock()
        .map_err(safe_error)?
        .remove(&job_id);
    let core = state.core.clone();
    let cancelled_jobs = state.cancelled_import_jobs.clone();

    tauri::async_runtime::spawn_blocking(move || {
        for item in &items {
            let _ = on_event.send(ImportBatchEvent::Queued {
                job_id: job_id.clone(),
                request_id: item.request_id.clone(),
            });
        }

        let mut results = Vec::with_capacity(items.len());
        let mut completed = 0;
        let mut failed = 0;
        let mut cancelled = 0;

        for chunk in items.chunks(IMPORT_CONCURRENCY) {
            let is_cancelled = cancelled_jobs.lock().map_err(safe_error)?.contains(&job_id);
            if is_cancelled {
                for item in chunk
                    .iter()
                    .chain(items[results.len().saturating_add(chunk.len())..].iter())
                {
                    cancelled += 1;
                    let _ = on_event.send(ImportBatchEvent::Cancelled {
                        job_id: job_id.clone(),
                        request_id: item.request_id.clone(),
                    });
                    results.push(ImportBatchResult {
                        request_id: item.request_id.clone(),
                        ok: false,
                        fragment: None,
                        error: Some("Import cancelled".to_string()),
                    });
                }
                break;
            }

            let handles = chunk
                .iter()
                .cloned()
                .map(|item| {
                    let request_id = item.request_id.clone();
                    let core = core.clone();
                    let on_event = on_event.clone();
                    let job_id = job_id.clone();
                    (
                        request_id,
                        std::thread::spawn(move || {
                            let _ = on_event.send(ImportBatchEvent::Preparing {
                                job_id: job_id.clone(),
                                request_id: item.request_id.clone(),
                            });
                            core.import_image(item.frame_id, item.file_path, item.title_override)
                        }),
                    )
                })
                .collect::<Vec<_>>();

            for (request_id, handle) in handles {
                match handle.join() {
                    Ok(Ok(fragment)) => {
                        completed += 1;
                        let _ = on_event.send(ImportBatchEvent::Complete {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            fragment: fragment.clone(),
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: true,
                            fragment: Some(fragment),
                            error: None,
                        });
                    }
                    Ok(Err(error)) => {
                        failed += 1;
                        let error = error.to_string();
                        let _ = on_event.send(ImportBatchEvent::Failed {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            error: error.clone(),
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: false,
                            fragment: None,
                            error: Some(error),
                        });
                    }
                    Err(_) => {
                        failed += 1;
                        let error = "Import worker stopped unexpectedly".to_string();
                        let _ = on_event.send(ImportBatchEvent::Failed {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            error: error.clone(),
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: false,
                            fragment: None,
                            error: Some(error),
                        });
                    }
                }
            }
        }

        cancelled_jobs.lock().map_err(safe_error)?.remove(&job_id);
        let _ = on_event.send(ImportBatchEvent::Finished {
            job_id,
            completed,
            failed,
            cancelled,
        });
        Ok(results)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub fn cancel_import_job(state: State<'_, FragmentState>, job_id: String) -> CommandResult<()> {
    state
        .cancelled_import_jobs
        .lock()
        .map_err(safe_error)?
        .insert(job_id);
    Ok(())
}

#[tauri::command]
pub fn delete_fragment(
    state: State<'_, FragmentState>,
    id: String,
    retention_days: Option<u32>,
) -> CommandResult<()> {
    state
        .core
        .delete_fragment_with_policy(id, retention_days)
        .map_err(safe_error)
}

#[tauri::command]
pub fn restore_fragment(state: State<'_, FragmentState>, id: String) -> CommandResult<Fragment> {
    state.core.restore_fragment(id).map_err(safe_error)
}

#[tauri::command]
pub fn delete_fragment_everywhere(
    state: State<'_, FragmentState>,
    id: String,
) -> CommandResult<()> {
    state
        .core
        .delete_fragment_everywhere(id)
        .map_err(safe_error)
}

#[tauri::command]
pub fn reveal_fragment_in_finder(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    let fragment = state.core.get_fragment(id).map_err(safe_error)?;
    let path = state
        .core
        .paths()
        .resolve_relative_path(&fragment.original_path)
        .map_err(safe_error)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(safe_error)?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(parent) = path.parent() {
            Command::new("open")
                .arg(parent)
                .status()
                .map_err(safe_error)?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn open_fragment_source(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    let fragment = state.core.get_fragment(id).map_err(safe_error)?;
    let source = fragment
        .source_url
        .or(fragment.page_url)
        .ok_or_else(|| "Fragment has no Source URL".to_string())?;
    let parsed = Url::parse(&source).map_err(safe_error)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Source URL is not an HTTP or HTTPS URL".to_string());
    }

    Command::new("open")
        .arg(parsed.as_str())
        .status()
        .map_err(safe_error)?;
    Ok(())
}

#[tauri::command]
pub fn asset_root(state: State<'_, FragmentState>) -> CommandResult<String> {
    Ok(state.core.paths().root().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn asset_data_url(
    state: State<'_, FragmentState>,
    relative_path: String,
) -> CommandResult<String> {
    tracing::warn!(
        relative_path = %relative_path,
        "falling back to inline asset data; the configured asset protocol should handle normal previews"
    );
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = core
            .paths()
            .resolve_relative_path(&relative_path)
            .map_err(safe_error)?;
        let metadata = fs::metadata(&path).map_err(safe_error)?;
        if !metadata.is_file() {
            return Err("Vault asset is not a file".to_string());
        }
        if metadata.len() > MAX_ASSET_DATA_URL_BYTES {
            return Err("Vault asset is too large to preview inline".to_string());
        }

        let bytes = fs::read(&path).map_err(safe_error)?;
        let mime_type = mime_for_asset_path(&path);
        Ok(format!(
            "data:{mime_type};base64,{}",
            STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(safe_error)?
}

fn mime_for_asset_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("apng") | Some("png") => "image/png",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("tif") | Some("tiff") => "image/tiff",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fragment(id: &str) -> Fragment {
        Fragment {
            id: id.to_string(),
            asset_id: Some(format!("asset-{id}")),
            frame_id: "frame".to_string(),
            title: Some(id.to_string()),
            description: None,
            note: None,
            source_url: None,
            page_url: None,
            site_name: None,
            creator_name: None,
            original_path: format!("originals/{id}.png"),
            thumbnail_path: format!("thumbnails/{id}.png"),
            preview_path: Some(format!("previews/{id}.png")),
            mime_type: Some("image/png".to_string()),
            width: Some(100),
            height: Some(100),
            file_size: Some(10),
            sha256: Some(format!("sha-{id}")),
            perceptual_hash: None,
            captured_from: Some("test".to_string()),
            captured_at: "2026-07-19T00:00:00Z".to_string(),
            created_at: "2026-07-19T00:00:00Z".to_string(),
            updated_at: "2026-07-19T00:00:00Z".to_string(),
            deleted_at: None,
            delete_after: None,
        }
    }

    #[test]
    fn page_size_is_bounded() {
        assert_eq!(page_size(None), DEFAULT_FRAGMENT_PAGE_SIZE);
        assert_eq!(page_size(Some(0)), 1);
        assert_eq!(page_size(Some(500)), MAX_FRAGMENT_PAGE_SIZE);
    }

    #[test]
    fn fragment_page_reports_complete_result_metadata() {
        let fragments = (0..125).map(|index| fragment(&index.to_string())).collect();
        let page = fragment_page(fragments, 60, 60, "revision".to_string());

        assert_eq!(page.items.len(), 60);
        assert_eq!(page.offset, 60);
        assert_eq!(page.total, 125);
        assert!(page.has_more);
        assert_eq!(page.revision, "revision");
    }
}
