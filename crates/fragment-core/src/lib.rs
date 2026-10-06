pub mod app_paths;
pub mod capture;
pub mod db;
pub mod derivative_jobs;
pub mod errors;
pub mod fragments;
pub mod frames;
pub mod hashing;
pub mod media;
pub mod models;
pub mod palette;
pub mod palette_jobs;
pub mod previews;
mod processing;
pub mod smart_frames;
pub mod storage;
pub mod svg;
pub mod svg_worker;
pub mod thumbnails;

pub use db::FragmentCore;
pub use derivative_jobs::{DerivativesBatch, DerivativesStatus};
pub use errors::{CoreError, CoreResult};
pub use fragments::ImportOutcome;
pub use models::{
    CandidateRect, CaptureError, CaptureFragmentRequest, CaptureFragmentResponse,
    FileCleanupReport, Fragment, FragmentFilter, Frame, ImageCandidate, PurgeReport, SmartFrame,
};
pub use processing::foreground_busy;
