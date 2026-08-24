pub mod app_paths;
pub mod capture;
pub mod db;
pub mod errors;
pub mod fragments;
pub mod frames;
pub mod hashing;
pub mod models;
pub mod smart_frames;
pub mod storage;
pub mod thumbnails;

pub use db::FragmentCore;
pub use errors::{CoreError, CoreResult};
pub use fragments::ImportOutcome;
pub use models::{
    CandidateRect, CaptureError, CaptureFragmentRequest, CaptureFragmentResponse,
    FileCleanupReport, Fragment, FragmentFilter, Frame, ImageCandidate, PurgeReport, SmartFrame,
};
