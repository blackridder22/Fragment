use std::borrow::Cow;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use fragment_core::{
    CoreError, Fragment, FragmentFilter, Frame, ImportOutcome, PurgeReport, SmartFrame,
};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use url::Url;

use crate::native_host::{native_host_status as read_native_host_status, NativeHostStatus};
use crate::state::FragmentState;

type CommandResult<T> = Result<T, String>;
const MAX_ASSET_DATA_URL_BYTES: u64 = 20 * 1024 * 1024;
const DEFAULT_FRAGMENT_PAGE_SIZE: usize = 60;
const MAX_FRAGMENT_PAGE_SIZE: usize = 200;
const MAX_IMPORT_BATCH_SIZE: usize = 500;
const MAX_SELECTION_BATCH_SIZE: usize = 50_000;
const IMPORT_CONCURRENCY: usize = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    default_frame: Frame,
    frames: Vec<Frame>,
    fragments: Vec<Fragment>,
    fragment_total: u64,
    trash_total: u64,
    frame_counts: BTreeMap<String, u64>,
    revision: String,
    asset_root: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentPage {
    items: Vec<Fragment>,
    offset: usize,
    limit: usize,
    total: u64,
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
    error_code: Option<String>,
    existing_fragment_id: Option<String>,
    existing_trashed: Option<bool>,
    outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
        fragment: Box<Fragment>,
        linked: bool,
    },
    Skipped {
        job_id: String,
        request_id: String,
        existing_fragment_id: String,
        existing_trashed: bool,
    },
    Failed {
        job_id: String,
        request_id: String,
        error: String,
        error_code: Option<String>,
        existing_fragment_id: Option<String>,
        existing_trashed: Option<bool>,
    },
    Cancelled {
        job_id: String,
        request_id: String,
    },
    Finished {
        job_id: String,
        completed: usize,
        linked: usize,
        skipped: usize,
        failed: usize,
        cancelled: usize,
    },
}

fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn import_error_details(error: &CoreError) -> (Option<String>, Option<String>, Option<bool>) {
    match error {
        CoreError::DuplicateMembership {
            fragment_id,
            trashed,
            ..
        } => (
            Some("duplicate_membership".to_string()),
            Some(fragment_id.clone()),
            Some(*trashed),
        ),
        CoreError::ExistingAsset {
            fragment_id,
            trashed,
            ..
        } => (
            Some("duplicate_asset_elsewhere".to_string()),
            Some(fragment_id.clone()),
            Some(*trashed),
        ),
        CoreError::DuplicateFragment(_) => (Some("duplicate_fragment".to_string()), None, None),
        _ => (None, None, None),
    }
}

fn page_size(limit: Option<u32>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_FRAGMENT_PAGE_SIZE)
        .clamp(1, MAX_FRAGMENT_PAGE_SIZE)
}

