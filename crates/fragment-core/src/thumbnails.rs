//! Raster derivatives. Thumbnails and previews are lossy WebP with a lossless
//! alpha plane; originals are never re-encoded. SVG tiers stay PNG (see
//! `svg.rs` and `previews.rs`).
use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::errors::{CoreError, CoreResult};
use crate::storage::write_atomic;

/// Longest edge of a thumbnail.
pub const THUMBNAIL_MAX_EDGE: u32 = 640;
/// Longest edge of a preview. Originals at or below this edge need no preview file.
pub const PREVIEW_MAX_EDGE: u32 = 1600;
/// libwebp quality for thumbnails (0..=100).
pub const THUMBNAIL_QUALITY: f32 = 82.0;
/// libwebp quality for previews (0..=100).
pub const PREVIEW_QUALITY: f32 = 85.0;
/// File extension written for raster derivatives.
pub const DERIVATIVE_EXTENSION: &str = "webp";
/// Bumped whenever the derivative policy changes. `assets.derivatives_version`
/// below this value is regenerated in the background.
/// 1 = 640/1600 lossless PNG, always a preview file.
/// 2 = lossy WebP with alpha, preview skipped for small displayable originals.
pub const CURRENT_DERIVATIVES_VERSION: i64 = 2;

/// Formats WebKit renders directly, so a small original can stand in for its preview.
pub fn is_browser_displayable(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP | ImageFormat::Gif
    )
}

/// A preview file is only worth writing when it would be smaller in pixels than
/// the original or when WebKit cannot display the original format.
pub fn needs_preview(format: ImageFormat, width: u32, height: u32) -> bool {
    !is_browser_displayable(format) || width.max(height) > PREVIEW_MAX_EDGE
}

pub fn decode_image(bytes: &[u8]) -> CoreResult<DynamicImage> {
    Ok(image::load_from_memory(bytes)?)
}

pub fn dimensions(image: &DynamicImage) -> (i64, i64) {
    (i64::from(image.width()), i64::from(image.height()))
}

/// True when the image carries an alpha channel with at least one non-opaque pixel.
pub fn has_transparency(image: &DynamicImage) -> bool {
    if !image.color().has_alpha() {
        return false;
    }
    match image {
        DynamicImage::ImageRgba8(buffer) => buffer.pixels().any(|p| p.0[3] != u8::MAX),
        DynamicImage::ImageLumaA8(buffer) => buffer.pixels().any(|p| p.0[1] != u8::MAX),
        DynamicImage::ImageRgba16(buffer) => buffer.pixels().any(|p| p.0[3] != u16::MAX),
        DynamicImage::ImageLumaA16(buffer) => buffer.pixels().any(|p| p.0[1] != u16::MAX),
        DynamicImage::ImageRgba32F(buffer) => buffer.pixels().any(|p| p.0[3] < 1.0),
        _ => true,
    }
}

/// Lossy WebP. The alpha plane is kept lossless (libwebp `alpha_quality` 100);
/// opaque sources are encoded without an alpha plane.
pub fn encode_webp(image: &DynamicImage, quality: f32) -> CoreResult<Vec<u8>> {
    let (width, height) = (image.width(), image.height());
    let mut config = webp::WebPConfig::new().map_err(|_| webp_error("WebP config failed"))?;
    config.quality = quality.clamp(0.0, 100.0);
    config.method = 4;
    config.alpha_quality = 100;
    let memory = if has_transparency(image) {
        let rgba = image.to_rgba8();
        webp::Encoder::from_rgba(rgba.as_raw(), width, height).encode_advanced(&config)
    } else {
        let rgb = image.to_rgb8();
        webp::Encoder::from_rgb(rgb.as_raw(), width, height).encode_advanced(&config)
    }
    .map_err(|error| webp_error(format!("WebP encoding failed: {error:?}")))?;
    Ok(memory.to_vec())
}

