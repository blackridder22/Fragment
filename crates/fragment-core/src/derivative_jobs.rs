//! Background regeneration of raster derivatives into the current format.
//!
//! Modelled on `palette_jobs.rs`: one app-lifetime worker leases assets whose
//! `derivatives_version` is below [`CURRENT_DERIVATIVES_VERSION`], decodes the
//! original outside the DB lock, writes the new files atomically, then commits
//! paths and version in one transaction. Old files are queued for deletion
//! inside that same transaction with `deferred_until_relaunch = 1`: the running
//! WebView may still show them (its candidate chain only refetches on focus),
//! so they are swept by the desktop shell at its next launch instead of right
//! after the commit. A crash at any point leaves the Vault browsable with either
//! the old or the new derivatives.
use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    fragments::enqueue_deferred_cleanup_paths,
    media::{read_asset, AssetFormat},
    storage::write_atomic,
    thumbnails::{
        decode_image, encode_preview, encode_thumbnail, needs_preview, preview_image,
        thumbnail_image, CURRENT_DERIVATIVES_VERSION, DERIVATIVE_EXTENSION,
    },
    CoreError, CoreResult, FragmentCore,
};

const MAX_ATTEMPTS: i64 = 3;
const LEASE_SECONDS: i64 = 120;
const MAX_BATCH: usize = 25;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivativesStatus {
    /// Assets still waiting for regeneration (includes retryable failures).
    pub pending: u64,
    /// Assets already at the current derivative version.
    pub done: u64,
    /// Assets that failed [`MAX_ATTEMPTS`] times and need a manual retry.
    pub failed: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DerivativesBatch {
    pub completed: Vec<String>,
    pub failed: Vec<String>,
    /// The batch stopped early because a foreground import or preview is running.
    pub paused: bool,
}

/// Paths the worker produced for one asset, relative to the Vault root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewDerivatives {
    pub thumbnail_path: String,
    pub preview_path: Option<String>,
    /// Files this run created; removed again if publication is refused.
    pub written: Vec<String>,
}

#[derive(Debug, Clone)]
struct LeasedAsset {
    id: String,
    token: String,
    attempts: i64,
    sha256: Option<String>,
    original_path: String,
    thumbnail_path: String,
    preview_path: Option<String>,
}