fn fragment_page(
    items: Vec<Fragment>,
    offset: usize,
    limit: usize,
    total: u64,
    revision: String,
) -> FragmentPage {
    FragmentPage {
        items,
        offset,
        limit,
        total,
        has_more: u64::try_from(offset.saturating_add(limit)).unwrap_or(u64::MAX) < total,
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
        let (fragments, fragment_total) = core
            .list_fragment_page(None, false, 0, limit)
            .map_err(safe_error)?;
        let (_, trash_total) = core
            .list_fragment_page(None, true, 0, 1)
            .map_err(safe_error)?;
        let frame_counts = core.active_fragment_counts_by_frame().map_err(safe_error)?;
        let revision = core.library_revision().map_err(safe_error)?.to_string();
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
            trash_total,
            frame_counts,
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
    include_descendants: Option<bool>,
    trashed: Option<bool>,
    offset: Option<u32>,
    limit: Option<u32>,
    filter: Option<FragmentFilter>,
    sort_mode: Option<String>,
) -> CommandResult<FragmentPage> {
    let core = state.core.clone();
    let offset = offset.unwrap_or_default() as usize;
    let limit = page_size(limit);
    tauri::async_runtime::spawn_blocking(move || {
        let (items, total) = core
            .list_fragment_page_filtered(
                frame_id,
                include_descendants.unwrap_or(false),
                trashed.unwrap_or(false),
                filter.unwrap_or_default(),
                sort_mode,
                offset,
                limit,
            )
            .map_err(safe_error)?;
        let revision = core.library_revision().map_err(safe_error)?.to_string();
        Ok(fragment_page(items, offset, limit, total, revision))
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn list_fragment_ids(
    state: State<'_, FragmentState>,
    frame_id: Option<String>,
    include_descendants: Option<bool>,
    trashed: Option<bool>,
    query: Option<String>,
    source_filter: Option<String>,
    filter: Option<FragmentFilter>,
    sort_mode: Option<String>,
) -> CommandResult<Vec<String>> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let filter = filter.unwrap_or_else(|| FragmentFilter {
            query,
            source_kind: source_filter,
            ..FragmentFilter::default()
        });
        core.list_fragment_ids_filtered(
            frame_id,
            include_descendants.unwrap_or(false),
            trashed.unwrap_or(false),
            filter,
            sort_mode,
        )
        .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub fn list_smart_frames(state: State<'_, FragmentState>) -> CommandResult<Vec<SmartFrame>> {
    state.core.list_smart_frames().map_err(safe_error)
}

#[tauri::command]
pub fn create_smart_frame(
    state: State<'_, FragmentState>,
    name: String,
    filter: FragmentFilter,
) -> CommandResult<SmartFrame> {
    state
        .core
        .create_smart_frame(name, filter)
        .map_err(safe_error)
}

#[tauri::command]
pub fn update_smart_frame(
    state: State<'_, FragmentState>,
    id: String,
    name: String,
    filter: FragmentFilter,
) -> CommandResult<SmartFrame> {
    state
        .core
        .update_smart_frame(id, name, filter)
        .map_err(safe_error)
}

#[tauri::command]
pub fn delete_smart_frame(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    state.core.delete_smart_frame(id).map_err(safe_error)
}

#[tauri::command]
pub async fn fragment_membership_count(
    state: State<'_, FragmentState>,
    id: String,
) -> CommandResult<u64> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.fragment_membership_count(id).map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn get_library_revision(state: State<'_, FragmentState>) -> CommandResult<String> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.library_revision()
            .map(|revision| revision.to_string())
            .map_err(safe_error)
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
pub fn move_frame(
    state: State<'_, FragmentState>,
    id: String,
    parent_id: Option<String>,
    position: u32,
) -> CommandResult<Frame> {
    state
        .core
        .move_frame(id, parent_id, position as usize)
        .map_err(safe_error)
}

#[tauri::command]
pub fn delete_frame(
    state: State<'_, FragmentState>,
    id: String,
    retention_days: Option<u32>,
) -> CommandResult<()> {
    state
        .core
        .delete_frame_with_policy(id, Some(retention_days.unwrap_or(31)))
        .map_err(safe_error)
}

#[tauri::command]
pub fn hard_delete_frame(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    state.core.hard_delete_frame(id).map_err(safe_error)
}

#[tauri::command]
pub fn list_trashed_frames(state: State<'_, FragmentState>) -> CommandResult<Vec<Frame>> {
    state.core.list_trashed_frames().map_err(safe_error)
}

#[tauri::command]
pub fn restore_frame(state: State<'_, FragmentState>, id: String) -> CommandResult<Frame> {
    state.core.restore_frame(id).map_err(safe_error)
}

#[tauri::command]
pub async fn purge_expired_trash(state: State<'_, FragmentState>) -> CommandResult<PurgeReport> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || core.purge_expired_trash().map_err(safe_error))
        .await
        .map_err(safe_error)?
}

#[tauri::command]
pub async fn empty_trash(state: State<'_, FragmentState>) -> CommandResult<PurgeReport> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || core.empty_trash().map_err(safe_error))
        .await
        .map_err(safe_error)?
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
pub fn get_fragment_any(state: State<'_, FragmentState>, id: String) -> CommandResult<Fragment> {
    state
        .core
        .get_fragment_including_deleted(id)
        .map_err(safe_error)
}

#[tauri::command]
pub async fn add_existing_fragment_to_frame(
    state: State<'_, FragmentState>,
    existing_fragment_id: String,
    frame_id: Option<String>,
) -> CommandResult<Fragment> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.add_existing_fragment_to_frame(existing_fragment_id, frame_id)
            .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn move_fragment_to_frame(
    state: State<'_, FragmentState>,
    id: String,
    frame_id: String,
) -> CommandResult<Fragment> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.move_fragment_to_frame(id, frame_id)
            .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
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
pub fn get_fragment_tags(
    state: State<'_, FragmentState>,
    id: String,
) -> CommandResult<Vec<String>> {
    state.core.fragment_tags(&id).map_err(safe_error)
}

#[tauri::command]
pub fn list_tags(state: State<'_, FragmentState>) -> CommandResult<Vec<String>> {
    state.core.list_tags().map_err(safe_error)
}

#[tauri::command]
pub fn set_fragment_tags(
    state: State<'_, FragmentState>,
    id: String,
    tags: Vec<String>,
) -> CommandResult<Vec<String>> {
    state.core.set_fragment_tags(id, tags).map_err(safe_error)
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
        let mut linked = 0;
        let mut skipped = 0;
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
                        error_code: None,
                        existing_fragment_id: None,
                        existing_trashed: None,
                        outcome: None,
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
                            core.import_image_outcome(
                                item.frame_id,
                                item.file_path,
                                item.title_override,
                            )
                        }),
                    )
                })
                .collect::<Vec<_>>();

            for (request_id, handle) in handles {
                match handle.join() {
                    Ok(Ok(ImportOutcome::New(fragment))) => {
                        completed += 1;
                        let _ = on_event.send(ImportBatchEvent::Complete {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            fragment: Box::new(fragment.clone()),
                            linked: false,
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: true,
                            fragment: Some(fragment),
                            error: None,
                            error_code: None,
                            existing_fragment_id: None,
                            existing_trashed: None,
                            outcome: Some("new".to_string()),
                        });
                    }
                    Ok(Ok(ImportOutcome::Linked(fragment))) => {
                        linked += 1;
                        let _ = on_event.send(ImportBatchEvent::Complete {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            fragment: Box::new(fragment.clone()),
                            linked: true,
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: true,
                            fragment: Some(fragment),
                            error: None,
                            error_code: None,
                            existing_fragment_id: None,
                            existing_trashed: None,
                            outcome: Some("linked".to_string()),
                        });
                    }
                    Ok(Ok(ImportOutcome::SkippedDuplicate {
                        existing_fragment_id,
                        trashed,
                    })) => {
                        skipped += 1;
                        let _ = on_event.send(ImportBatchEvent::Skipped {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            existing_fragment_id: existing_fragment_id.clone(),
                            existing_trashed: trashed,
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: true,
                            fragment: None,
                            error: None,
                            error_code: None,
                            existing_fragment_id: Some(existing_fragment_id),
                            existing_trashed: Some(trashed),
                            outcome: Some("skipped".to_string()),
                        });
                    }
                    Ok(Err(error)) => {
                        failed += 1;
                        let (error_code, existing_fragment_id, existing_trashed) =
                            import_error_details(&error);
                        let error = error.to_string();
                        let _ = on_event.send(ImportBatchEvent::Failed {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            error: error.clone(),
                            error_code: error_code.clone(),
                            existing_fragment_id: existing_fragment_id.clone(),
                            existing_trashed,
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: false,
                            fragment: None,
                            error: Some(error),
                            error_code,
                            existing_fragment_id,
                            existing_trashed,
                            outcome: None,
                        });
                    }
                    Err(_) => {
                        failed += 1;
                        let error = "Import worker stopped unexpectedly".to_string();
                        let _ = on_event.send(ImportBatchEvent::Failed {
                            job_id: job_id.clone(),
                            request_id: request_id.clone(),
                            error: error.clone(),
                            error_code: None,
                            existing_fragment_id: None,
                            existing_trashed: None,
                        });
                        results.push(ImportBatchResult {
                            request_id,
                            ok: false,
                            fragment: None,
                            error: Some(error),
                            error_code: None,
                            existing_fragment_id: None,
                            existing_trashed: None,
                            outcome: None,
                        });
                    }
                }
            }
        }

        cancelled_jobs.lock().map_err(safe_error)?.remove(&job_id);
        let _ = on_event.send(ImportBatchEvent::Finished {
            job_id,
            completed,
            linked,
            skipped,
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
    retention_days: Option<u32>,
) -> CommandResult<()> {
    state
        .core
        .delete_fragment_everywhere_with_policy(id, retention_days)
        .map_err(safe_error)
}

#[tauri::command]
pub async fn delete_fragments(
    state: State<'_, FragmentState>,
    ids: Vec<String>,
    retention_days: Option<u32>,
) -> CommandResult<usize> {
    if ids.len() > MAX_SELECTION_BATCH_SIZE {
        return Err(format!(
            "A batch can contain at most {MAX_SELECTION_BATCH_SIZE} Fragments"
        ));
    }
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.delete_fragments_with_policy(&ids, retention_days)
            .map_err(safe_error)
    })
    .await
    .map_err(safe_error)?
}