fn webp_error(message: impl Into<String>) -> CoreError {
    CoreError::Image(image::ImageError::Encoding(
        image::error::EncodingError::new(
            image::error::ImageFormatHint::Exact(ImageFormat::WebP),
            message.into(),
        ),
    ))
}

/// Resample to fit [`THUMBNAIL_MAX_EDGE`]. Matches the sampling the palette extractor expects.
pub fn thumbnail_image(source: &DynamicImage) -> DynamicImage {
    source.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
}

/// Resample to fit [`PREVIEW_MAX_EDGE`].
pub fn preview_image(source: &DynamicImage) -> DynamicImage {
    source.resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, FilterType::Lanczos3)
}

/// Encode an already resampled thumbnail.
pub fn encode_thumbnail(thumbnail: &DynamicImage) -> CoreResult<Vec<u8>> {
    encode_webp(thumbnail, THUMBNAIL_QUALITY)
}

/// Encode an already resampled preview.
pub fn encode_preview(preview: &DynamicImage) -> CoreResult<Vec<u8>> {
    encode_webp(preview, PREVIEW_QUALITY)
}

pub fn generate_thumbnail(source: &DynamicImage, output_path: &Path) -> CoreResult<()> {
    let bytes = encode_thumbnail(&thumbnail_image(source))?;
    write_atomic(output_path, &bytes)?;
    Ok(())
}

