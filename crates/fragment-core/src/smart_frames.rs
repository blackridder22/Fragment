use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::models::{FragmentFilter, SmartFrame};

fn validate_name(name: String) -> CoreResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::InvalidInput(
            "Smart Frame name cannot be empty".to_string(),
        ));
    }
    if name.chars().count() > 80 {
        return Err(CoreError::InvalidInput(
            "Smart Frame name cannot exceed 80 characters".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn decode_smart_frame(
    id: String,
    name: String,
    filter_json: String,
    sort_order: i64,
    created_at: String,
    updated_at: String,
) -> CoreResult<SmartFrame> {
    let filter = serde_json::from_str(&filter_json).map_err(|error| {
        CoreError::InvalidInput(format!("Smart Frame filter is invalid: {error}"))
    })?;
    Ok(SmartFrame {
        id,
        name,
        filter,
        sort_order,
        created_at,
        updated_at,
    })
}

impl FragmentCore {
    pub fn list_smart_frames(&self) -> CoreResult<Vec<SmartFrame>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, filter_json, sort_order, created_at, updated_at
             FROM smart_frames ORDER BY sort_order ASC, created_at ASC, id ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, name, json, order, created, updated)| {
                decode_smart_frame(id, name, json, order, created, updated)
            })
            .collect()
    }

    pub fn create_smart_frame(
        &self,
        name: String,
        filter: FragmentFilter,
    ) -> CoreResult<SmartFrame> {
        let name = validate_name(name)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let filter_json = serde_json::to_string(&filter)
            .map_err(|error| CoreError::InvalidInput(error.to_string()))?;
        let conn = self.conn()?;
        let sort_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM smart_frames",
            [],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT INTO smart_frames (id, name, filter_json, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![&id, &name, &filter_json, sort_order, &now],
        )?;
        Ok(SmartFrame {
            id,
            name,
            filter,
            sort_order,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_smart_frame(
        &self,
        id: String,
        name: String,
        filter: FragmentFilter,
    ) -> CoreResult<SmartFrame> {
        let name = validate_name(name)?;
        let now = Utc::now().to_rfc3339();
        let filter_json = serde_json::to_string(&filter)
            .map_err(|error| CoreError::InvalidInput(error.to_string()))?;
        let conn = self.conn()?;
        let changed = conn.execute(
            "UPDATE smart_frames SET name = ?1, filter_json = ?2, updated_at = ?3 WHERE id = ?4",
            params![&name, &filter_json, &now, &id],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound("Smart Frame".to_string()));
        }
        let (sort_order, created_at): (i64, String) = conn.query_row(
            "SELECT sort_order, created_at FROM smart_frames WHERE id = ?1",
            params![&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(SmartFrame {
            id,
            name,
            filter,
            sort_order,
            created_at,
            updated_at: now,
        })
    }

    pub fn delete_smart_frame(&self, id: String) -> CoreResult<()> {
        let conn = self.conn()?;
        let changed = conn.execute("DELETE FROM smart_frames WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(CoreError::NotFound("Smart Frame".to_string()));
        }
        Ok(())
    }

    pub fn get_smart_frame(&self, id: String) -> CoreResult<SmartFrame> {
        let conn = self.conn()?;
        let raw = conn
            .query_row(
                "SELECT id, name, filter_json, sort_order, created_at, updated_at
                 FROM smart_frames WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Smart Frame".to_string()))?;
        decode_smart_frame(raw.0, raw.1, raw.2, raw.3, raw.4, raw.5)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn smart_frame_crud_persists_typed_filter_without_fragment_copies() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let filter = FragmentFilter {
            tags: vec!["Editorial".to_string()],
            min_width: Some(1200),
            orientation: Some("landscape".to_string()),
            ..FragmentFilter::default()
        };
        let created = core
            .create_smart_frame("Wide editorial".to_string(), filter.clone())
            .expect("create");
        assert_eq!(core.list_smart_frames().expect("list").len(), 1);
        assert_eq!(created.filter, filter);

        let updated = core
            .update_smart_frame(
                created.id.clone(),
                "Editorial landscape".to_string(),
                FragmentFilter {
                    has_notes: Some(true),
                    ..filter
                },
            )
            .expect("update");
        assert_eq!(updated.name, "Editorial landscape");
        assert_eq!(core.list_all_fragments().expect("fragments").len(), 0);

        core.delete_smart_frame(created.id).expect("delete");
        assert!(core.list_smart_frames().expect("list").is_empty());
    }
}