#[tauri::command]
pub async fn restore_fragments(
    state: State<'_, FragmentState>,
    ids: Vec<String>,
) -> CommandResult<usize> {
    if ids.len() > MAX_SELECTION_BATCH_SIZE {
        return Err(format!(
            "A batch can contain at most {MAX_SELECTION_BATCH_SIZE} Fragments"
        ));
    }
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || core.restore_fragments(&ids).map_err(safe_error))
        .await
        .map_err(safe_error)?
}

#[tauri::command]
pub fn reveal_fragment_in_finder(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    let fragment = state.core.get_fragment(id).map_err(safe_error)?;
    let path = state
        .core
        .paths()
        .resolve_relative_path(&fragment.original_path)
        .map_err(safe_error)?;

    open_in_file_manager(&path, true)
}

#[tauri::command]
pub fn reveal_vault_in_finder(state: State<'_, FragmentState>) -> CommandResult<()> {
    open_in_file_manager(state.core.paths().root(), false)
}

fn file_manager_arguments(path: &Path, reveal_item: bool) -> Vec<OsString> {
    #[cfg(target_os = "macos")]
    {
        let mut args = Vec::with_capacity(if reveal_item { 2 } else { 1 });
        if reveal_item {
            args.push(OsString::from("-R"));
        }
        args.push(path.as_os_str().to_owned());
        args
    }

    #[cfg(not(target_os = "macos"))]
    {
        let target = if reveal_item {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        vec![target.as_os_str().to_owned()]
    }
}

fn open_in_file_manager(path: &Path, reveal_item: bool) -> CommandResult<()> {
    let status = Command::new("open")
        .args(file_manager_arguments(path, reveal_item))
        .status()
        .map_err(safe_error)?;
    if !status.success() {
        return Err(format!("could not open Finder (exit status {status})"));
    }
    Ok(())
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
pub fn copy_fragment_image(state: State<'_, FragmentState>, id: String) -> CommandResult<()> {
    let fragment = state
        .core
        .get_fragment_including_deleted(id)
        .map_err(safe_error)?;
    let path = state
        .core
        .paths()
        .resolve_relative_path(&fragment.original_path)
        .map_err(safe_error)?;
    let bytes = fs::read(path).map_err(safe_error)?;
    let image = decode_clipboard_image(&bytes)?;
    let mut clipboard = Clipboard::new().map_err(safe_error)?;
    clipboard.set_image(image).map_err(safe_error)
}

fn decode_clipboard_image(bytes: &[u8]) -> CommandResult<ImageData<'static>> {
    let rgba = image::load_from_memory(bytes)
        .map_err(safe_error)?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    let width = usize::try_from(width).map_err(safe_error)?;
    let height = usize::try_from(height).map_err(safe_error)?;
    Ok(ImageData {
        width,
        height,
        bytes: Cow::Owned(rgba.into_raw()),
    })
}

#[tauri::command]
pub fn asset_root(state: State<'_, FragmentState>) -> CommandResult<String> {
    Ok(state.core.paths().root().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn native_host_status(app: AppHandle) -> NativeHostStatus {
    let resource_dir = match app.path().resource_dir() {
        Ok(resource_dir) => resource_dir,
        Err(error) => {
            return NativeHostStatus {
                ready: false,
                label: "Setup required".to_string(),
                description: Some(format!(
                    "Fragment could not locate its bundled native host: {error}"
                )),
            };
        }
    };
    match tauri::async_runtime::spawn_blocking(move || read_native_host_status(&resource_dir)).await
    {
        Ok(status) => status,
        Err(error) => NativeHostStatus {
            ready: false,
            label: "Setup required".to_string(),
            description: Some(format!(
                "Native host verification could not finish: {error}"
            )),
        },
    }
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
    use std::io::Cursor;

    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};

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
    fn skipped_import_event_uses_camel_case_channel_shape() {
        let event = ImportBatchEvent::Skipped {
            job_id: "job".to_string(),
            request_id: "request".to_string(),
            existing_fragment_id: "fragment".to_string(),
            existing_trashed: true,
        };
        let value = serde_json::to_value(event).expect("serialize event");
        assert_eq!(value["event"], "skipped");
        assert_eq!(value["jobId"], "job");
        assert_eq!(value["existingFragmentId"], "fragment");
        assert_eq!(value["existingTrashed"], true);
    }

    #[test]
    fn clipboard_image_decodes_png_and_jpeg_to_rgba() {
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 2, Rgba([10_u8, 20, 30, 255])));
        for format in [ImageFormat::Png, ImageFormat::Jpeg] {
            let mut cursor = Cursor::new(Vec::new());
            image.write_to(&mut cursor, format).expect("encode image");
            let decoded = decode_clipboard_image(&cursor.into_inner()).expect("decode image");
            assert_eq!(decoded.width, 3);
            assert_eq!(decoded.height, 2);
            assert_eq!(decoded.bytes.len(), 3 * 2 * 4);
        }
    }

    #[test]
    fn page_size_is_bounded() {
        assert_eq!(page_size(None), DEFAULT_FRAGMENT_PAGE_SIZE);
        assert_eq!(page_size(Some(0)), 1);
        assert_eq!(page_size(Some(500)), MAX_FRAGMENT_PAGE_SIZE);
    }

    #[test]
    fn finder_arguments_distinguish_revealing_an_item_from_opening_the_vault() {
        let path = Path::new("/tmp/Fragment Vault/original.png");
        let reveal = file_manager_arguments(path, true);
        let open = file_manager_arguments(path, false);

        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                reveal,
                vec![OsString::from("-R"), OsString::from(path.as_os_str())]
            );
            assert_eq!(open, vec![OsString::from(path.as_os_str())]);
        }

        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(
                reveal,
                vec![OsString::from(path.parent().unwrap().as_os_str())]
            );
            assert_eq!(open, vec![OsString::from(path.as_os_str())]);
        }
    }

    #[test]
    fn fragment_page_reports_complete_result_metadata() {
        let fragments = (60..120)
            .map(|index| fragment(&index.to_string()))
            .collect();
        let page = fragment_page(fragments, 60, 60, 125, "revision".to_string());

        assert_eq!(page.items.len(), 60);
        assert_eq!(page.offset, 60);
        assert_eq!(page.total, 125);
        assert!(page.has_more);
        assert_eq!(page.revision, "revision");
    }

    #[test]
    fn duplicate_membership_errors_include_existing_fragment_metadata() {
        let error = CoreError::DuplicateMembership {
            frame_id: "frame".to_string(),
            fragment_id: "existing".to_string(),
            trashed: true,
        };

        assert_eq!(
            import_error_details(&error),
            (
                Some("duplicate_membership".to_string()),
                Some("existing".to_string()),
                Some(true),
            )
        );
    }

    #[test]
    fn existing_assets_return_a_typed_duplicate_decision() {
        let error = CoreError::ExistingAsset {
            frame_id: "other-frame".to_string(),
            fragment_id: "existing".to_string(),
            trashed: false,
        };

        assert_eq!(
            import_error_details(&error),
            (
                Some("duplicate_asset_elsewhere".to_string()),
                Some("existing".to_string()),
                Some(false),
            )
        );
    }
}
