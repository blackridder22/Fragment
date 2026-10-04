//! Shared content identification. File names and remote MIME headers are not evidence of format.
use std::{fs::File, io::Read, path::Path};

use image::ImageFormat;

use crate::{CoreError, CoreResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetFormat {
    Raster(ImageFormat),
    Svg,
}

impl From<ImageFormat> for AssetFormat {
    fn from(value: ImageFormat) -> Self {
        Self::Raster(value)
    }
}

impl AssetFormat {
    pub fn detect(bytes: &[u8]) -> CoreResult<Self> {
        if let Ok(format) = image::guess_format(bytes) {
            return Ok(Self::Raster(format));
        }
        // Parsing belongs to the bounded child. Even extensionless XML must be size limited here.
        if bytes.len() > crate::svg::MAX_SVG_BYTES {
            return Err(crate::svg::SvgError::too_large().into());
        }
        let text = std::str::from_utf8(bytes).map_err(|_| CoreError::UnsupportedImageSource)?;
        if text
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with('<')
        {
            Ok(Self::Svg)
        } else {
            Err(CoreError::UnsupportedImageSource)
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Raster(format) => crate::storage::extension_for_format(format),
            Self::Svg => "svg",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Raster(format) => crate::storage::mime_for_format(format),
            Self::Svg => "image/svg+xml",
        }
    }
}

pub fn read_asset(path: &Path) -> CoreResult<(Vec<u8>, AssetFormat)> {
    let mut file = File::open(path)?;
    let mut prefix = [0_u8; 32];
    let count = file.read(&mut prefix)?;
    let is_raster = image::guess_format(&prefix[..count]).is_ok();
    let mut bytes = Vec::from(&prefix[..count]);
    if is_raster {
        // Preserve the existing local raster import policy; the 25 MiB cap is for web downloads.
        file.read_to_end(&mut bytes)?;
        return Ok((
            bytes,
            AssetFormat::Raster(image::guess_format(&prefix[..count])?),
        ));
    }
    let limit = crate::svg::MAX_SVG_BYTES;
    file.take((limit + 1 - count) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(crate::svg::SvgError::too_large().into());
    }
    let format = AssetFormat::detect(&bytes)?;
    Ok((bytes, format))
}
