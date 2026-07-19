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
    #[error(
        "asset already belongs to Frame {frame_id} as Fragment {fragment_id} (trashed: {trashed})"
    )]
    DuplicateMembership {
        frame_id: String,
        fragment_id: String,
        trashed: bool,
    },
    #[error(
        "asset already exists as Fragment {fragment_id} in Frame {frame_id} (trashed: {trashed})"
    )]
    ExistingAsset {
        frame_id: String,
        fragment_id: String,
        trashed: bool,
    },
    #[error(
        "Fragment {fragment_id} cannot be restored because Fragment {existing_fragment_id} already belongs to the same Frame"
    )]
    RestoreConflict {
        fragment_id: String,
        existing_fragment_id: String,
    },
    #[error("database schema version {found} is newer than supported version {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
    #[error("download is too large")]
    DownloadTooLarge,
    #[error("unsupported image source")]
    UnsupportedImageSource,
    #[error("path is outside the Fragment vault: {0}")]
    UnsafePath(PathBuf),
}