pub fn generate_preview(source: &DynamicImage, output_path: &Path) -> CoreResult<()> {
    let bytes = encode_preview(&preview_image(source))?;
    write_atomic(output_path, &bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, Rgba, RgbaImage};

    fn checkerboard(width: u32, height: u32, alpha_left: u8) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
            let alpha = if x < width / 2 { alpha_left } else { u8::MAX };
            if (x / 8 + y / 8) % 2 == 0 {
                Rgba([200, 40, 90, alpha])
            } else {
                Rgba([20, 160, 220, alpha])
            }
        }))
    }

    #[test]
    fn derivatives_are_webp_and_fit_their_edges() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = checkerboard(2400, 1200, u8::MAX);
        let thumbnail = temp.path().join("t.webp");
        let preview = temp.path().join("p.webp");
        generate_thumbnail(&source, &thumbnail).expect("thumbnail");
        generate_preview(&source, &preview).expect("preview");
        for (path, edge) in [
            (&thumbnail, THUMBNAIL_MAX_EDGE),
            (&preview, PREVIEW_MAX_EDGE),
        ] {
            let bytes = std::fs::read(path).expect("read");
            assert_eq!(
                image::guess_format(&bytes).expect("format"),
                ImageFormat::WebP
            );
            let decoded = image::load_from_memory(&bytes).expect("decode");
            assert_eq!(decoded.width().max(decoded.height()), edge);
        }
    }

    #[test]
    fn opaque_sources_drop_the_alpha_plane_and_transparent_sources_keep_it() {
        let opaque = encode_webp(&checkerboard(64, 64, u8::MAX), 82.0).expect("opaque");
        let decoded = image::load_from_memory(&opaque).expect("decode opaque");
        assert!(!decoded.color().has_alpha());

        let transparent = encode_webp(&checkerboard(64, 64, 0), 82.0).expect("transparent");
        let decoded = image::load_from_memory(&transparent)
            .expect("decode transparent")
            .to_rgba8();
        assert_eq!(
            decoded.get_pixel(4, 4)[3],
            0,
            "left half stays fully transparent"
        );
        assert_eq!(
            decoded.get_pixel(60, 4)[3],
            u8::MAX,
            "right half stays opaque"
        );
        let partial = encode_webp(&checkerboard(64, 64, 128), 82.0).expect("partial");
        let decoded = image::load_from_memory(&partial)
            .expect("decode partial")
            .to_rgba8();
        assert_eq!(decoded.get_pixel(4, 4)[3], 128, "alpha plane is lossless");
    }

    #[test]
    fn lossy_webp_is_much_smaller_than_png_for_photographic_content() {
        let source = DynamicImage::ImageRgb8(image::RgbImage::from_fn(640, 480, |x, y| {
            let noise = ((x * 31 + y * 17) % 23) as u8;
            Rgb([
                (x % 256) as u8 ^ noise,
                (y % 256) as u8 ^ noise,
                ((x + y) % 256) as u8,
            ])
        }));
        let webp = encode_thumbnail(&source).expect("webp");
        let mut png = std::io::Cursor::new(Vec::new());
        source.write_to(&mut png, ImageFormat::Png).expect("png");
        assert!(
            webp.len() * 3 < png.into_inner().len(),
            "webp {} bytes",
            webp.len()
        );
    }

    #[test]
    fn preview_is_skipped_for_small_displayable_originals_only() {
        assert!(!needs_preview(ImageFormat::Jpeg, 1600, 900));
        assert!(!needs_preview(ImageFormat::Png, 320, 320));
        assert!(!needs_preview(ImageFormat::WebP, 1041, 1041));
        assert!(!needs_preview(ImageFormat::Gif, 800, 1600));
        assert!(needs_preview(ImageFormat::Jpeg, 1601, 900));
        assert!(needs_preview(ImageFormat::Png, 900, 2400));
        assert!(needs_preview(ImageFormat::Tiff, 100, 100));
        assert!(needs_preview(ImageFormat::Bmp, 100, 100));
        assert!(needs_preview(ImageFormat::Ico, 32, 32));
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/media")
            .join(name)
    }

    #[test]
    fn imported_transparent_fixtures_keep_pixel_alpha_in_their_webp_thumbnails() {
        let temp = tempfile::tempdir().expect("tempdir");
        let core = crate::FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let decode = |name: &str| {
            let fragment = core
                .import_image(None, fixture(name).to_string_lossy().into_owned(), None)
                .expect("import");
            assert!(fragment.thumbnail_path.ends_with(".webp"), "{name}");
            // 640 px and browser-displayable: the original stands in for the preview.
            assert_eq!(
                fragment.preview_path.as_deref(),
                Some(fragment.original_path.as_str())
            );
            let bytes = std::fs::read(
                core.paths()
                    .resolve_relative_path(&fragment.thumbnail_path)
                    .expect("resolve"),
            )
            .expect("read thumbnail");
            assert_eq!(
                image::guess_format(&bytes).expect("format"),
                ImageFormat::WebP
            );
            image::load_from_memory(&bytes).expect("decode").to_rgba8()
        };

        // transparent-logo.png: 640x320, fully transparent corners, 50% alpha centre.
        let logo = decode("transparent-logo.png");
        assert_eq!(logo.dimensions(), (640, 320));
        for (x, y) in [
            (0, 0),
            (639, 0),
            (0, 319),
            (639, 319),
            (160, 160),
            (480, 160),
        ] {
            assert_eq!(
                logo.get_pixel(x, y)[3],
                0,
                "corner/side ({x},{y}) stays transparent"
            );
        }
        let centre = logo.get_pixel(320, 160)[3];
        assert!(
            (127..=128).contains(&centre),
            "centre alpha {centre} should stay ~50%"
        );

        // transparent.png: 320x320, every pixel alpha 0; upscaled to the 640 px thumbnail.
        let blank = decode("transparent.png");
        assert_eq!(blank.dimensions(), (640, 640));
        assert!(
            blank.pixels().all(|p| p[3] == 0),
            "fully transparent source stays transparent"
        );
    }

    #[test]
    fn transparency_detection_ignores_opaque_alpha_channels() {
        assert!(!has_transparency(&checkerboard(8, 8, u8::MAX)));
        assert!(has_transparency(&checkerboard(8, 8, 254)));
        assert!(!has_transparency(&DynamicImage::ImageRgb8(
            image::RgbImage::new(4, 4)
        )));
    }
}
