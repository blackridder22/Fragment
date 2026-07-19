use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fragment {
    pub id: String,
    pub asset_id: Option<String>,
    pub frame_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub source_url: Option<String>,
    pub page_url: Option<String>,
    pub site_name: Option<String>,
    pub creator_name: Option<String>,
    pub original_path: String,
    pub thumbnail_path: String,
    pub preview_path: Option<String>,
    pub mime_type: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub file_size: Option<i64>,
    pub sha256: Option<String>,
    pub perceptual_hash: Option<String>,
    pub captured_from: Option<String>,
    pub captured_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub delete_after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportDuplicateCheck {
    pub duplicate: bool,
    pub kind: Option<String>,
    pub existing_fragment_id: Option<String>,
    pub existing_frame_id: Option<String>,
    pub existing_frame_name: Option<String>,
    pub existing_title: Option<String>,
    pub suggested_title: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileCleanupReport {
    pub removed: u64,
    pub deferred: u64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PurgeReport {
    pub fragments: u64,
    pub frames: u64,
    pub assets: u64,
    pub cleanup: FileCleanupReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageUrlCandidate {
    pub url: String,
    pub source: String,
    pub descriptor: Option<String>,
    pub width: Option<i64>,
    pub density: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCandidate {
    pub id: String,
    pub src: String,
    pub current_src: Option<String>,
    pub image_urls: Option<Vec<ImageUrlCandidate>>,
    pub page_url: String,
    pub source_url: Option<String>,
    pub site_name: Option<String>,
    pub alt: Option<String>,
    pub title: Option<String>,
    pub width: i64,
    pub height: i64,
    pub natural_width: Option<i64>,
    pub natural_height: Option<i64>,
    pub rect: CandidateRect,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFragmentRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub frame_id: Option<String>,
    pub frame_ids: Option<Vec<String>>,
    pub candidate: ImageCandidate,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
    pub requested_at: String,
    pub extension_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFragmentResponse {
    #[serde(rename = "type")]
    pub message_type: String,
    pub request_id: String,
    pub ok: bool,
    pub fragment_id: Option<String>,
    pub fragment_ids: Option<Vec<String>>,
    pub duplicate_of_fragment_id: Option<String>,
    pub duplicate_of_fragment_ids: Option<Vec<String>>,
    pub thumbnail_path: Option<String>,
    pub error: Option<CaptureError>,
}
