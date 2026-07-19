use std::io::Cursor;
use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::errors::CoreResult;
use crate::storage::write_atomic;

const THUMBNAIL_MAX_EDGE: u32 = 640;

pub fn generate_thumbnail(source: &DynamicImage, output_path: &Path) -> CoreResult<()> {
    let thumbnail = source.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE);
    let mut cursor = Cursor::new(Vec::new());
    thumbnail.write_to(&mut cursor, ImageFormat::Png)?;
    write_atomic(output_path, &cursor.into_inner())?;
    Ok(())
}

pub fn decode_image(bytes: &[u8]) -> CoreResult<DynamicImage> {
    Ok(image::load_from_memory(bytes)?)
}

pub fn dimensions(image: &DynamicImage) -> (i64, i64) {
    (i64::from(image.width()), i64::from(image.height()))
}

pub fn generate_preview(source: &DynamicImage, output_path: &Path) -> CoreResult<()> {
    let preview = source.resize(1600, 1600, FilterType::Lanczos3);
    let mut cursor = Cursor::new(Vec::new());
    preview.write_to(&mut cursor, ImageFormat::Png)?;
    write_atomic(output_path, &cursor.into_inner())?;
    Ok(())
}
