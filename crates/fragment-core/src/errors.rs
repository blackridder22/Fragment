use std::path::PathBuf;

use thiserror::Error;

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("image processing error: {0}")]
    Image(#[from] image::ImageError),
    #[error("network request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("url parse failed: {0}")]
    Url(#[from] url::ParseError),
    #[error("{0} was not found")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("duplicate fragment: {0}")]
    DuplicateFragment(String),
    #[error("download is too large")]
    DownloadTooLarge,
    #[error("unsupported image source")]
    UnsupportedImageSource,
    #[error("path is outside the Fragment vault: {0}")]
    UnsafePath(PathBuf),
}
