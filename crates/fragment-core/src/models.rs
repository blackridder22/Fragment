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
    /// Displayed pixel size: EXIF orientation is already applied (raster only).
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct FragmentFilter {
    pub color: Option<ColorFilter>,
    pub query: Option<String>,
    pub tags: Vec<String>,
    pub mime_types: Vec<String>,
    pub source_domain: Option<String>,
    pub source_kind: Option<String>,
    pub captured_after: Option<String>,
    pub captured_before: Option<String>,
    pub min_width: Option<i64>,
    pub max_width: Option<i64>,
    pub min_height: Option<i64>,
    pub max_height: Option<i64>,
    pub orientation: Option<String>,
    pub min_file_size: Option<i64>,
    pub max_file_size: Option<i64>,
    pub has_notes: Option<bool>,
    pub note_contains: Option<String>,
    pub title_contains: Option<String>,
    pub site_contains: Option<String>,
    pub creator_contains: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColorFilter {
    pub hex: String,
    pub tolerance: u16,
}

impl ColorFilter {
    pub fn lab(&self) -> crate::CoreResult<[f64; 3]> {
        if self.hex.len() != 7
            || !self.hex.starts_with('#')
            || !self.hex.as_bytes()[1..]
                .iter()
                .all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(b))
            || self.tolerance > 200
        {
            return Err(crate::CoreError::InvalidInput(
                "Color requires uppercase #RRGGBB and an integer tolerance from 0 to 200".into(),
            ));
        }
        let byte = |start| {
            u8::from_str_radix(&self.hex[start..start + 2], 16)
                .map_err(|_| crate::CoreError::InvalidInput("Invalid HEX color".into()))
        };
        Ok(crate::palette::rgb_lab(byte(1)?, byte(3)?, byte(5)?))
    }
}

pub struct FragmentPageSnapshot {
    pub items: Vec<Fragment>,
    pub total: u64,
    pub revision: String,
    pub palette_revision: String,
}

/// The latest active Fragments inside one top-level Frame, including its nested Frames.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FramePreview {
    pub frame_id: String,
    pub fragments: Vec<Fragment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SmartFrame {
    pub id: String,
    pub name: String,
    pub filter: FragmentFilter,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
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
