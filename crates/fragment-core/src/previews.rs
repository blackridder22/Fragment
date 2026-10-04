//! Coalesced, cancelable SVG preview derivatives. The original and base PNGs are never evicted.
use crate::{
    svg::{RenderWarning, SvgError, SvgErrorCode},
    CoreError, CoreResult, FragmentCore,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const CACHE_BYTES: i64 = 512 * 1024 * 1024;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub kind: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub warnings: Vec<RenderWarning>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgPreview {
    pub relative_path: String,
    pub tier: u32,
}
struct Job {
    cancel: AtomicBool,
    result: Mutex<Option<Result<SvgPreview, SvgError>>>,
    done: Condvar,
    consumers: Mutex<HashSet<String>>,
}
#[derive(Default)]
struct Jobs {
    by_key: HashMap<String, Arc<Job>>,
    requests: HashMap<String, String>,
    // A cancel command can arrive before its spawn_blocking request is scheduled.
    cancelled: HashMap<String, Instant>,
}
static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
fn jobs() -> &'static Mutex<Jobs> {
    JOBS.get_or_init(Mutex::default)
}
fn error(message: impl Into<String>) -> SvgError {
    SvgError::new(SvgErrorCode::SvgWorkerUnavailable, message)
}

pub fn cancel_preview(request_id: &str) {
    if request_id.is_empty() || request_id.len() > 128 {
        return;
    }
    if let Ok(mut jobs) = jobs().lock() {
        jobs.cancelled
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if jobs.cancelled.len() >= 256 {
            if let Some(oldest) = jobs
                .cancelled
                .iter()
                .min_by_key(|(_, at)| **at)
                .map(|(id, _)| id.clone())
            {
                jobs.cancelled.remove(&oldest);
            }
        }
        jobs.cancelled
            .insert(request_id.to_string(), Instant::now());
        if let Some(key) = jobs.requests.remove(request_id) {
            if let Some(job) = jobs.by_key.get(&key).cloned() {
                if let Ok(mut consumers) = job.consumers.lock() {
                    consumers.remove(request_id);
                    if consumers.is_empty() {
                        job.cancel.store(true, Ordering::Release);
                        // A new consumer must not join a job whose child is being killed.
                        jobs.by_key.remove(&key);
                    }
                }
            }
        }
    }
}

