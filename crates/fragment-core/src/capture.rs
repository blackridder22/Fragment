use std::io::Read;
use std::time::{Duration, Instant};

use crate::media::AssetFormat;
use image::ImageFormat;
use url::Url;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::fragments::NewFragmentAsset;
use crate::models::{
    CaptureError, CaptureFragmentRequest, CaptureFragmentResponse, ImageUrlCandidate,
};

const MAX_DOWNLOAD_BYTES: u64 = 25 * 1024 * 1024;

impl FragmentCore {
    pub fn capture_fragment(
        &self,
        request: CaptureFragmentRequest,
    ) -> CoreResult<CaptureFragmentResponse> {
        if request.message_type != "capture.fragment" {
            return Err(CoreError::InvalidInput(
                "unsupported capture message type".to_string(),
            ));
        }

        let frame_ids = self.capture_frame_ids(&request)?;
        let DownloadedCaptureImage {
            image_url,
            bytes,
            format,
        } = self.download_capture_image(&request)?;
        let result = self.insert_fragments_from_asset(
            &frame_ids,
            NewFragmentAsset {
                bytes,
                format,
                title: request
                    .candidate
                    .title
                    .clone()
                    .or_else(|| request.candidate.alt.clone()),
                note: request.note.clone(),
                source_url: Some(image_url),
                page_url: Some(request.candidate.page_url.clone()),
                site_name: request.candidate.site_name.clone(),
                creator_name: None,
                captured_from: Some(request.candidate.source.clone()),
            },
            request.tags.as_deref().unwrap_or_default(),
            true,
        )?;
        let thumbnail_path = result
            .fragments
            .first()
            .map(|fragment| fragment.thumbnail_path.clone());
        let fragment_ids = result
            .fragments
            .into_iter()
            .map(|fragment| fragment.id)
            .collect::<Vec<_>>();
        let duplicate_ids = result
            .duplicates
            .into_iter()
            .map(|(fragment_id, _)| fragment_id)
            .collect::<Vec<_>>();

        Ok(CaptureFragmentResponse {
            message_type: "capture.fragment.result".to_string(),
            request_id: request.request_id,
            ok: true,
            fragment_id: fragment_ids.first().cloned(),
            fragment_ids: (!fragment_ids.is_empty()).then_some(fragment_ids),
            duplicate_of_fragment_id: duplicate_ids.first().cloned(),
            duplicate_of_fragment_ids: (!duplicate_ids.is_empty()).then_some(duplicate_ids),
            thumbnail_path,
            error: None,
        })
    }

    fn capture_frame_ids(&self, request: &CaptureFragmentRequest) -> CoreResult<Vec<String>> {
        let raw_ids = request
            .frame_ids
            .as_deref()
            .filter(|ids| !ids.is_empty())
            .map(|ids| ids.to_vec())
            .unwrap_or_else(|| request.frame_id.clone().into_iter().collect());
        let default_frame_id = self.default_frame_id()?;
        let mut frame_ids = Vec::new();
        for raw_id in raw_ids {
            let frame_id = if raw_id.trim().is_empty() {
                default_frame_id.clone()
            } else {
                raw_id
            };
            if !frame_ids.iter().any(|existing| existing == &frame_id) {
                self.require_frame(&frame_id)?;
                frame_ids.push(frame_id);
            }
        }
        if frame_ids.is_empty() {
            self.require_frame(&default_frame_id)?;
            frame_ids.push(default_frame_id);
        }
        Ok(frame_ids)
    }

    fn download_capture_image(
        &self,
        request: &CaptureFragmentRequest,
    ) -> CoreResult<DownloadedCaptureImage> {
        let urls = ranked_capture_urls(request)?;
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last_error = None;
        for image_url in urls {
            let url = match Url::parse(&image_url) {
                Ok(url) if matches!(url.scheme(), "http" | "https") => url,
                Ok(_) => {
                    last_error = Some(CoreError::UnsupportedImageSource);
                    continue;
                }
                Err(error) => {
                    last_error = Some(error.into());
                    continue;
                }
            };

            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Err(CoreError::InvalidInput(
                    "Capture download exceeded the 20 second budget".into(),
                ));
            };
            match self
                .download_image_bytes(url.as_str(), remaining)
                .and_then(|bytes| {
                    let format = AssetFormat::detect(&bytes)?;
                    Ok(DownloadedCaptureImage {
                        image_url: image_url.clone(),
                        bytes,
                        format,
                    })
                }) {
                Ok(downloaded) => return Ok(downloaded),
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or(CoreError::UnsupportedImageSource))
    }

