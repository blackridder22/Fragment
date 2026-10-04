//! Asset-owned palette publication and restartable leases. Image work never holds the DB mutex.
use crate::{
    palette::{self, PaletteColor, ALGORITHM_VERSION},
    CoreError, CoreResult, FragmentCore,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentPalette {
    pub asset_id: String,
    pub status: String,
    pub algorithm_version: i64,
    pub colors: Vec<PaletteColor>,
    pub error_code: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteIndexStatus {
    pub ready: u64,
    pub empty: u64,
    pub pending: u64,
    pub failed: u64,
    pub revision: String,
}

pub(crate) fn publish(
    conn: &Connection,
    asset_id: &str,
    sha: &str,
    colors: &[PaletteColor],
) -> CoreResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute("INSERT INTO asset_palettes(asset_id,algorithm_version,source_sha256,status,updated_at) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(asset_id) DO UPDATE SET algorithm_version=excluded.algorithm_version,source_sha256=excluded.source_sha256,status=excluded.status,error_code=NULL,next_retry_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=excluded.updated_at",
        params![asset_id,ALGORITHM_VERSION,sha,if colors.is_empty(){"empty"}else{"ready"},now])?;
    conn.execute(
        "DELETE FROM asset_palette_colors WHERE asset_id=?1",
        params![asset_id],
    )?;
    for (rank, c) in colors.iter().enumerate() {
        conn.execute("INSERT INTO asset_palette_colors(asset_id,rank,r,g,b,l,a,lab_b,coverage) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![asset_id,rank as i64,c.r,c.g,c.b,c.l,c.a,c.lab_b,c.coverage])?;
    }
    conn.execute(
        "UPDATE vault_metadata SET palette_revision=palette_revision+1 WHERE id=1",
        [],
    )?;
    Ok(())
}

impl FragmentCore {
    pub fn get_fragment_palette(&self, id: &str) -> CoreResult<FragmentPalette> {
        let conn = self.conn()?;
        let asset_id: String = conn
            .query_row(
                "SELECT asset_id FROM fragments WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Fragment".into()))?;
        let state = conn
            .query_row(
                "SELECT status,algorithm_version,error_code FROM asset_palettes WHERE asset_id=?1",
                params![asset_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .unwrap_or(("pending".into(), ALGORITHM_VERSION, None));
        let mut query=conn.prepare("SELECT r,g,b,l,a,lab_b,coverage FROM asset_palette_colors WHERE asset_id=?1 ORDER BY rank")?;
        let colors = query
            .query_map(params![asset_id], |row| {
                let (r, g, b) = (
                    row.get::<_, u8>(0)?,
                    row.get::<_, u8>(1)?,
                    row.get::<_, u8>(2)?,
                );
                Ok(PaletteColor {
                    hex: format!("#{r:02X}{g:02X}{b:02X}"),
                    r,
                    g,
                    b,
                    l: row.get(3)?,
                    a: row.get(4)?,
                    lab_b: row.get(5)?,
                    coverage: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(FragmentPalette {
            asset_id,
            status: state.0,
            algorithm_version: state.1,
            error_code: state.2,
            colors,
        })
    }

    pub fn palette_index_status(&self) -> CoreResult<PaletteIndexStatus> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let mut status = PaletteIndexStatus {
            ready: 0,
            empty: 0,
            pending: 0,
            failed: 0,
            revision: tx
                .query_row(
                    "SELECT palette_revision FROM vault_metadata WHERE id=1",
                    [],
                    |r| r.get::<_, i64>(0),
                )?
                .to_string(),
        };
        {
            let mut query=tx.prepare("SELECT CASE WHEN p.algorithm_version=?1 AND p.source_sha256=COALESCE(a.sha256,'') THEN p.status ELSE 'pending' END, COUNT(*) FROM assets a LEFT JOIN asset_palettes p ON p.asset_id=a.id GROUP BY 1")?;
            for row in query.query_map(params![ALGORITHM_VERSION], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, u64>(1)?))
            })? {
                let (state, count) = row?;
                match state.as_str() {
                    "ready" => status.ready += count,
                    "empty" => status.empty += count,
                    "failed" => status.failed += count,
                    _ => status.pending += count,
                }
            }
        }
        tx.commit()?;
        Ok(status)
    }

    pub fn retry_fragment_palette(&self, id: &str) -> CoreResult<()> {
        let palette = self.get_fragment_palette(id)?;
        let conn = self.conn()?;
        conn.execute("UPDATE asset_palettes SET status='pending',attempts=0,error_code=NULL,next_retry_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE asset_id=?1 AND status='failed'",params![palette.asset_id])?;
        Ok(())
    }

    /// One batch, called by one app-lifetime scheduler. An opened asset wins priority; Trash is last.
    pub fn process_palette_batch(
        &self,
        priority_fragment: Option<&str>,
        limit: usize,
    ) -> CoreResult<Vec<String>> {
        self.process_palette_batch_in_frame(priority_fragment, None, limit)
    }

    pub fn process_palette_batch_in_frame(
        &self,
        priority_fragment: Option<&str>,
        priority_frame: Option<&str>,
        limit: usize,
    ) -> CoreResult<Vec<String>> {
        let ids = {
            let conn = self.conn()?;
            let mut query=conn.prepare("SELECT a.id FROM assets a LEFT JOIN asset_palettes p ON p.asset_id=a.id
                WHERE p.asset_id IS NULL OR p.algorithm_version<>?1 OR p.source_sha256<>COALESCE(a.sha256,'')
                OR (p.status='pending' AND (p.next_retry_at IS NULL OR p.next_retry_at<=?2))
                OR (p.status='processing' AND p.lease_expires_at<=?2)
                ORDER BY (a.id=(SELECT asset_id FROM fragments WHERE id=?3)) DESC,
                EXISTS(SELECT 1 FROM fragments f WHERE f.asset_id=a.id AND f.frame_id=?4 AND f.deleted_at IS NULL) DESC,
                EXISTS(SELECT 1 FROM fragments f WHERE f.asset_id=a.id AND f.deleted_at IS NULL) DESC,a.id LIMIT ?5")?;
            let values = query
                .query_map(
                    params![
                        ALGORITHM_VERSION,
                        Utc::now().timestamp(),
                        priority_fragment,
                        priority_frame,
                        limit.min(25) as i64
                    ],
                    |r| r.get::<_, String>(0),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        let mut completed = Vec::new();
        for id in ids {
            if crate::processing::foreground_busy() {
                break;
            }
            if self.process_palette_asset(&id)? {
                completed.push(id);
            }
        }
        Ok(completed)
    }

    fn process_palette_asset(&self, id: &str) -> CoreResult<bool> {
        let token = Uuid::new_v4().to_string();
        let (sha, path, attempts) = {
            let mut conn = self.conn()?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let Some((sha, path)) = tx
                .query_row(
                    "SELECT COALESCE(sha256,''),thumbnail_path FROM assets WHERE id=?1",
                    params![id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .optional()?
            else {
                return Ok(false);
            };
            let now = Utc::now().timestamp();
            let changed=tx.execute("INSERT INTO asset_palettes(asset_id,algorithm_version,source_sha256,status,attempts,lease_token,lease_expires_at,updated_at) VALUES(?1,?2,?3,'processing',1,?4,?5,?6)
                ON CONFLICT(asset_id) DO UPDATE SET algorithm_version=excluded.algorithm_version,source_sha256=excluded.source_sha256,status='processing',attempts=asset_palettes.attempts+1,lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at
                WHERE asset_palettes.algorithm_version<>?2 OR asset_palettes.source_sha256<>?3 OR (asset_palettes.status='pending' AND (asset_palettes.next_retry_at IS NULL OR asset_palettes.next_retry_at<=?7)) OR (asset_palettes.status='processing' AND asset_palettes.lease_expires_at<=?7)",
                params![id,ALGORITHM_VERSION,sha,token,now+60,Utc::now().to_rfc3339(),now])?;
            if changed == 0 {
                return Ok(false);
            }
            let attempts = tx.query_row(
                "SELECT attempts FROM asset_palettes WHERE asset_id=?1",
                params![id],
                |r| r.get::<_, i64>(0),
            )?;
            tx.commit()?;
            (sha, path, attempts)
        };
        let result = (|| -> CoreResult<Vec<PaletteColor>> {
            let path = self.paths().resolve_relative_path(&path)?;
            let dimensions = image::image_dimensions(&path)?;
            if dimensions.0 > 640
                || dimensions.1 > 640
                || std::fs::metadata(&path)?.len() > 4 * 1024 * 1024
            {
                return Err(CoreError::InvalidInput(
                    "Cached thumbnail exceeds palette sampling limits".into(),
                ));
            }
            let image = image::open(path)?;
            Ok(palette::extract(&image))
        })();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let owns:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM asset_palettes p JOIN assets a ON a.id=p.asset_id WHERE p.asset_id=?1 AND p.lease_token=?2 AND p.source_sha256=?3 AND COALESCE(a.sha256,'')=?3 AND p.algorithm_version=?4)",params![id,token,sha,ALGORITHM_VERSION],|r|r.get(0))?;
        if !owns {
            return Ok(false);
        }
        match result {
            Ok(colors) => publish(&tx, id, &sha, &colors)?,
            Err(_) => {
                let terminal = attempts >= 3;
                tx.execute("UPDATE asset_palettes SET status=?1,error_code='thumbnail_unavailable',next_retry_at=?2,lease_token=NULL,lease_expires_at=NULL,updated_at=?3 WHERE asset_id=?4 AND lease_token=?5",params![if terminal{"failed"}else{"pending"},Utc::now().timestamp()+attempts*5,Utc::now().to_rfc3339(),id,token])?;
                if terminal {
                    tx.execute(
                        "UPDATE vault_metadata SET palette_revision=palette_revision+1 WHERE id=1",
                        [],
                    )?;
                }
            }
        }
        tx.commit()?;
        Ok(true)
    }
}
