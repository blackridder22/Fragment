use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use image::ImageFormat;
use uuid::Uuid;

use crate::errors::{CoreError, CoreResult};

pub fn write_atomic(path: &Path, bytes: &[u8]) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let temp_name = format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("fragment")
    );
    let temp_path = path.with_file_name(format!("{temp_name}-{}", Uuid::new_v4()));

    {
        let mut file = File::create(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }

    fs::rename(&temp_path, path)?;
    Ok(())
}

pub fn extension_for_format(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Ico => "ico",
        ImageFormat::Tiff => "tiff",
        _ => "img",
    }
}

pub fn mime_for_format(format: ImageFormat) -> &'static str {
    match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Gif => "image/gif",
        ImageFormat::WebP => "image/webp",
        ImageFormat::Bmp => "image/bmp",
        ImageFormat::Ico => "image/x-icon",
        ImageFormat::Tiff => "image/tiff",
        _ => "application/octet-stream",
    }
}

pub fn safe_existing_file(path: &Path) -> CoreResult<PathBuf> {
    let canonical = path.canonicalize()?;
    if !canonical.is_file() {
        return Err(CoreError::InvalidInput(format!(
            "{} is not a file",
            canonical.display()
        )));
    }
    Ok(canonical)
}