    pub fn capture_error_response(
        request_id: String,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> CaptureFragmentResponse {
        CaptureFragmentResponse {
            message_type: "capture.fragment.result".to_string(),
            request_id,
            ok: false,
            fragment_id: None,
            fragment_ids: None,
            duplicate_of_fragment_id: None,
            duplicate_of_fragment_ids: None,
            thumbnail_path: None,
            error: Some(CaptureError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }

    fn download_image_bytes(&self, url: &str, timeout: Duration) -> CoreResult<Vec<u8>> {
        let mut response = self
            .http_client()?
            .get(url)
            .timeout(timeout)
            .send()?
            .error_for_status()?;
        if response.content_length().unwrap_or(0) > MAX_DOWNLOAD_BYTES {
            return Err(CoreError::DownloadTooLarge);
        }

        let mut prefix = Vec::new();
        response.by_ref().take(32).read_to_end(&mut prefix)?;
        let raster = image::guess_format(&prefix).is_ok();
        let limit = if raster {
            MAX_DOWNLOAD_BYTES
        } else {
            crate::svg::MAX_SVG_BYTES as u64
        };
        if response.content_length().unwrap_or(0) > limit {
            return Err(if raster {
                CoreError::DownloadTooLarge
            } else {
                crate::svg::SvgError::too_large().into()
            });
        }
        let mut limited = response.by_ref().take(limit + 1 - prefix.len() as u64);
        let mut bytes = prefix;
        limited.read_to_end(&mut bytes)?;
        if bytes.len() > limit as usize {
            return Err(if raster {
                CoreError::DownloadTooLarge
            } else {
                crate::svg::SvgError::too_large().into()
            });
        }
        Ok(bytes)
    }
}

struct DownloadedCaptureImage {
    image_url: String,
    bytes: Vec<u8>,
    format: AssetFormat,
}

fn ranked_capture_urls(request: &CaptureFragmentRequest) -> CoreResult<Vec<String>> {
    let mut candidates = Vec::new();
    if let Some(image_urls) = request.candidate.image_urls.as_deref() {
        for candidate in image_urls {
            candidates.push(ScoredCaptureUrl::from_image_url(candidate));
        }
    }
    if let Some(current_src) = request.candidate.current_src.as_deref() {
        candidates.push(ScoredCaptureUrl::legacy(current_src, "currentSrc"));
    }
    if let Some(source_url) = request.candidate.source_url.as_deref() {
        candidates.push(ScoredCaptureUrl::legacy(source_url, "sourceUrl"));
    }
    candidates.push(ScoredCaptureUrl::legacy(&request.candidate.src, "src"));

    let mut valid = candidates
        .into_iter()
        .filter_map(|candidate| candidate.valid())
        .collect::<Vec<_>>();
    valid.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));

    let mut urls = Vec::new();
    for candidate in valid {
        if !urls.iter().any(|url| url == &candidate.url) {
            urls.push(candidate.url);
        }
    }

    if urls.is_empty() {
        return Err(CoreError::UnsupportedImageSource);
    }
    Ok(urls)
}

#[allow(dead_code)]
fn best_capture_url(request: &CaptureFragmentRequest) -> CoreResult<String> {
    ranked_capture_urls(request)?
        .into_iter()
        .next()
        .ok_or(CoreError::UnsupportedImageSource)
}

#[derive(Debug, Clone)]
struct ScoredCaptureUrl {
    url: String,
    source: String,
    width: Option<i64>,
    density: Option<f64>,
}

#[derive(Debug, Clone)]
struct ValidScoredCaptureUrl {
    url: String,
    score: i64,
}

impl ScoredCaptureUrl {
    fn from_image_url(candidate: &ImageUrlCandidate) -> Self {
        Self {
            url: candidate.url.clone(),
            source: candidate.source.clone(),
            width: candidate.width,
            density: candidate.density,
        }
    }

    fn legacy(url: &str, source: &str) -> Self {
        Self {
            url: url.to_string(),
            source: source.to_string(),
            width: None,
            density: None,
        }
    }

    fn valid(self) -> Option<ValidScoredCaptureUrl> {
        let trimmed = self.url.trim();
        if trimmed.is_empty() {
            return None;
        }
        let parsed = Url::parse(trimmed).ok()?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return None;
        }
        Some(ValidScoredCaptureUrl {
            score: capture_url_score(&parsed, &self.source, self.width, self.density),
            url: trimmed.to_string(),
        })
    }
}

