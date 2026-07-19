use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use uuid::Uuid;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::fragments::{enqueue_orphan_asset_cleanup, usize_to_u64};
use crate::models::Frame;

const DEFAULT_FRAME_RETENTION_DAYS: u32 = 31;

fn map_frame(row: &Row<'_>) -> rusqlite::Result<Frame> {
    Ok(Frame {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        icon: row.get("icon")?,
        sort_order: row.get("sort_order")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

impl FragmentCore {
    pub fn ensure_default_frame(&self) -> CoreResult<Frame> {
        let existing = {
            let conn = self.conn()?;
            frame_by_system_status(&conn, true)?
        };
        if let Some(frame) = existing {
            return Ok(frame);
        }

        let now = Utc::now().to_rfc3339();
        let frame = Frame {
            id: Uuid::new_v4().to_string(),
            parent_id: None,
            name: "Inbox".to_string(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        let conn = self.conn()?;
        conn.execute(
            "
            INSERT INTO frames (
              id, parent_id, name, description, icon, sort_order, created_at, updated_at,
              is_system, deleted_at, delete_after, trash_group_id
            ) VALUES (?1, NULL, ?2, NULL, NULL, 0, ?3, ?3, 1, NULL, NULL, NULL)
            ",
            params![&frame.id, &frame.name, &frame.created_at],
        )?;
        Ok(frame)
    }

    pub fn default_frame_id(&self) -> CoreResult<String> {
        Ok(self.ensure_default_frame()?.id)
    }

    pub fn create_frame(&self, parent_id: Option<String>, name: String) -> CoreResult<Frame> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::InvalidInput(
                "Frame name is required".to_string(),
            ));
        }

        if let Some(parent_id) = parent_id.as_deref() {
            self.require_frame(parent_id)?;
        }

        let now = Utc::now().to_rfc3339();
        let frame = Frame {
            id: Uuid::new_v4().to_string(),
            parent_id,
            name: trimmed.to_string(),
            description: None,
            icon: None,
            sort_order: 0,
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.conn()?;
        conn.execute(
            "
            INSERT INTO frames (
              id, parent_id, name, description, icon, sort_order, created_at, updated_at,
              is_system, deleted_at, delete_after, trash_group_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, NULL, NULL, NULL)
            ",
            params![
                &frame.id,
                &frame.parent_id,
                &frame.name,
                &frame.description,
                &frame.icon,
                &frame.sort_order,
                &frame.created_at,
                &frame.updated_at
            ],
        )?;

        Ok(frame)
    }

    pub fn list_frames(&self) -> CoreResult<Vec<Frame>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM frames WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
        )?;
        let frames = stmt
            .query_map([], map_frame)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(frames)
    }

    pub fn list_trashed_frames(&self) -> CoreResult<Vec<Frame>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "
            SELECT * FROM frames
            WHERE deleted_at IS NOT NULL
              AND (trash_group_id IS NULL OR trash_group_id = id)
            ORDER BY deleted_at DESC
            ",
        )?;
        let frames = stmt
            .query_map([], map_frame)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(frames)
    }

    pub fn list_child_frames(&self, parent_id: Option<String>) -> CoreResult<Vec<Frame>> {
        let conn = self.conn()?;
        let mut stmt = if parent_id.is_some() {
            conn.prepare(
                "
                SELECT * FROM frames
                WHERE parent_id = ?1 AND deleted_at IS NULL
                ORDER BY sort_order ASC, created_at ASC
                ",
            )?
        } else {
            conn.prepare(
                "
                SELECT * FROM frames
                WHERE parent_id IS NULL AND deleted_at IS NULL
                ORDER BY sort_order ASC, created_at ASC
                ",
            )?
        };

        let frames = match parent_id {
            Some(parent_id) => stmt
                .query_map([parent_id], map_frame)?
                .collect::<Result<Vec<_>, _>>()?,
            None => stmt
                .query_map([], map_frame)?
                .collect::<Result<Vec<_>, _>>()?,
        };
        Ok(frames)
    }

    pub fn rename_frame(&self, id: String, name: String) -> CoreResult<Frame> {
        self.ensure_frame_is_not_default(&id)?;

        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::InvalidInput(
                "Frame name is required".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        {
            let conn = self.conn()?;
            let changed = conn.execute(
                "UPDATE frames SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![trimmed, &now, &id],
            )?;
            if changed == 0 {
                return Err(CoreError::NotFound("Frame".to_string()));
            }
        }

        self.get_frame(&id)
    }

    pub fn delete_frame(&self, id: String) -> CoreResult<()> {
        self.delete_frame_with_policy(id, Some(DEFAULT_FRAME_RETENTION_DAYS))
    }

    pub fn delete_frame_with_policy(
        &self,
        id: String,
        retention_days: Option<u32>,
    ) -> CoreResult<()> {
        match retention_days {
            Some(days) if days > 0 => self.trash_frame(id, days),
            _ => self.hard_delete_frame(id),
        }
    }

    pub fn restore_frame(&self, id: String) -> CoreResult<Frame> {
        self.ensure_frame_is_not_default(&id)?;
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (parent_id, deleted_at, trash_group_id) = tx
            .query_row(
                "SELECT parent_id, deleted_at, trash_group_id FROM frames WHERE id = ?1",
                params![&id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Frame".to_string()))?;

        if deleted_at.is_some() {
            if let Some(parent_id) = parent_id.as_deref() {
                let parent_is_active: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM frames WHERE id = ?1 AND deleted_at IS NULL)",
                    params![parent_id],
                    |row| row.get(0),
                )?;
                let same_group = tx.query_row(
                    "SELECT trash_group_id = ?2 FROM frames WHERE id = ?1",
                    params![parent_id, trash_group_id.as_deref().unwrap_or(&id)],
                    |row| row.get::<_, Option<bool>>(0),
                )? == Some(true);
                if !parent_is_active && !same_group {
                    return Err(CoreError::InvalidInput(
                        "restore the parent Frame first".to_string(),
                    ));
                }
            }

            let group_id = trash_group_id.unwrap_or_else(|| id.clone());
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "
                UPDATE frames
                SET deleted_at = NULL, delete_after = NULL, trash_group_id = NULL, updated_at = ?1
                WHERE trash_group_id = ?2 OR id = ?2
                ",
                params![now, group_id],
            )?;
        }
        tx.commit()?;
        drop(conn);
        self.get_frame(&id)
    }

    pub fn hard_delete_frame(&self, id: String) -> CoreResult<()> {
        self.ensure_frame_is_not_default(&id)?;
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (removed_frames, _) = hard_delete_frame_in_conn(&tx, &id)?;
        if removed_frames == 0 {
            return Err(CoreError::NotFound("Frame".to_string()));
        }
        tx.commit()?;
        drop(conn);
        self.retry_cleanup_best_effort();
        Ok(())
    }

    pub(crate) fn purge_expired_frames(&self) -> CoreResult<(u64, u64)> {
        let now = Utc::now().to_rfc3339();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let expired_roots = {
            let mut stmt = tx.prepare(
                "
                SELECT id FROM frames
                WHERE deleted_at IS NOT NULL
                  AND delete_after IS NOT NULL
                  AND delete_after <= ?1
                  AND (trash_group_id IS NULL OR trash_group_id = id)
                  AND is_system = 0
                ",
            )?;
            let rows = stmt
                .query_map(params![&now], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        let mut frames = 0_u64;
        let mut assets = 0_u64;
        for frame_id in expired_roots {
            let (removed_frames, removed_assets) = hard_delete_frame_in_conn(&tx, &frame_id)?;
            frames = frames.saturating_add(removed_frames);
            assets = assets.saturating_add(removed_assets);
        }
        tx.commit()?;
        Ok((frames, assets))
    }

    pub fn get_frame(&self, id: &str) -> CoreResult<Frame> {
        let conn = self.conn()?;
        frame_by_id_in_conn(&conn, id, false)?
            .ok_or_else(|| CoreError::NotFound("Frame".to_string()))
    }

    pub fn require_frame(&self, id: &str) -> CoreResult<()> {
        self.get_frame(id).map(|_| ())
    }

    pub fn fragment_count_for_frame(&self, id: &str) -> CoreResult<i64> {
        self.require_frame(id)?;
        let conn = self.conn()?;
        Ok(conn.query_row(
            "SELECT count(*) FROM fragments WHERE frame_id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )?)
    }

    fn trash_frame(&self, id: String, retention_days: u32) -> CoreResult<()> {
        self.ensure_frame_is_not_default(&id)?;
        let now = Utc::now();
        let deleted_at = now.to_rfc3339();
        let delete_after = (now + Duration::days(i64::from(retention_days))).to_rfc3339();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM frames WHERE id = ?1 AND deleted_at IS NULL)",
            params![&id],
            |row| row.get(0),
        )?;
        if !active {
            return Err(CoreError::NotFound("Frame".to_string()));
        }

        tx.execute(
            "
            WITH RECURSIVE frame_tree(id) AS (
              SELECT id FROM frames WHERE id = ?1
              UNION ALL
              SELECT frames.id FROM frames
              INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
              WHERE frames.deleted_at IS NULL
            )
            UPDATE frames
            SET deleted_at = ?2, delete_after = ?3, trash_group_id = ?1, updated_at = ?2
            WHERE id IN (SELECT id FROM frame_tree) AND is_system = 0
            ",
            params![&id, &deleted_at, &delete_after],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn ensure_frame_is_not_default(&self, id: &str) -> CoreResult<()> {
        let conn = self.conn()?;
        let is_system = conn
            .query_row(
                "SELECT is_system = 1 FROM frames WHERE id = ?1",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        match is_system {
            Some(true) => Err(CoreError::InvalidInput(
                "Inbox is a protected Frame".to_string(),
            )),
            Some(false) => Ok(()),
            None => Err(CoreError::NotFound("Frame".to_string())),
        }
    }
}

fn frame_by_system_status(connection: &Connection, is_system: bool) -> CoreResult<Option<Frame>> {
    Ok(connection
        .query_row(
            "SELECT * FROM frames WHERE is_system = ?1 AND deleted_at IS NULL LIMIT 1",
            params![is_system],
            map_frame,
        )
        .optional()?)
}

fn frame_by_id_in_conn(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> CoreResult<Option<Frame>> {
    let sql = if include_deleted {
        "SELECT * FROM frames WHERE id = ?1"
    } else {
        "SELECT * FROM frames WHERE id = ?1 AND deleted_at IS NULL"
    };
    Ok(connection
        .query_row(sql, params![id], map_frame)
        .optional()?)
}

fn hard_delete_frame_in_conn(connection: &Connection, frame_id: &str) -> CoreResult<(u64, u64)> {
    let frame_ids = {
        let mut stmt = connection.prepare(
            "
            WITH RECURSIVE frame_tree(id) AS (
              SELECT id FROM frames WHERE id = ?1 AND is_system = 0
              UNION ALL
              SELECT frames.id FROM frames
              INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
            )
            SELECT id FROM frame_tree
            ",
        )?;
        let rows = stmt
            .query_map(params![frame_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if frame_ids.is_empty() {
        return Ok((0, 0));
    }

    let asset_ids = {
        let mut stmt = connection.prepare(
            "
            WITH RECURSIVE frame_tree(id) AS (
              SELECT id FROM frames WHERE id = ?1
              UNION ALL
              SELECT frames.id FROM frames
              INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
            )
            SELECT DISTINCT asset_id FROM fragments
            WHERE frame_id IN (SELECT id FROM frame_tree) AND asset_id IS NOT NULL
            ",
        )?;
        let rows = stmt
            .query_map(params![frame_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    connection.execute(
        "
        WITH RECURSIVE frame_tree(id) AS (
          SELECT id FROM frames WHERE id = ?1
          UNION ALL
          SELECT frames.id FROM frames
          INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
        )
        DELETE FROM fragments WHERE frame_id IN (SELECT id FROM frame_tree)
        ",
        params![frame_id],
    )?;
    connection.execute(
        "
        WITH RECURSIVE frame_tree(id) AS (
          SELECT id FROM frames WHERE id = ?1
          UNION ALL
          SELECT frames.id FROM frames
          INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
        )
        DELETE FROM frames WHERE id IN (SELECT id FROM frame_tree)
        ",
        params![frame_id],
    )?;

    let mut removed_assets = 0_u64;
    for asset_id in asset_ids {
        if enqueue_orphan_asset_cleanup(connection, &asset_id)? {
            removed_assets = removed_assets.saturating_add(1);
        }
    }
    Ok((usize_to_u64(frame_ids.len()), removed_assets))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageBuffer, ImageFormat, Rgba};
    use rusqlite::params;
    use tempfile::tempdir;

    use crate::FragmentCore;

    fn sample_png_bytes() -> Vec<u8> {
        let image = ImageBuffer::from_fn(20, 20, |x, y| {
            if x > y {
                Rgba([137_u8, 247, 255, 255])
            } else {
                Rgba([7_u8, 8, 8, 255])
            }
        });
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("encode png");
        cursor.into_inner()
    }

    #[test]
    fn default_inbox_is_created() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let frames = core.list_frames().expect("frames");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].name, "Inbox");
    }

    #[test]
    fn frame_create_and_list_round_trip() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create");
        let frames = core.list_frames().expect("frames");
        assert!(frames.iter().any(|item| item.id == frame.id));
    }

    #[test]
    fn default_inbox_cannot_be_renamed_deleted_or_trashed() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let inbox = core.ensure_default_frame().expect("inbox");

        let rename_error = core
            .rename_frame(inbox.id.clone(), "References".to_string())
            .expect_err("rename should fail");
        assert!(rename_error.to_string().contains("protected Frame"));

        let delete_error = core
            .delete_frame(inbox.id.clone())
            .expect_err("delete should fail");
        assert!(delete_error.to_string().contains("protected Frame"));

        let hard_delete_error = core
            .hard_delete_frame(inbox.id)
            .expect_err("hard delete should fail");
        assert!(hard_delete_error.to_string().contains("protected Frame"));
    }

    #[test]
    fn frame_trash_and_restore_preserve_memberships_and_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let fragment = core
            .import_image(
                Some(frame.id.clone()),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("import");
        let original = core
            .paths()
            .resolve_relative_path(&fragment.original_path)
            .expect("original path");

        core.delete_frame(frame.id.clone()).expect("trash frame");
        assert!(core.get_frame(&frame.id).is_err());
        assert!(core.get_fragment(fragment.id.clone()).is_err());
        assert_eq!(core.list_trashed_frames().expect("trash").len(), 1);
        assert!(original.exists());

        let restored = core.restore_frame(frame.id.clone()).expect("restore frame");
        assert_eq!(restored.id, frame.id);
        assert_eq!(
            core.list_fragments(restored.id).expect("fragments").len(),
            1
        );
        assert!(original.exists());
    }

    #[test]
    fn hard_delete_frame_removes_only_orphaned_assets() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("inbox import");
        core.add_existing_fragment_to_frame(first.id.clone(), Some(frame.id.clone()))
            .expect("shared membership");
        let original = core
            .paths()
            .resolve_relative_path(&first.original_path)
            .expect("original");

        core.hard_delete_frame(frame.id).expect("hard delete frame");
        assert!(original.exists());
        assert_eq!(core.list_all_fragments().expect("fragments").len(), 1);
    }

    #[test]
    fn retention_purge_removes_expired_frame_tree_and_orphaned_asset() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let parent = core
            .create_frame(None, "Parent".to_string())
            .expect("parent");
        let child = core
            .create_frame(Some(parent.id.clone()), "Child".to_string())
            .expect("child");
        let fragment = core
            .import_image(
                Some(child.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("import");
        let original = core
            .paths()
            .resolve_relative_path(&fragment.original_path)
            .expect("original");

        core.delete_frame_with_policy(parent.id.clone(), Some(7))
            .expect("trash tree");
        {
            let conn = core.conn().expect("conn");
            conn.execute(
                "UPDATE frames SET delete_after = '2000-01-01T00:00:00Z' WHERE trash_group_id = ?1",
                params![&parent.id],
            )
            .expect("expire tree");
        }

        let report = core.purge_expired_trash().expect("purge");
        assert_eq!(report.frames, 2);
        assert_eq!(report.assets, 1);
        assert!(!original.exists());
        assert!(core.list_trashed_frames().expect("trash").is_empty());
    }
}