impl FragmentCore {
    pub fn derivatives_status(&self) -> CoreResult<DerivativesStatus> {
        let conn = self.conn()?;
        let (done, failed, pending) = conn.query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN a.derivatives_version >= ?1 THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.derivatives_version < ?1 AND j.status = 'failed' THEN 1 ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN a.derivatives_version < ?1 AND COALESCE(j.status, '') <> 'failed' THEN 1 ELSE 0 END), 0)
             FROM assets a LEFT JOIN asset_derivative_jobs j ON j.asset_id = a.id",
            params![CURRENT_DERIVATIVES_VERSION],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
        )?;
        Ok(DerivativesStatus {
            pending: u64::try_from(pending).unwrap_or_default(),
            done: u64::try_from(done).unwrap_or_default(),
            failed: u64::try_from(failed).unwrap_or_default(),
        })
    }

    /// Clears terminal failures so the worker picks them up again.
    pub fn retry_failed_derivatives(&self) -> CoreResult<u64> {
        let conn = self.conn()?;
        let changed = conn.execute(
            "UPDATE asset_derivative_jobs SET status = 'pending', attempts = 0, error_code = NULL,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ?1 WHERE status = 'failed'",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(u64::try_from(changed).unwrap_or_default())
    }

    /// One batch for the single app-lifetime worker. Active Fragments go first,
    /// Trash-only assets last. Stops early while a foreground import or preview runs.
    pub fn process_derivatives_batch(&self, limit: usize) -> CoreResult<DerivativesBatch> {
        let ids = {
            let conn = self.conn()?;
            let mut query = conn.prepare(
                "SELECT a.id FROM assets a LEFT JOIN asset_derivative_jobs j ON j.asset_id = a.id
                 WHERE a.derivatives_version < ?1
                   AND (j.asset_id IS NULL OR j.status = 'pending'
                        OR (j.status = 'processing' AND j.lease_expires_at <= ?2))
                 ORDER BY EXISTS(SELECT 1 FROM fragments f WHERE f.asset_id = a.id AND f.deleted_at IS NULL) DESC,
                          a.created_at DESC, a.id
                 LIMIT ?3",
            )?;
            let ids = query
                .query_map(
                    params![
                        CURRENT_DERIVATIVES_VERSION,
                        Utc::now().timestamp(),
                        limit.clamp(1, MAX_BATCH) as i64
                    ],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        let mut batch = DerivativesBatch::default();
        for id in ids {
            if crate::processing::foreground_busy() {
                batch.paused = true;
                break;
            }
            match self.regenerate_asset_derivatives(&id)? {
                Some(true) => batch.completed.push(id),
                Some(false) => batch.failed.push(id),
                None => {}
            }
        }
        Ok(batch)
    }

    /// `Some(true)` regenerated, `Some(false)` attempt failed, `None` nothing to do
    /// (already current, leased elsewhere, or deleted meanwhile).
    pub fn regenerate_asset_derivatives(&self, id: &str) -> CoreResult<Option<bool>> {
        let Some(leased) = self.lease_asset(id)? else {
            return Ok(None);
        };
        let produced = self.produce_derivatives(&leased);
        match produced {
            Ok(new) => {
                let published = self.publish_derivatives(&leased.id, &leased.token, &new)?;
                if published {
                    // The replaced files stay on disk until the next launch sweeps them;
                    // the live UI may still reference their paths.
                    Ok(Some(true))
                } else {
                    self.remove_written(&new.written);
                    Ok(None)
                }
            }
            Err(error) => {
                tracing::warn!(asset = %leased.id, attempts = leased.attempts, %error, "derivative regeneration failed");
                self.fail_lease(&leased, &error)?;
                Ok(Some(false))
            }
        }
    }

    fn lease_asset(&self, id: &str) -> CoreResult<Option<LeasedAsset>> {
        let token = Uuid::new_v4().to_string();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some((sha256, original_path, thumbnail_path, preview_path, version)) = tx
            .query_row(
                "SELECT sha256, original_path, thumbnail_path, preview_path, derivatives_version
                 FROM assets WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?
        else {
            return Ok(None);
        };
        if version >= CURRENT_DERIVATIVES_VERSION {
            return Ok(None);
        }
        let now = Utc::now().timestamp();
        let changed = tx.execute(
            "INSERT INTO asset_derivative_jobs(asset_id, status, attempts, lease_token, lease_expires_at, updated_at)
             VALUES (?1, 'processing', 1, ?2, ?3, ?4)
             ON CONFLICT(asset_id) DO UPDATE SET
               status = 'processing', attempts = asset_derivative_jobs.attempts + 1,
               lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at,
               updated_at = excluded.updated_at
             WHERE asset_derivative_jobs.status = 'pending'
                OR (asset_derivative_jobs.status = 'processing' AND asset_derivative_jobs.lease_expires_at <= ?5)",
            params![id, token, now + LEASE_SECONDS, Utc::now().to_rfc3339(), now],
        )?;
        if changed == 0 {
            return Ok(None);
        }
        let attempts: i64 = tx.query_row(
            "SELECT attempts FROM asset_derivative_jobs WHERE asset_id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        tx.commit()?;
        Ok(Some(LeasedAsset {
            id: id.to_string(),
            token,
            attempts,
            sha256,
            original_path,
            thumbnail_path,
            preview_path,
        }))
    }

    /// All image work. Holds no DB lock. SVG assets keep their PNG tiers untouched.
    fn produce_derivatives(&self, leased: &LeasedAsset) -> CoreResult<NewDerivatives> {
        let original = self.paths().resolve_relative_path(&leased.original_path)?;
        let (bytes, format) = read_asset(&original)?;
        if let Some(expected) = leased.sha256.as_deref() {
            if crate::hashing::sha256_hex(&bytes) != expected {
                return Err(CoreError::InvalidInput(
                    "original has changed outside Fragment".to_string(),
                ));
            }
        }
        let raster = match format {
            AssetFormat::Raster(format) => format,
            AssetFormat::Svg => {
                return Ok(NewDerivatives {
                    thumbnail_path: leased.thumbnail_path.clone(),
                    preview_path: leased.preview_path.clone(),
                    written: Vec::new(),
                });
            }
        };
        let image = decode_image(&bytes)?;
        let thumbnail_abs = self
            .paths()
            .thumbnails_dir()
            .join(format!("{}.{DERIVATIVE_EXTENSION}", leased.id));
        let thumbnail_path = self.paths().to_relative_string(&thumbnail_abs)?;
        let mut written = Vec::new();
        write_atomic(&thumbnail_abs, &encode_thumbnail(&thumbnail_image(&image))?)?;
        written.push(thumbnail_path.clone());
        let preview_path = if needs_preview(raster, image.width(), image.height()) {
            let preview_abs = self
                .paths()
                .previews_dir()
                .join(format!("{}.{DERIVATIVE_EXTENSION}", leased.id));
            let relative = self.paths().to_relative_string(&preview_abs)?;
            write_atomic(&preview_abs, &encode_preview(&preview_image(&image))?)?;
            written.push(relative.clone());
            Some(relative)
        } else {
            Some(leased.original_path.clone())
        };
        Ok(NewDerivatives {
            thumbnail_path,
            preview_path,
            written,
        })
    }

    /// Commits new paths and version, queues the replaced files for deletion at
    /// the next launch, and releases the lease, all in one transaction. Returns
    /// `false` (and changes nothing) when the lease was lost or the asset was
    /// deleted or replaced.
    pub(crate) fn publish_derivatives(
        &self,
        asset_id: &str,
        token: &str,
        new: &NewDerivatives,
    ) -> CoreResult<bool> {
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let published = publish_in_tx(&tx, asset_id, token, new)?;
        if published {
            tx.commit()?;
        }
        Ok(published)
    }

    fn fail_lease(&self, leased: &LeasedAsset, error: &CoreError) -> CoreResult<()> {
        let terminal = leased.attempts >= MAX_ATTEMPTS;
        let code = match error {
            CoreError::Io(_) => "original_unreadable",
            CoreError::Image(_) => "decode_failed",
            _ => "regeneration_failed",
        };
        let conn = self.conn()?;
        conn.execute(
            "UPDATE asset_derivative_jobs SET status = ?1, error_code = ?2, lease_token = NULL,
             lease_expires_at = NULL, updated_at = ?3 WHERE asset_id = ?4 AND lease_token = ?5",
            params![
                if terminal { "failed" } else { "pending" },
                code,
                Utc::now().to_rfc3339(),
                leased.id,
                leased.token
            ],
        )?;
        Ok(())
    }

    fn remove_written(&self, written: &[String]) {
        for relative in written {
            if let Ok(path) = self.paths().resolve_relative_path(relative) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn publish_in_tx(
    tx: &Connection,
    asset_id: &str,
    token: &str,
    new: &NewDerivatives,
) -> CoreResult<bool> {
    let Some((original_path, old_thumbnail, old_preview)) = tx
        .query_row(
            "SELECT a.original_path, a.thumbnail_path, a.preview_path
             FROM assets a JOIN asset_derivative_jobs j ON j.asset_id = a.id
             WHERE a.id = ?1 AND j.lease_token = ?2 AND j.status = 'processing'
               AND a.derivatives_version < ?3",
            params![asset_id, token, CURRENT_DERIVATIVES_VERSION],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(false);
    };
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE assets SET thumbnail_path = ?1, preview_path = ?2, derivatives_version = ?3,
         updated_at = ?4 WHERE id = ?5",
        params![
            new.thumbnail_path,
            new.preview_path,
            CURRENT_DERIVATIVES_VERSION,
            now,
            asset_id
        ],
    )?;
    // Legacy per-membership copies stay consistent with the asset.
    tx.execute(
        "UPDATE fragments SET thumbnail_path = ?1, preview_path = ?2 WHERE asset_id = ?3",
        params![new.thumbnail_path, new.preview_path, asset_id],
    )?;
    tx.execute(
        "DELETE FROM asset_derivative_jobs WHERE asset_id = ?1",
        params![asset_id],
    )?;
    let keep: Vec<&str> = [
        Some(new.thumbnail_path.as_str()),
        new.preview_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect();
    let replaced: Vec<PathBuf> = [Some(old_thumbnail.as_str()), old_preview.as_deref()]
        .into_iter()
        .flatten()
        .filter(|path| *path != original_path && !keep.contains(path))
        .map(PathBuf::from)
        .collect();
    enqueue_deferred_cleanup_paths(tx, replaced.iter().filter_map(|path| path.to_str()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    /// Tests share one process with concurrent imports, which hold foreground
    /// permits and pause background batches. Retry until a batch actually ran.
    fn run_batch(core: &FragmentCore) -> DerivativesBatch {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            let batch = core.process_derivatives_batch(10).expect("batch");
            if !batch.paused {
                return batch;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "batch never became runnable"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_fn(width, height, |x, y| {
            Rgba([(x % 256) as u8, (y % 256) as u8, 90, 255])
        });
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, ImageFormat::Png).expect("png");
        cursor.into_inner()
    }

    /// Imports an image, then rewrites it to look like a v1 Vault entry with PNG derivatives.
    fn legacy_vault(width: u32, height: u32) -> (tempfile::TempDir, FragmentCore, crate::Fragment) {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("source.png");
        std::fs::write(&source, png_bytes(width, height)).expect("source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source.to_string_lossy().into_owned(), None)
            .expect("import");
        let asset_id = fragment.asset_id.clone().expect("asset id");
        let image = image::open(&source).expect("open");
        let legacy_thumbnail = format!("thumbnails/{asset_id}.png");
        let legacy_preview = format!("previews/{asset_id}.png");
        for (relative, edge) in [(&legacy_thumbnail, 640), (&legacy_preview, 1600)] {
            let mut cursor = Cursor::new(Vec::new());
            image
                .resize(edge, edge, image::imageops::FilterType::Triangle)
                .write_to(&mut cursor, ImageFormat::Png)
                .expect("legacy png");
            write_atomic(
                &core
                    .paths()
                    .resolve_relative_path(relative)
                    .expect("resolve"),
                &cursor.into_inner(),
            )
            .expect("write legacy");
        }
        std::fs::remove_file(
            core.paths()
                .resolve_relative_path(&fragment.thumbnail_path)
                .expect("resolve"),
        )
        .expect("remove webp thumbnail");
        {
            let conn = core.conn().expect("conn");
            conn.execute(
                "UPDATE assets SET thumbnail_path = ?1, preview_path = ?2, derivatives_version = 1 WHERE id = ?3",
                params![legacy_thumbnail, legacy_preview, asset_id],
            )
            .expect("downgrade asset");
            conn.execute(
                "UPDATE fragments SET thumbnail_path = ?1, preview_path = ?2 WHERE asset_id = ?3",
                params![legacy_thumbnail, legacy_preview, asset_id],
            )
            .expect("downgrade fragment");
        }
        let fragment = core.get_fragment(fragment.id).expect("reload");
        assert!(fragment.thumbnail_path.ends_with(".png"));
        (temp, core, fragment)
    }

    fn deferred_deletions(core: &FragmentCore) -> Vec<String> {
        let conn = core.conn().expect("conn");
        let mut stmt = conn
            .prepare(
                "SELECT relative_path FROM pending_file_deletions
                 WHERE deferred_until_relaunch = 1 ORDER BY relative_path",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        rows
    }

    #[test]
    fn regeneration_replaces_png_derivatives_with_webp_and_defers_old_files_to_next_launch() {
        let (_temp, core, legacy) = legacy_vault(2000, 1000);
        let before = core.derivatives_status().expect("status");
        assert_eq!(
            before,
            DerivativesStatus {
                pending: 1,
                done: 0,
                failed: 0
            }
        );
        let revision = core.library_revision().expect("revision");
        let old_thumbnail = core
            .paths()
            .resolve_relative_path(&legacy.thumbnail_path)
            .unwrap();
        let old_preview = core
            .paths()
            .resolve_relative_path(legacy.preview_path.as_deref().unwrap())
            .unwrap();
        assert!(old_thumbnail.is_file() && old_preview.is_file());

        let batch = run_batch(&core);
        assert_eq!(batch.completed, vec![legacy.asset_id.clone().unwrap()]);
        assert!(batch.failed.is_empty() && !batch.paused);

        let updated = core.get_fragment(legacy.id.clone()).expect("fragment");
        assert!(updated.thumbnail_path.ends_with(".webp"));
        assert!(updated.preview_path.as_deref().unwrap().ends_with(".webp"));
        for relative in [
            &updated.thumbnail_path,
            updated.preview_path.as_ref().unwrap(),
        ] {
            let path = core.paths().resolve_relative_path(relative).unwrap();
            let bytes = std::fs::read(&path).expect("new derivative");
            assert_eq!(image::guess_format(&bytes).unwrap(), ImageFormat::WebP);
        }
        // The running UI may still display the old paths: they survive the pass.
        assert!(
            old_thumbnail.is_file(),
            "old thumbnail stays on disk in the process that replaced it"
        );
        assert!(old_preview.is_file(), "old preview stays on disk too");
        let mut expected = vec![
            legacy.thumbnail_path.clone(),
            legacy.preview_path.clone().unwrap(),
        ];
        expected.sort();
        assert_eq!(deferred_deletions(&core), expected);
        // The regular cleanup pass (hard deletes, Trash purge) must not touch them either.
        let report = core.retry_pending_file_cleanup().expect("cleanup");
        assert_eq!((report.removed, report.deferred), (0, 0));
        assert!(old_thumbnail.is_file() && old_preview.is_file());
        assert!(core.library_revision().expect("revision") > revision);
        let conn = core.conn().expect("conn");
        let (version, legacy_copy): (i64, String) = conn
            .query_row(
                "SELECT a.derivatives_version, f.thumbnail_path FROM assets a JOIN fragments f ON f.asset_id = a.id WHERE a.id = ?1",
                params![legacy.asset_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("row");
        assert_eq!(version, CURRENT_DERIVATIVES_VERSION);
        assert_eq!(legacy_copy, updated.thumbnail_path);
        let jobs: i64 = conn
            .query_row("SELECT count(*) FROM asset_derivative_jobs", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(jobs, 0);
        drop(conn);
        assert_eq!(
            core.derivatives_status().expect("status"),
            DerivativesStatus {
                pending: 0,
                done: 1,
                failed: 0
            }
        );
        assert!(run_batch(&core).completed.is_empty());

        // Simulated relaunch: a fresh core over the same Vault sweeps the queue.
        let root = core.paths().root().to_path_buf();
        drop(core);
        let relaunched = FragmentCore::new_at(root).expect("relaunch");
        assert!(
            old_thumbnail.is_file(),
            "opening the Vault alone (native host) never sweeps"
        );
        let report = relaunched.sweep_deferred_file_deletions().expect("sweep");
        assert_eq!((report.removed, report.deferred), (2, 0));
        assert!(
            !old_thumbnail.exists(),
            "old thumbnail is gone after the sweep"
        );
        assert!(!old_preview.exists(), "old preview is gone after the sweep");
        let pending: i64 = relaunched
            .conn()
            .unwrap()
            .query_row("SELECT count(*) FROM pending_file_deletions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(pending, 0);
        let updated = relaunched.get_fragment(legacy.id).expect("fragment");
        assert!(relaunched
            .paths()
            .resolve_relative_path(&updated.thumbnail_path)
            .unwrap()
            .is_file());
    }

    /// Hard deletes keep their immediate behaviour for the asset's current files.
    /// The replaced PNG is not linked to the asset any more, so it stays in the
    /// deferred queue and goes with the next launch sweep like every other one.
    #[test]
    fn hard_deleting_a_regenerated_fragment_removes_current_files_now_and_old_ones_on_relaunch() {
        let (_temp, core, legacy) = legacy_vault(2000, 1000);
        let old_thumbnail = core
            .paths()
            .resolve_relative_path(&legacy.thumbnail_path)
            .unwrap();
        assert_eq!(run_batch(&core).completed.len(), 1);
        assert!(old_thumbnail.is_file());
        let updated = core.get_fragment(legacy.id.clone()).unwrap();
        let new_thumbnail = core
            .paths()
            .resolve_relative_path(&updated.thumbnail_path)
            .unwrap();
        let original = core
            .paths()
            .resolve_relative_path(&updated.original_path)
            .unwrap();
        core.delete_fragment_everywhere(legacy.id)
            .expect("hard delete");
        assert!(
            !new_thumbnail.exists(),
            "current WebP is removed with the asset"
        );
        assert!(!original.exists(), "original is removed with the asset");
        assert!(old_thumbnail.is_file(), "replaced PNG waits for the sweep");
        assert_eq!(deferred_deletions(&core).len(), 2);
        let report = core.sweep_deferred_file_deletions().expect("sweep");
        assert_eq!((report.removed, report.deferred), (2, 0));
        assert!(!old_thumbnail.exists());
        assert!(deferred_deletions(&core).is_empty());
    }

    #[test]
    fn small_originals_lose_their_preview_file_during_regeneration() {
        let (_temp, core, legacy) = legacy_vault(800, 600);
        let old_preview = core
            .paths()
            .resolve_relative_path(legacy.preview_path.as_deref().unwrap())
            .unwrap();
        assert_eq!(run_batch(&core).completed.len(), 1);
        let updated = core.get_fragment(legacy.id).expect("fragment");
        assert_eq!(
            updated.preview_path.as_deref(),
            Some(updated.original_path.as_str())
        );
        assert!(old_preview.is_file(), "deferred until the next launch");
        assert_eq!(
            deferred_deletions(&core),
            vec![
                legacy.preview_path.clone().unwrap(),
                legacy.thumbnail_path.clone()
            ]
        );
        core.sweep_deferred_file_deletions().expect("sweep");
        assert!(!old_preview.exists());
        assert!(core
            .paths()
            .resolve_relative_path(&updated.original_path)
            .unwrap()
            .is_file());
    }

    #[test]
    fn svg_assets_are_marked_current_without_touching_png_tiers() {
        let temp = tempfile::tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let conn = core.conn().expect("conn");
        let now = Utc::now().to_rfc3339();
        let original = core
            .paths()
            .resolve_relative_path("originals/svg.svg")
            .unwrap();
        write_atomic(&original, b"<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let thumbnail = core
            .paths()
            .resolve_relative_path("thumbnails/svg.png")
            .unwrap();
        write_atomic(&thumbnail, b"png-tier").unwrap();
        let sha = crate::hashing::sha256_hex(b"<svg xmlns='http://www.w3.org/2000/svg'/>");
        conn.execute(
            "INSERT INTO assets(id, original_path, thumbnail_path, preview_path, mime_type, sha256, created_at, updated_at, derivatives_version)
             VALUES ('svg', 'originals/svg.svg', 'thumbnails/svg.png', 'previews/svg.png', 'image/svg+xml', ?1, ?2, ?2, 1)",
            params![sha, now],
        )
        .unwrap();
        drop(conn);
        let batch = run_batch(&core);
        assert_eq!(batch.completed, vec!["svg".to_string()]);
        let conn = core.conn().expect("conn");
        let (version, thumb, preview): (i64, String, String) = conn
            .query_row(
                "SELECT derivatives_version, thumbnail_path, preview_path FROM assets WHERE id = 'svg'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(version, CURRENT_DERIVATIVES_VERSION);
        assert_eq!(thumb, "thumbnails/svg.png");
        assert_eq!(preview, "previews/svg.png");
        assert_eq!(std::fs::read(&thumbnail).unwrap(), b"png-tier");
    }

    #[test]
    fn missing_original_fails_without_changing_paths_and_becomes_terminal_after_three_attempts() {
        let (_temp, core, legacy) = legacy_vault(2000, 1000);
        std::fs::remove_file(
            core.paths()
                .resolve_relative_path(&legacy.original_path)
                .unwrap(),
        )
        .unwrap();
        for attempt in 1..=3 {
            let batch = run_batch(&core);
            assert_eq!(
                batch.failed,
                vec![legacy.asset_id.clone().unwrap()],
                "attempt {attempt}"
            );
            let current = core.get_fragment(legacy.id.clone()).unwrap();
            assert_eq!(current.thumbnail_path, legacy.thumbnail_path);
            assert_eq!(current.preview_path, legacy.preview_path);
        }
        assert_eq!(
            core.derivatives_status().unwrap(),
            DerivativesStatus {
                pending: 0,
                done: 0,
                failed: 1
            }
        );
        assert!(run_batch(&core).failed.is_empty());
        let conn = core.conn().unwrap();
        let (status, attempts, code): (String, i64, String) = conn
            .query_row(
                "SELECT status, attempts, error_code FROM asset_derivative_jobs WHERE asset_id = ?1",
                params![legacy.asset_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (status.as_str(), attempts, code.as_str()),
            ("failed", 3, "original_unreadable")
        );
        drop(conn);
        assert!(core
            .paths()
            .resolve_relative_path(&legacy.thumbnail_path)
            .unwrap()
            .is_file());
        assert!(std::fs::read_dir(core.paths().thumbnails_dir())
            .unwrap()
            .all(|entry| entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|e| e == "png")));
        assert_eq!(core.retry_failed_derivatives().unwrap(), 1);
        assert_eq!(core.derivatives_status().unwrap().pending, 1);
    }

    #[test]
    fn publication_rolls_back_when_the_lease_was_lost_or_the_asset_vanished() {
        let (_temp, core, legacy) = legacy_vault(2000, 1000);
        let asset_id = legacy.asset_id.clone().unwrap();
        let leased = core.lease_asset(&asset_id).unwrap().expect("lease");
        let new = core.produce_derivatives(&leased).unwrap();
        assert_eq!(new.written.len(), 2);
        // A stale token must not publish or queue deletions.
        assert!(!core
            .publish_derivatives(&asset_id, "stale-token", &new)
            .unwrap());
        let conn = core.conn().unwrap();
        let (version, thumb): (i64, String) = conn
            .query_row(
                "SELECT derivatives_version, thumbnail_path FROM assets WHERE id = ?1",
                params![asset_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            (version, thumb.as_str()),
            (1, legacy.thumbnail_path.as_str())
        );
        let queued: i64 = conn
            .query_row("SELECT count(*) FROM pending_file_deletions", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(queued, 0);
        // The asset is deleted while the worker is encoding: publication must refuse.
        conn.execute(
            "DELETE FROM fragments WHERE asset_id = ?1",
            params![asset_id],
        )
        .unwrap();
        conn.execute("DELETE FROM assets WHERE id = ?1", params![asset_id])
            .unwrap();
        drop(conn);
        assert!(!core
            .publish_derivatives(&asset_id, &leased.token, &new)
            .unwrap());
        core.remove_written(&new.written);
        for relative in &new.written {
            assert!(!core
                .paths()
                .resolve_relative_path(relative)
                .unwrap()
                .exists());
        }
        assert!(core
            .paths()
            .resolve_relative_path(&legacy.thumbnail_path)
            .unwrap()
            .is_file());
    }

    #[test]
    fn expired_leases_are_taken_over_and_fresh_leases_are_respected() {
        let (_temp, core, legacy) = legacy_vault(2000, 1000);
        let asset_id = legacy.asset_id.clone().unwrap();
        let first = core.lease_asset(&asset_id).unwrap().expect("lease");
        assert!(
            core.lease_asset(&asset_id).unwrap().is_none(),
            "fresh lease is exclusive"
        );
        core.conn()
            .unwrap()
            .execute("UPDATE asset_derivative_jobs SET lease_expires_at = 0", [])
            .unwrap();
        let second = core
            .lease_asset(&asset_id)
            .unwrap()
            .expect("expired lease is reclaimed");
        assert_ne!(first.token, second.token);
        assert_eq!(second.attempts, 2);
        // The first worker's publication now fails; the second succeeds.
        let new = core.produce_derivatives(&second).unwrap();
        assert!(!core
            .publish_derivatives(&asset_id, &first.token, &new)
            .unwrap());
        assert!(core
            .publish_derivatives(&asset_id, &second.token, &new)
            .unwrap());
    }

    #[test]
    fn palette_extraction_decodes_webp_thumbnails() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("source.png");
        std::fs::write(&source, png_bytes(900, 700)).expect("source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source.to_string_lossy().into_owned(), None)
            .expect("import");
        assert!(fragment.thumbnail_path.ends_with(".webp"));
        let conn = core.conn().unwrap();
        conn.execute("DELETE FROM asset_palette_colors", [])
            .unwrap();
        conn.execute("DELETE FROM asset_palettes", []).unwrap();
        drop(conn);
        assert_eq!(core.palette_index_status().unwrap().pending, 1);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        let done = loop {
            let done = core.process_palette_batch(None, 25).unwrap();
            if !done.is_empty() {
                break done;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "palette batch never ran"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        assert_eq!(done, vec![fragment.asset_id.clone().unwrap()]);
        let palette = core.get_fragment_palette(&fragment.id).unwrap();
        assert_eq!(palette.status, "ready");
        assert!(!palette.colors.is_empty());
    }
}
