use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::fragments::map_fragment;
use crate::models::Frame;

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
            let count: i64 = conn.query_row("SELECT count(*) FROM frames", [], |row| row.get(0))?;
            if count == 0 {
                None
            } else {
                conn.query_row(
                    "SELECT * FROM frames ORDER BY sort_order ASC, created_at ASC LIMIT 1",
                    [],
                    map_frame,
                )
                .optional()?
            }
        };

        if let Some(frame) = existing {
            return Ok(frame);
        }

        self.create_frame(None, "Inbox".to_string())
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
            "INSERT INTO frames (id, parent_id, name, description, icon, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
        let mut stmt =
            conn.prepare("SELECT * FROM frames ORDER BY sort_order ASC, created_at ASC")?;
        let frames = stmt
            .query_map([], map_frame)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(frames)
    }

    pub fn list_child_frames(&self, parent_id: Option<String>) -> CoreResult<Vec<Frame>> {
        let conn = self.conn()?;
        let mut stmt = if parent_id.is_some() {
            conn.prepare(
                "SELECT * FROM frames WHERE parent_id = ?1 ORDER BY sort_order ASC, created_at ASC",
            )?
        } else {
            conn.prepare(
                "SELECT * FROM frames WHERE parent_id IS NULL ORDER BY sort_order ASC, created_at ASC",
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
                "UPDATE frames SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed, &now, &id],
            )?;
            if changed == 0 {
                return Err(CoreError::NotFound("Frame".to_string()));
            }
        }

        self.get_frame(&id)
    }

    pub fn delete_frame(&self, id: String) -> CoreResult<()> {
        self.ensure_frame_is_not_default(&id)?;

        let fragments = {
            let conn = self.conn()?;
            let mut stmt = conn.prepare(
                "
                WITH RECURSIVE frame_tree(id) AS (
                  SELECT id FROM frames WHERE id = ?1
                  UNION ALL
                  SELECT frames.id FROM frames
                  INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
                )
                SELECT fragments.* FROM fragments
                INNER JOIN frame_tree ON fragments.frame_id = frame_tree.id
                ",
            )?;
            let fragments = stmt
                .query_map(params![&id], map_fragment)?
                .collect::<Result<Vec<_>, _>>()?;
            fragments
        };

        {
            let conn = self.conn()?;
            let changed = conn.execute("DELETE FROM frames WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(CoreError::NotFound("Frame".to_string()));
            }
        }

        for fragment in &fragments {
            self.remove_orphan_asset_for_fragment(fragment)?;
        }
        Ok(())
    }

    pub fn get_frame(&self, id: &str) -> CoreResult<Frame> {
        let conn = self.conn()?;
        let frame = conn
            .query_row("SELECT * FROM frames WHERE id = ?1", params![id], map_frame)
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Frame".to_string()))?;
        Ok(frame)
    }

    pub fn require_frame(&self, id: &str) -> CoreResult<()> {
        self.get_frame(id).map(|_| ())
    }

    pub fn fragment_count_for_frame(&self, id: &str) -> CoreResult<i64> {
        let conn = self.conn()?;
        let count = conn.query_row(
            "SELECT count(*) FROM fragments WHERE frame_id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    fn ensure_frame_is_not_default(&self, id: &str) -> CoreResult<()> {
        let default_frame_id = self.default_frame_id()?;
        if id == default_frame_id {
            return Err(CoreError::InvalidInput(
                "Inbox is a protected Frame".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageBuffer, ImageFormat, Rgba};
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
    fn default_inbox_cannot_be_renamed_or_deleted() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let inbox = core.ensure_default_frame().expect("inbox");

        let rename_error = core
            .rename_frame(inbox.id.clone(), "References".to_string())
            .expect_err("rename should fail");
        assert!(rename_error.to_string().contains("protected Frame"));

        let delete_error = core.delete_frame(inbox.id).expect_err("delete should fail");
        assert!(delete_error.to_string().contains("protected Frame"));
    }

    #[test]
    fn delete_frame_removes_fragment_rows_and_asset_files() {
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
        let paths = [
            Some(fragment.original_path.as_str()),
            Some(fragment.thumbnail_path.as_str()),
            fragment.preview_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(|relative_path| {
            core.paths()
                .resolve_relative_path(relative_path)
                .expect("resolve")
        })
        .collect::<Vec<_>>();

        core.delete_frame(frame.id).expect("delete frame");

        assert!(core.get_fragment(fragment.id).is_err());
        for path in paths {
            assert!(!path.exists(), "{} should be removed", path.display());
        }
    }
}