impl FragmentCore {
    pub fn fragment_media_info(&self, id: &str) -> CoreResult<MediaInfo> {
        let fragment = self.get_fragment_including_deleted(id.to_string())?;
        let conn = self.conn()?;
        let warnings: Option<String> = conn
            .query_row(
                "SELECT render_warnings_json FROM assets WHERE id=?1",
                params![fragment.asset_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(MediaInfo {
            kind: if fragment.mime_type.as_deref() == Some("image/svg+xml") {
                "vector"
            } else {
                "raster"
            }
            .into(),
            width: fragment.width,
            height: fragment.height,
            warnings: warnings
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        })
    }

    pub fn ensure_svg_preview(
        &self,
        id: &str,
        max_edge: u32,
        request_id: &str,
    ) -> CoreResult<SvgPreview> {
        self.ensure_svg_preview_with_repair(id, max_edge, request_id, false)
    }

    pub fn ensure_svg_preview_with_repair(
        &self,
        id: &str,
        max_edge: u32,
        request_id: &str,
        repair: bool,
    ) -> CoreResult<SvgPreview> {
        if request_id.is_empty() || request_id.len() > 128 || max_edge == 0 || max_edge > 4096 {
            return Err(CoreError::InvalidInput(
                "Invalid SVG preview request".into(),
            ));
        }
        if jobs()
            .lock()
            .map_err(|_| error("Preview queue unavailable"))?
            .cancelled
            .contains_key(request_id)
        {
            return Err(
                SvgError::new(SvgErrorCode::SvgCancelled, "SVG preview was cancelled").into(),
            );
        }
        let fragment = self.get_fragment_including_deleted(id.to_string())?;
        if fragment.mime_type.as_deref() != Some("image/svg+xml") {
            return Err(CoreError::InvalidInput("Fragment is not an SVG".into()));
        }
        let asset_id = fragment
            .asset_id
            .as_deref()
            .ok_or_else(|| CoreError::NotFound("Asset".into()))?;
        let tier = if max_edge <= 1600 {
            1600
        } else if max_edge <= 3200 {
            3200
        } else {
            4096
        };
        let fingerprint = format!(
            "{}:{}",
            fragment.sha256.as_deref().unwrap_or_default(),
            crate::svg::font_fingerprint()
        );
        if let Some(preview) = if repair {
            None
        } else {
            self.cached_preview(&fragment, &fingerprint, tier)?
        } {
            return Ok(preview);
        }
        let key = format!(
            "{}:{asset_id}:{fingerprint}:{tier}",
            self.paths().root().display()
        );
        let (job, owner) = {
            let mut jobs = jobs()
                .lock()
                .map_err(|_| error("Preview queue unavailable"))?;
            if jobs.cancelled.contains_key(request_id) {
                return Err(
                    SvgError::new(SvgErrorCode::SvgCancelled, "SVG preview was cancelled").into(),
                );
            }
            if jobs.requests.contains_key(request_id) {
                return Err(CoreError::InvalidInput(
                    "Preview request ID is already active".into(),
                ));
            }
            if jobs.requests.len() >= 128
                || (!jobs.by_key.contains_key(&key) && jobs.by_key.len() >= 8)
            {
                return Err(
                    SvgError::new(SvgErrorCode::SvgBusy, "SVG preview queue is full").into(),
                );
            }
            let owner = !jobs.by_key.contains_key(&key);
            let job = jobs
                .by_key
                .entry(key.clone())
                .or_insert_with(|| {
                    Arc::new(Job {
                        cancel: AtomicBool::new(false),
                        result: Mutex::new(None),
                        done: Condvar::new(),
                        consumers: Mutex::new(HashSet::new()),
                    })
                })
                .clone();
            job.consumers
                .lock()
                .map_err(|_| error("Preview queue unavailable"))?
                .insert(request_id.to_string());
            jobs.requests.insert(request_id.to_string(), key.clone());
            (job, owner)
        };
        if owner {
            let result = self
                .render_preview(&fragment, &fingerprint, tier, &job.cancel)
                .map_err(|e| match e {
                    CoreError::Svg(e) => e,
                    _ => error(e.to_string()),
                });
            *job.result
                .lock()
                .map_err(|_| error("Preview result unavailable"))? = Some(result);
            job.done.notify_all();
        }
        let result = {
            let mut result = job
                .result
                .lock()
                .map_err(|_| error("Preview result unavailable"))?;
            while result.is_none() {
                result = job
                    .done
                    .wait(result)
                    .map_err(|_| error("Preview result unavailable"))?;
            }
            result
                .as_ref()
                .cloned()
                .ok_or_else(|| error("Missing preview result"))?
        };
        let mut jobs = jobs()
            .lock()
            .map_err(|_| error("Preview queue unavailable"))?;
        jobs.requests.remove(request_id);
        let mut consumers = job
            .consumers
            .lock()
            .map_err(|_| error("Preview queue unavailable"))?;
        let active = consumers.remove(request_id);
        if consumers.is_empty()
            && jobs
                .by_key
                .get(&key)
                .is_some_and(|current| Arc::ptr_eq(current, &job))
        {
            jobs.by_key.remove(&key);
        }
        if !active {
            return Err(
                SvgError::new(SvgErrorCode::SvgCancelled, "SVG preview was cancelled").into(),
            );
        }
        result.map_err(Into::into)
    }

    fn cached_preview(
        &self,
        fragment: &crate::Fragment,
        fingerprint: &str,
        tier: u32,
    ) -> CoreResult<Option<SvgPreview>> {
        let relative = if tier == 1600 {
            fragment.preview_path.clone()
        } else {
            let conn = self.conn()?;
            conn.query_row("SELECT relative_path FROM asset_preview_cache WHERE asset_id=?1 AND fingerprint=?2 AND tier=?3",params![fragment.asset_id,fingerprint,tier],|r|r.get(0)).optional()?
        };
        let Some(relative_path) = relative else {
            return Ok(None);
        };
        let path = self.paths().resolve_relative_path(&relative_path)?;
        // Reads only image headers, never reparses SVG on a cache hit.
        if image::image_dimensions(&path).is_err() {
            return Ok(None);
        }
        if tier > 1600 {
            self.conn()?.execute(
                "UPDATE asset_preview_cache SET last_access=?1 WHERE relative_path=?2",
                params![Utc::now().timestamp_millis(), relative_path],
            )?;
        }
        Ok(Some(SvgPreview {
            relative_path,
            tier,
        }))
    }

    fn render_preview(
        &self,
        fragment: &crate::Fragment,
        fingerprint: &str,
        tier: u32,
        cancel: &AtomicBool,
    ) -> CoreResult<SvgPreview> {
        let _permit = crate::processing::acquire();
        let (bytes, format) = crate::media::read_asset(
            &self
                .paths()
                .resolve_relative_path(&fragment.original_path)?,
        )?;
        if format != crate::media::AssetFormat::Svg {
            return Err(CoreError::InvalidInput(
                "SVG original no longer matches its format".into(),
            ));
        }
        if Some(crate::hashing::sha256_hex(&bytes)) != fragment.sha256 {
            return Err(CoreError::InvalidInput(
                "SVG original has changed outside Fragment".into(),
            ));
        }
        let tiers = if tier == 1600 {
            vec![640, 1600]
        } else {
            vec![tier]
        };
        let render =
            crate::svg_worker::render_svg(&bytes, &tiers, &self.paths().temp_dir(), cancel)?;
        if cancel.load(Ordering::Acquire) {
            return Err(
                SvgError::new(SvgErrorCode::SvgCancelled, "SVG preview was cancelled").into(),
            );
        }
        let asset_id = fragment
            .asset_id
            .as_deref()
            .ok_or_else(|| CoreError::NotFound("Asset".into()))?;
        let relative_path = if tier == 1600 {
            fragment
                .preview_path
                .clone()
                .ok_or_else(|| CoreError::NotFound("Base preview".into()))?
        } else {
            format!(
                "previews/svg-cache/{}-{tier}-{}.png",
                asset_id,
                uuid::Uuid::new_v4()
            )
        };
        let png = render.png(tier)?;
        let absolute = self.paths().resolve_relative_path(&relative_path)?;
        // All image work is complete before the short transaction. Deletion cannot race publication.
        let publication = (|| -> CoreResult<()> {
            let mut conn = self.conn()?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1 AND sha256=?2)",
                params![asset_id, fragment.sha256],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(CoreError::NotFound("Asset".into()));
            }
            crate::storage::write_atomic(&absolute, &png)?;
            if tier == 1600 {
                crate::storage::write_atomic(
                    &self
                        .paths()
                        .resolve_relative_path(&fragment.thumbnail_path)?,
                    &render.png(640)?,
                )?;
            } else {
                let previous:Option<String>=tx.query_row("SELECT relative_path FROM asset_preview_cache WHERE asset_id=?1 AND fingerprint=?2 AND tier=?3",params![asset_id,fingerprint,tier],|r|r.get(0)).optional()?;
                if let Some(path) = previous {
                    crate::fragments::enqueue_cleanup_paths(&tx, [path.as_str()])?;
                }
                tx.execute("INSERT INTO asset_preview_cache(asset_id,fingerprint,tier,relative_path,byte_size,last_access) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(asset_id,fingerprint,tier) DO UPDATE SET relative_path=excluded.relative_path,byte_size=excluded.byte_size,last_access=excluded.last_access",params![asset_id,fingerprint,tier,relative_path,png.len() as i64,Utc::now().timestamp_millis()])?;
                evict(&tx, asset_id)?;
            }
            tx.commit()?;
            Ok(())
        })();
        if publication.is_err() && tier > 1600 {
            let _ = fs::remove_file(absolute);
        }
        publication?;
        self.retry_cleanup_best_effort();
        Ok(SvgPreview {
            relative_path,
            tier,
        })
    }
}

fn evict(conn: &rusqlite::Connection, asset_id: &str) -> CoreResult<()> {
    let mut query=conn.prepare("SELECT relative_path FROM asset_preview_cache WHERE asset_id=?1 ORDER BY last_access DESC,relative_path LIMIT -1 OFFSET 2")?;
    let mut paths = query
        .query_map(params![asset_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(query);
    for path in &paths {
        conn.execute(
            "DELETE FROM asset_preview_cache WHERE relative_path=?1",
            params![path],
        )?;
    }
    let mut bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(byte_size),0) FROM asset_preview_cache",
        [],
        |r| r.get(0),
    )?;
    let mut query=conn.prepare("SELECT relative_path,byte_size FROM asset_preview_cache ORDER BY last_access,relative_path")?;
    let entries = query
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(query);
    for (path, size) in entries {
        if bytes <= CACHE_BYTES {
            break;
        }
        conn.execute(
            "DELETE FROM asset_preview_cache WHERE relative_path=?1",
            params![path],
        )?;
        bytes -= size;
        paths.push(path);
    }
    crate::fragments::enqueue_cleanup_paths(conn, paths.iter().map(String::as_str))?;
    Ok(())
}