fn capture_url_score(url: &Url, source: &str, width: Option<i64>, density: Option<f64>) -> i64 {
    if matches!(source, "sourceUrl" | "linkedImage")
        && url.path().to_ascii_lowercase().ends_with(".svg")
    {
        return i64::MAX / 2;
    }
    let mut score = match source {
        "srcset" => 1_500,
        "currentSrc" => 1_200,
        "src" => 1_100,
        "sourceUrl" | "linkedImage" => 1_000,
        "poster" | "background" | "openGraph" => 900,
        _ => 750,
    };

    if direct_image_url(url) {
        score += 1_000;
    }
    if is_pinterest_original_url(url) {
        score += 100_000;
    }
    if is_pinterest_asset_url(url) {
        score += 5_000;
    }
    if source == "sourceUrl" && !direct_image_url(url) && !is_pinterest_asset_url(url) {
        score -= 10_000;
    }

    let width_hint = width
        .or_else(|| pinterest_width_hint(url))
        .unwrap_or_default()
        .clamp(0, 10_000);
    score += width_hint * 10;

    if let Some(density) = density {
        score += (density * 1_000.0).round() as i64;
    }

    score
}

fn direct_image_url(url: &Url) -> bool {
    url.path()
        .rsplit('/')
        .next()
        .map(|name| {
            let name = name.to_ascii_lowercase();
            matches!(
                name.rsplit('.').next(),
                Some("avif" | "bmp" | "gif" | "jpg" | "jpeg" | "png" | "webp" | "svg")
            )
        })
        .unwrap_or(false)
}

fn is_pinterest_asset_url(url: &Url) -> bool {
    url.host_str()
        .map(|host| host.ends_with("pinimg.com"))
        .unwrap_or(false)
}

fn is_pinterest_original_url(url: &Url) -> bool {
    is_pinterest_asset_url(url) && url.path().contains("/originals/")
}

fn pinterest_width_hint(url: &Url) -> Option<i64> {
    if !is_pinterest_asset_url(url) {
        return None;
    }
    url.path_segments()?.find_map(|segment| {
        segment
            .strip_suffix('x')
            .and_then(|value| value.parse::<i64>().ok())
    })
}

