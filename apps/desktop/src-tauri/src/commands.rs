use std::fs;
use std::path::Path;
use std::process::Command;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use fragment_core::{Fragment, Frame, ImportDuplicateCheck};
use tauri::State;
use url::Url;

use crate::state::FragmentState;

type CommandResult<T> = Result<T, String>;
const MAX_ASSET_DATA_URL_BYTES: u64 = 20 * 1024 * 1024;

fn safe_error(error: impl std::fmt::Display) -> String {
    error.to_string()
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