#[allow(dead_code)]
fn _format_is_known(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Png
            | ImageFormat::Jpeg
            | ImageFormat::Gif
            | ImageFormat::WebP
            | ImageFormat::Bmp
            | ImageFormat::Ico
            | ImageFormat::Tiff
    )
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use image::{ImageBuffer, ImageFormat, Rgba};
    use tempfile::tempdir;

    use crate::models::{CandidateRect, ImageCandidate};
    use crate::{CoreError, FragmentCore};

    fn sample_png_bytes() -> Vec<u8> {
        let image = ImageBuffer::from_fn(18, 12, |x, y| {
            if x % 3 == y % 3 {
                Rgba([245_u8, 245, 240, 255])
            } else {
                Rgba([8_u8, 10, 10, 255])
            }
        });
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("encode png");
        cursor.into_inner()
    }

    fn serve_once(bytes: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request_buffer = [0_u8; 1024];
            let _ = stream.read(&mut request_buffer);
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                bytes.len()
            );
            stream.write_all(headers.as_bytes()).expect("write headers");
            stream.write_all(&bytes).expect("write body");
        });
        format!("http://{address}/fragment.png")
    }

    fn serve_sequence(responses: Vec<(u16, Vec<u8>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        thread::spawn(move || {
            for (status, bytes) in responses {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut request_buffer = [0_u8; 1024];
                let _ = stream.read(&mut request_buffer);
                let status_text = if status == 200 { "OK" } else { "ERROR" };
                let headers = format!(
                    "HTTP/1.1 {status} {status_text}\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                );
                stream.write_all(headers.as_bytes()).expect("write headers");
                stream.write_all(&bytes).expect("write body");
            }
        });
        format!("http://{address}")
    }

    fn capture_request(src: String) -> crate::models::CaptureFragmentRequest {
        crate::models::CaptureFragmentRequest {
            message_type: "capture.fragment".to_string(),
            request_id: "capture-test".to_string(),
            frame_id: None,
            frame_ids: None,
            candidate: ImageCandidate {
                id: "candidate-1".to_string(),
                src,
                current_src: None,
                image_urls: None,
                page_url: "https://example.com/reference".to_string(),
                source_url: None,
                site_name: Some("Example".to_string()),
                alt: Some("Alt title".to_string()),
                title: None,
                width: 180,
                height: 120,
                natural_width: Some(18),
                natural_height: Some(12),
                rect: CandidateRect {
                    x: 0.0,
                    y: 0.0,
                    width: 180.0,
                    height: 120.0,
                },
                source: "generic".to_string(),
            },
            note: Some("captured note".to_string()),
            tags: Some(vec!["glass".to_string(), " reference ".to_string()]),
            requested_at: "2026-06-24T12:00:00Z".to_string(),
            extension_version: "0.0.3".to_string(),
        }
    }

    #[test]
    fn capture_fragment_downloads_and_stores_url_image() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let image_url = serve_once(sample_png_bytes());

        let response = core
            .capture_fragment(capture_request(image_url.clone()))
            .expect("capture");

        assert!(response.ok);
        assert_eq!(response.request_id, "capture-test");
        assert!(response.thumbnail_path.is_some());
        let fragment = core
            .get_fragment(response.fragment_id.expect("fragment id"))
            .expect("fragment");
        assert_eq!(fragment.title.as_deref(), Some("Alt title"));
        assert_eq!(fragment.note.as_deref(), Some("captured note"));
        assert_eq!(fragment.source_url.as_deref(), Some(image_url.as_str()));
        assert_eq!(
            fragment.page_url.as_deref(),
            Some("https://example.com/reference")
        );
        assert_eq!(fragment.site_name.as_deref(), Some("Example"));
        assert_eq!(fragment.width, Some(18));
        assert_eq!(fragment.height, Some(12));
        for relative_path in [
            Some(fragment.original_path.as_str()),
            Some(fragment.thumbnail_path.as_str()),
            fragment.preview_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            assert!(
                core.paths()
                    .resolve_relative_path(relative_path)
                    .expect("resolve")
                    .is_file(),
                "{relative_path} should exist"
            );
        }
    }

    #[test]
    fn capture_fragment_rejects_non_http_sources() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let error = core
            .capture_fragment(capture_request("data:image/png;base64,AAAA".to_string()))
            .expect_err("data url rejected");
        assert!(matches!(error, CoreError::UnsupportedImageSource));
    }

    #[test]
    fn best_capture_url_prefers_largest_srcset_candidate() {
        let mut request =
            capture_request("https://i.pinimg.com/236x/aa/bb/cc/photo.jpg".to_string());
        request.candidate.current_src =
            Some("https://i.pinimg.com/474x/aa/bb/cc/photo.jpg".to_string());
        request.candidate.image_urls = Some(vec![
            crate::models::ImageUrlCandidate {
                url: "https://i.pinimg.com/474x/aa/bb/cc/photo.jpg".to_string(),
                source: "currentSrc".to_string(),
                descriptor: None,
                width: None,
                density: None,
            },
            crate::models::ImageUrlCandidate {
                url: "https://i.pinimg.com/1200x/aa/bb/cc/photo.jpg".to_string(),
                source: "srcset".to_string(),
                descriptor: Some("1200w".to_string()),
                width: Some(1200),
                density: None,
            },
        ]);

        let url = super::best_capture_url(&request).expect("best url");
        assert_eq!(url, "https://i.pinimg.com/1200x/aa/bb/cc/photo.jpg");
    }

    #[test]
    fn capture_fragment_retries_next_candidate_after_download_failure() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let base_url = serve_sequence(vec![(500, b"nope".to_vec()), (200, sample_png_bytes())]);
        let mut request = capture_request(format!("{base_url}/236x/fallback.png"));
        let failed_url = format!("{base_url}/originals/bad.png");
        let ok_url = format!("{base_url}/1200x/good.png");
        request.candidate.image_urls = Some(vec![
            crate::models::ImageUrlCandidate {
                url: failed_url,
                source: "srcset".to_string(),
                descriptor: Some("2000w".to_string()),
                width: Some(2000),
                density: None,
            },
            crate::models::ImageUrlCandidate {
                url: ok_url.clone(),
                source: "srcset".to_string(),
                descriptor: Some("1200w".to_string()),
                width: Some(1200),
                density: None,
            },
        ]);

        let response = core.capture_fragment(request).expect("capture");
        assert!(response.ok);
        let fragment = core
            .get_fragment(response.fragment_id.expect("fragment id"))
            .expect("fragment");
        assert_eq!(fragment.source_url.as_deref(), Some(ok_url.as_str()));
    }

    #[test]
    fn capture_fragment_saves_one_download_into_multiple_frames() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let frame_a = core.create_frame(None, "A".to_string()).expect("frame a");
        let frame_b = core.create_frame(None, "B".to_string()).expect("frame b");
        let image_url = serve_once(sample_png_bytes());
        let mut request = capture_request(image_url);
        request.frame_ids = Some(vec![frame_a.id.clone(), frame_b.id.clone()]);

        let response = core.capture_fragment(request).expect("capture");
        assert!(response.ok);
        assert_eq!(response.fragment_ids.as_ref().map(Vec::len), Some(2));
        let a = core
            .list_fragments(frame_a.id)
            .expect("fragments a")
            .pop()
            .expect("fragment a");
        let b = core
            .list_fragments(frame_b.id)
            .expect("fragments b")
            .pop()
            .expect("fragment b");
        assert_eq!(a.asset_id, b.asset_id);
        assert_eq!(a.original_path, b.original_path);
        let conn = core.conn().expect("conn");
        let tag_memberships: i64 = conn
            .query_row("SELECT count(*) FROM fragment_tags", [], |row| row.get(0))
            .expect("tag memberships");
        assert_eq!(tag_memberships, 4);
    }
}
