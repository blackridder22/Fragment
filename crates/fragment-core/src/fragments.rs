use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Duration, Utc};
use image::ImageFormat;
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::hashing::sha256_hex;
use crate::models::{Fragment, ImportDuplicateCheck};
use crate::storage::{extension_for_format, mime_for_format, safe_existing_file, write_atomic};
use crate::thumbnails::{decode_image, dimensions, generate_preview, generate_thumbnail};

pub(crate) struct NewFragmentAsset {
    pub(crate) bytes: Vec<u8>,
    pub(crate) format: ImageFormat,
    pub(crate) title: Option<String>,
    pub(crate) note: Option<String>,
    pub(crate) source_url: Option<String>,
    pub(crate) page_url: Option<String>,
    pub(crate) site_name: Option<String>,
    pub(crate) creator_name: Option<String>,
    pub(crate) captured_from: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredAsset {
    id: String,
    original_path: String,
    thumbnail_path: String,
    preview_path: Option<String>,
    mime_type: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    file_size: Option<i64>,
    sha256: Option<String>,
    perceptual_hash: Option<String>,
}

fn fragment_select_sql(where_clause: &str) -> String {
    format!(
        "
        SELECT
          fragments.id AS id,
          fragments.asset_id AS asset_id,
          fragments.frame_id AS frame_id,
          fragments.title AS title,
          fragments.description AS description,
          fragments.note AS note,
          fragments.source_url AS source_url,
          fragments.page_url AS page_url,
          fragments.site_name AS site_name,
          fragments.creator_name AS creator_name,
          COALESCE(assets.original_path, fragments.original_path) AS original_path,
          COALESCE(assets.thumbnail_path, fragments.thumbnail_path) AS thumbnail_path,
          COALESCE(assets.preview_path, fragments.preview_path) AS preview_path,
          COALESCE(assets.mime_type, fragments.mime_type) AS mime_type,
          COALESCE(assets.width, fragments.width) AS width,
          COALESCE(assets.height, fragments.height) AS height,
          COALESCE(assets.file_size, fragments.file_size) AS file_size,
          COALESCE(assets.sha256, fragments.sha256) AS sha256,
          COALESCE(assets.perceptual_hash, fragments.perceptual_hash) AS perceptual_hash,
          fragments.captured_from AS captured_from,
          fragments.captured_at AS captured_at,
          fragments.created_at AS created_at,
          fragments.updated_at AS updated_at,
          fragments.deleted_at AS deleted_at,
          fragments.delete_after AS delete_after
        FROM fragments
        LEFT JOIN assets ON assets.id = fragments.asset_id
        {where_clause}
        "
    )
}

pub(crate) fn map_fragment(row: &Row<'_>) -> rusqlite::Result<Fragment> {
    Ok(Fragment {
        id: row.get("id")?,
        asset_id: row.get("asset_id")?,
        frame_id: row.get("frame_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        note: row.get("note")?,
        source_url: row.get("source_url")?,
        page_url: row.get("page_url")?,
        site_name: row.get("site_name")?,
        creator_name: row.get("creator_name")?,
        original_path: row.get("original_path")?,
        thumbnail_path: row.get("thumbnail_path")?,
        preview_path: row.get("preview_path")?,
        mime_type: row.get("mime_type")?,
        width: row.get("width")?,
        height: row.get("height")?,
        file_size: row.get("file_size")?,
        sha256: row.get("sha256")?,
        perceptual_hash: row.get("perceptual_hash")?,
        captured_from: row.get("captured_from")?,
        captured_at: row.get("captured_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
        delete_after: row.get("delete_after")?,
    })
}

impl FragmentCore {
    pub fn list_all_fragments(&self) -> CoreResult<Vec<Fragment>> {
        let conn = self.conn()?;
        let sql = fragment_select_sql(
            "WHERE fragments.deleted_at IS NULL ORDER BY fragments.captured_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let fragments = stmt
            .query_map([], map_fragment)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(fragments)
    }

    pub fn list_trashed_fragments(&self) -> CoreResult<Vec<Fragment>> {
        let conn = self.conn()?;
        let sql = fragment_select_sql(
            "WHERE fragments.deleted_at IS NOT NULL ORDER BY fragments.deleted_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let fragments = stmt
            .query_map([], map_fragment)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(fragments)
    }

    pub fn list_fragments(&self, frame_id: String) -> CoreResult<Vec<Fragment>> {
        self.require_frame(&frame_id)?;
        let conn = self.conn()?;
        let sql = fragment_select_sql(
            "WHERE fragments.frame_id = ?1 AND fragments.deleted_at IS NULL ORDER BY fragments.captured_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let fragments = stmt
            .query_map(params![frame_id], map_fragment)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(fragments)
    }

    pub fn get_fragment(&self, id: String) -> CoreResult<Fragment> {
        self.get_fragment_any(id, false)
    }

    fn get_fragment_any(&self, id: String, include_deleted: bool) -> CoreResult<Fragment> {
        let conn = self.conn()?;
        let sql = if include_deleted {
            fragment_select_sql("WHERE fragments.id = ?1")
        } else {
            fragment_select_sql("WHERE fragments.id = ?1 AND fragments.deleted_at IS NULL")
        };
        let fragment = conn
            .query_row(&sql, params![id], map_fragment)
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
        Ok(fragment)
    }

    pub fn update_fragment(
        &self,
        id: String,
        title: Option<String>,
        note: Option<String>,
    ) -> CoreResult<Fragment> {
        let now = Utc::now().to_rfc3339();
        {
            let conn = self.conn()?;
            let changed = conn.execute(
                "UPDATE fragments SET title = ?1, note = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
                params![&title, &note, &now, &id],
            )?;
            if changed == 0 {
                return Err(CoreError::NotFound("Fragment".to_string()));
            }
        }
        self.get_fragment(id)
    }

    pub fn delete_fragment(&self, id: String) -> CoreResult<()> {
        self.hard_delete_fragment(id)
    }

    pub fn delete_fragment_with_policy(
        &self,
        id: String,
        retention_days: Option<u32>,
    ) -> CoreResult<()> {
        match retention_days {
            Some(days) if days > 0 => self.trash_fragment(id, days),
            _ => self.hard_delete_fragment(id),
        }
    }

    pub fn restore_fragment(&self, id: String) -> CoreResult<Fragment> {
        {
            let conn = self.conn()?;
            let deleted_at = conn
                .query_row(
                    "SELECT deleted_at FROM fragments WHERE id = ?1",
                    params![&id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
            if deleted_at.is_some() {
                let now = Utc::now().to_rfc3339();
                conn.execute(
                    "UPDATE fragments SET deleted_at = NULL, delete_after = NULL, updated_at = ?1 WHERE id = ?2",
                    params![now, &id],
                )?;
            }
        }
        self.get_fragment(id)
    }

    pub fn delete_fragment_everywhere(&self, id: String) -> CoreResult<()> {
        let fragment = self.get_fragment_any(id, true)?;
        let Some(asset_id) = fragment.asset_id.clone() else {
            return self.hard_delete_fragment(fragment.id);
        };

        {
            let conn = self.conn()?;
            conn.execute(
                "DELETE FROM fragments WHERE asset_id = ?1",
                params![&asset_id],
            )?;
            conn.execute("DELETE FROM assets WHERE id = ?1", params![&asset_id])?;
        }
        self.remove_fragment_files(&fragment)
    }

    fn trash_fragment(&self, id: String, retention_days: u32) -> CoreResult<()> {
        let now = Utc::now();
        let deleted_at = now.to_rfc3339();
        let delete_after = (now + Duration::days(i64::from(retention_days))).to_rfc3339();
        let conn = self.conn()?;
        let changed = conn.execute(
            "UPDATE fragments SET deleted_at = ?1, delete_after = ?2, updated_at = ?1 WHERE id = ?3 AND deleted_at IS NULL",
            params![deleted_at, delete_after, id],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound("Fragment".to_string()));
        }
        Ok(())
    }

    fn hard_delete_fragment(&self, id: String) -> CoreResult<()> {
        let fragment = self.get_fragment_any(id.clone(), true)?;
        {
            let conn = self.conn()?;
            conn.execute("DELETE FROM fragments WHERE id = ?1", params![id])?;
        }
        self.remove_orphan_asset_for_fragment(&fragment)
    }

    pub fn check_import_duplicate(
        &self,
        frame_id: Option<String>,
        file_path: String,
    ) -> CoreResult<ImportDuplicateCheck> {
        let frame_id = self.resolve_frame_id(frame_id)?;
        let safe_path = safe_existing_file(Path::new(&file_path))?;
        let bytes = fs::read(&safe_path)?;
        let image = decode_image(&bytes)?;
        let (width, height) = dimensions(&image);
        let sha256 = sha256_hex(&bytes);
        let title = file_title(&safe_path);
        self.duplicate_check_for_asset(&frame_id, &sha256, title.as_deref(), width, height)
    }

    pub fn import_image(
        &self,
        frame_id: Option<String>,
        file_path: String,
        title_override: Option<String>,
    ) -> CoreResult<Fragment> {
        let frame_id = self.resolve_frame_id(frame_id)?;

        let safe_path = safe_existing_file(Path::new(&file_path))?;
        let bytes = fs::read(&safe_path)?;
        let format = image::guess_format(&bytes)?;
        let fallback_title = file_title(&safe_path);
        let allow_same_frame_duplicate = title_override.is_some();
        let title = title_override
            .as_ref()
            .and_then(|value| {
                let trimmed = value.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            })
            .or(fallback_title);

        self.insert_fragment_from_asset(
            &frame_id,
            NewFragmentAsset {
                bytes,
                format,
                title,
                note: None,
                source_url: None,
                page_url: None,
                site_name: None,
                creator_name: None,
                captured_from: Some("local_import".to_string()),
            },
            allow_same_frame_duplicate,
        )
    }

    pub(crate) fn insert_fragment_from_asset(
        &self,
        frame_id: &str,
        asset: NewFragmentAsset,
        allow_same_frame_duplicate: bool,
    ) -> CoreResult<Fragment> {
        self.require_frame(frame_id)?;

        let sha256 = sha256_hex(&asset.bytes);
        let image = decode_image(&asset.bytes)?;
        let (width, height) = dimensions(&image);
        if !allow_same_frame_duplicate {
            if self
                .duplicate_fragment_id_in_frame(frame_id, &sha256)?
                .is_some()
            {
                return Err(CoreError::DuplicateFragment("same_image".to_string()));
            }
        }

        let stored_asset = match self.asset_by_sha(&sha256)? {
            Some(existing) => existing,
            None => self.store_new_asset(&asset, &sha256, &image, width, height)?,
        };

        self.create_fragment_record(frame_id, asset, &stored_asset)
    }

    pub(crate) fn duplicate_fragment_id_in_frame(
        &self,
        frame_id: &str,
        sha256: &str,
    ) -> CoreResult<Option<String>> {
        let conn = self.conn()?;
        let existing = conn
            .query_row(
                "
                SELECT fragments.id
                FROM fragments
                LEFT JOIN assets ON assets.id = fragments.asset_id
                WHERE fragments.frame_id = ?1
                  AND fragments.deleted_at IS NULL
                  AND COALESCE(assets.sha256, fragments.sha256) = ?2
                ORDER BY fragments.captured_at ASC
                LIMIT 1
                ",
                params![frame_id, sha256],
                |row| row.get(0),
            )
            .optional()?;
        Ok(existing)
    }

    pub(crate) fn insert_tags(&self, fragment_id: &str, tags: &[String]) -> CoreResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        for tag in tags
            .iter()
            .map(|tag| tag.trim())
            .filter(|tag| !tag.is_empty())
        {
            let tag_id = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            tx.execute(
                "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![tag_id, tag, now],
            )?;
            let existing_id: String =
                tx.query_row("SELECT id FROM tags WHERE name = ?1", params![tag], |row| {
                    row.get(0)
                })?;
            tx.execute(
                "INSERT OR IGNORE INTO fragment_tags (fragment_id, tag_id) VALUES (?1, ?2)",
                params![fragment_id, existing_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn remove_orphan_asset_for_fragment(&self, fragment: &Fragment) -> CoreResult<()> {
        let Some(asset_id) = fragment.asset_id.as_deref() else {
            return self.remove_fragment_files(fragment);
        };

        let remaining: i64 = {
            let conn = self.conn()?;
            conn.query_row(
                "SELECT count(*) FROM fragments WHERE asset_id = ?1",
                params![asset_id],
                |row| row.get(0),
            )?
        };
        if remaining > 0 {
            return Ok(());
        }

        {
            let conn = self.conn()?;
            conn.execute("DELETE FROM assets WHERE id = ?1", params![asset_id])?;
        }
        self.remove_fragment_files(fragment)
    }

    pub(crate) fn remove_fragment_files(&self, fragment: &Fragment) -> CoreResult<()> {
        for relative_path in [
            Some(fragment.original_path.as_str()),
            Some(fragment.thumbnail_path.as_str()),
            fragment.preview_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let path = self.paths().resolve_relative_path(relative_path)?;
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    fn resolve_frame_id(&self, frame_id: Option<String>) -> CoreResult<String> {
        let frame_id = match frame_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => self.default_frame_id()?,
        };
        self.require_frame(&frame_id)?;
        Ok(frame_id)
    }

    fn duplicate_check_for_asset(
        &self,
        frame_id: &str,
        sha256: &str,
        title: Option<&str>,
        width: i64,
        height: i64,
    ) -> CoreResult<ImportDuplicateCheck> {
        let conn = self.conn()?;
        let same_image = conn
            .query_row(
                "
                SELECT fragments.id, fragments.title, frames.id, frames.name
                FROM fragments
                LEFT JOIN assets ON assets.id = fragments.asset_id
                LEFT JOIN frames ON frames.id = fragments.frame_id
                WHERE fragments.frame_id = ?1
                  AND fragments.deleted_at IS NULL
                  AND COALESCE(assets.sha256, fragments.sha256) = ?2
                ORDER BY fragments.captured_at ASC
                LIMIT 1
                ",
                params![frame_id, sha256],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?;
        if let Some((existing_id, existing_title, existing_frame_id, existing_frame_name)) =
            same_image
        {
            return Ok(ImportDuplicateCheck {
                duplicate: true,
                kind: Some("same_image".to_string()),
                existing_fragment_id: Some(existing_id),
                existing_frame_id,
                existing_frame_name,
                existing_title,
                suggested_title: title.map(suggest_copy_title),
                width: Some(width),
                height: Some(height),
            });
        }

        let normalized_title = title.map(str::trim).filter(|value| !value.is_empty());
        if let Some(title) = normalized_title {
            let same_title_and_pixels = conn
                .query_row(
                    "
                    SELECT fragments.id, fragments.title, frames.id, frames.name
                    FROM fragments
                    LEFT JOIN assets ON assets.id = fragments.asset_id
                    LEFT JOIN frames ON frames.id = fragments.frame_id
                    WHERE fragments.frame_id = ?1
                      AND fragments.deleted_at IS NULL
                      AND lower(COALESCE(fragments.title, '')) = lower(?2)
                      AND COALESCE(assets.width, fragments.width) = ?3
                      AND COALESCE(assets.height, fragments.height) = ?4
                    ORDER BY fragments.captured_at ASC
                    LIMIT 1
                    ",
                    params![frame_id, title, width, height],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((existing_id, existing_title, existing_frame_id, existing_frame_name)) =
                same_title_and_pixels
            {
                return Ok(ImportDuplicateCheck {
                    duplicate: true,
                    kind: Some("same_name_and_pixels".to_string()),
                    existing_fragment_id: Some(existing_id),
                    existing_frame_id,
                    existing_frame_name,
                    existing_title,
                    suggested_title: Some(suggest_copy_title(title)),
                    width: Some(width),
                    height: Some(height),
                });
            }
        }

        let same_image_elsewhere = conn
            .query_row(
                "
                SELECT fragments.id, fragments.title, frames.id, frames.name
                FROM fragments
                LEFT JOIN assets ON assets.id = fragments.asset_id
                LEFT JOIN frames ON frames.id = fragments.frame_id
                WHERE fragments.frame_id <> ?1
                  AND fragments.deleted_at IS NULL
                  AND COALESCE(assets.sha256, fragments.sha256) = ?2
                ORDER BY fragments.captured_at ASC
                LIMIT 1
                ",
                params![frame_id, sha256],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?;
        if let Some((existing_id, existing_title, existing_frame_id, existing_frame_name)) =
            same_image_elsewhere
        {
            return Ok(ImportDuplicateCheck {
                duplicate: true,
                kind: Some("same_image_in_vault".to_string()),
                existing_fragment_id: Some(existing_id),
                existing_frame_id,
                existing_frame_name,
                existing_title,
                suggested_title: title.map(suggest_copy_title),
                width: Some(width),
                height: Some(height),
            });
        }

        Ok(ImportDuplicateCheck {
            duplicate: false,
            kind: None,
            existing_fragment_id: None,
            existing_frame_id: None,
            existing_frame_name: None,
            existing_title: None,
            suggested_title: title.map(suggest_copy_title),
            width: Some(width),
            height: Some(height),
        })
    }

    fn asset_by_sha(&self, sha256: &str) -> CoreResult<Option<StoredAsset>> {
        let conn = self.conn()?;
        let asset = conn
            .query_row(
                "
                SELECT id, original_path, thumbnail_path, preview_path, mime_type,
                       width, height, file_size, sha256, perceptual_hash
                FROM assets
                WHERE sha256 = ?1
                LIMIT 1
                ",
                params![sha256],
                map_stored_asset,
            )
            .optional()?;
        Ok(asset)
    }

    fn store_new_asset(
        &self,
        asset: &NewFragmentAsset,
        sha256: &str,
        image: &image::DynamicImage,
        width: i64,
        height: i64,
    ) -> CoreResult<StoredAsset> {
        let now = Utc::now();
        let now_text = now.to_rfc3339();
        let asset_id = Uuid::new_v4().to_string();
        let extension = extension_for_format(asset.format);
        let original_abs = original_path(
            self.paths().root(),
            &asset_id,
            extension,
            now.year(),
            now.month(),
        );
        let thumbnail_abs = self
            .paths()
            .thumbnails_dir()
            .join(format!("{asset_id}.png"));
        let preview_abs = self.paths().previews_dir().join(format!("{asset_id}.png"));

        write_atomic(&original_abs, &asset.bytes)?;
        generate_thumbnail(image, &thumbnail_abs)?;
        generate_preview(image, &preview_abs)?;

        let stored = StoredAsset {
            id: asset_id,
            original_path: self.paths().to_relative_string(&original_abs)?,
            thumbnail_path: self.paths().to_relative_string(&thumbnail_abs)?,
            preview_path: Some(self.paths().to_relative_string(&preview_abs)?),
            mime_type: Some(mime_for_format(asset.format).to_string()),
            width: Some(width),
            height: Some(height),
            file_size: Some(i64::try_from(asset.bytes.len()).unwrap_or(i64::MAX)),
            sha256: Some(sha256.to_string()),
            perceptual_hash: None,
        };

        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO assets (
              id, original_path, thumbnail_path, preview_path, mime_type, width, height,
              file_size, sha256, perceptual_hash, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &stored.id,
                &stored.original_path,
                &stored.thumbnail_path,
                &stored.preview_path,
                &stored.mime_type,
                &stored.width,
                &stored.height,
                &stored.file_size,
                &stored.sha256,
                &stored.perceptual_hash,
                &now_text,
                &now_text
            ],
        )?;

        Ok(stored)
    }

    fn create_fragment_record(
        &self,
        frame_id: &str,
        asset: NewFragmentAsset,
        stored_asset: &StoredAsset,
    ) -> CoreResult<Fragment> {
        let now_text = Utc::now().to_rfc3339();
        let fragment = Fragment {
            id: Uuid::new_v4().to_string(),
            asset_id: Some(stored_asset.id.clone()),
            frame_id: frame_id.to_string(),
            title: asset.title,
            description: None,
            note: asset.note,
            source_url: asset.source_url,
            page_url: asset.page_url,
            site_name: asset.site_name,
            creator_name: asset.creator_name,
            original_path: stored_asset.original_path.clone(),
            thumbnail_path: stored_asset.thumbnail_path.clone(),
            preview_path: stored_asset.preview_path.clone(),
            mime_type: stored_asset.mime_type.clone(),
            width: stored_asset.width,
            height: stored_asset.height,
            file_size: stored_asset.file_size,
            sha256: stored_asset.sha256.clone(),
            perceptual_hash: stored_asset.perceptual_hash.clone(),
            captured_from: asset.captured_from,
            captured_at: now_text.clone(),
            created_at: now_text.clone(),
            updated_at: now_text,
            deleted_at: None,
            delete_after: None,
        };

        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO fragments (
              id, asset_id, frame_id, title, description, note, source_url, page_url,
              site_name, creator_name, original_path, thumbnail_path, preview_path,
              mime_type, width, height, file_size, sha256, perceptual_hash,
              captured_from, captured_at, created_at, updated_at, deleted_at, delete_after
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
            params![
                &fragment.id,
                &fragment.asset_id,
                &fragment.frame_id,
                &fragment.title,
                &fragment.description,
                &fragment.note,
                &fragment.source_url,
                &fragment.page_url,
                &fragment.site_name,
                &fragment.creator_name,
                &fragment.original_path,
                &fragment.thumbnail_path,
                &fragment.preview_path,
                &fragment.mime_type,
                &fragment.width,
                &fragment.height,
                &fragment.file_size,
                &fragment.sha256,
                &fragment.perceptual_hash,
                &fragment.captured_from,
                &fragment.captured_at,
                &fragment.created_at,
                &fragment.updated_at,
                &fragment.deleted_at,
                &fragment.delete_after
            ],
        )?;

        Ok(fragment)
    }
}

fn map_stored_asset(row: &Row<'_>) -> rusqlite::Result<StoredAsset> {
    Ok(StoredAsset {
        id: row.get("id")?,
        original_path: row.get("original_path")?,
        thumbnail_path: row.get("thumbnail_path")?,
        preview_path: row.get("preview_path")?,
        mime_type: row.get("mime_type")?,
        width: row.get("width")?,
        height: row.get("height")?,
        file_size: row.get("file_size")?,
        sha256: row.get("sha256")?,
        perceptual_hash: row.get("perceptual_hash")?,
    })
}

fn file_title(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
}

fn suggest_copy_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "Untitled copy".to_string()
    } else {
        format!("{trimmed} copy")
    }
}

fn original_path(root: &Path, asset_id: &str, extension: &str, year: i32, month: u32) -> PathBuf {
    root.join("originals")
        .join(year.to_string())
        .join(format!("{month:02}"))
        .join(format!("{asset_id}.{extension}"))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageBuffer, ImageFormat, Rgba};
    use tempfile::tempdir;

    use crate::FragmentCore;

    fn sample_png_bytes() -> Vec<u8> {
        let image = ImageBuffer::from_fn(24, 16, |x, y| {
            if (x + y) % 2 == 0 {
                Rgba([255_u8, 64, 128, 255])
            } else {
                Rgba([16_u8, 24, 32, 255])
            }
        });
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .expect("encode png");
        cursor.into_inner()
    }

    #[test]
    fn import_image_creates_original_thumbnail_and_preview_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");

        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");

        assert_eq!(fragment.width, Some(24));
        assert_eq!(fragment.height, Some(16));
        assert!(fragment.asset_id.is_some());
        assert!(fragment.original_path.starts_with("originals/"));
        assert!(fragment.thumbnail_path.starts_with("thumbnails/"));
        assert!(fragment.thumbnail_path.ends_with(".png"));
        assert!(fragment
            .preview_path
            .as_deref()
            .is_some_and(|path| path.starts_with("previews/") && path.ends_with(".png")));

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
    fn duplicate_image_can_be_reused_in_another_frame_without_copying_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create frame");

        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");
        let second = core
            .import_image(
                Some(frame.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("second import");

        assert_ne!(first.id, second.id);
        assert_eq!(first.asset_id, second.asset_id);
        assert_eq!(first.original_path, second.original_path);
    }

    #[test]
    fn duplicate_check_flags_same_frame_image() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        core.import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");

        let check = core
            .check_import_duplicate(None, source_path.to_string_lossy().to_string())
            .expect("check");

        assert!(check.duplicate);
        assert_eq!(check.kind.as_deref(), Some("same_image"));
        assert_eq!(check.width, Some(24));
        assert_eq!(check.height, Some(16));
    }

    #[test]
    fn duplicate_check_flags_same_image_elsewhere_in_vault() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let source_frame = core
            .create_frame(None, "Source Frame".to_string())
            .expect("source frame");
        let target_frame = core
            .create_frame(None, "Target Frame".to_string())
            .expect("target frame");
        core.import_image(
            Some(source_frame.id.clone()),
            source_path.to_string_lossy().to_string(),
            None,
        )
        .expect("import");

        let check = core
            .check_import_duplicate(
                Some(target_frame.id),
                source_path.to_string_lossy().to_string(),
            )
            .expect("check");

        assert!(check.duplicate);
        assert_eq!(check.kind.as_deref(), Some("same_image_in_vault"));
        assert_eq!(
            check.existing_frame_id.as_deref(),
            Some(source_frame.id.as_str())
        );
        assert_eq!(check.existing_frame_name.as_deref(), Some("Source Frame"));
    }

    #[test]
    fn hard_delete_removes_asset_files_only_after_last_reference() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");
        let second = core
            .import_image(
                Some(frame.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("second import");
        let paths = [
            Some(first.original_path.as_str()),
            Some(first.thumbnail_path.as_str()),
            first.preview_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(|relative_path| {
            core.paths()
                .resolve_relative_path(relative_path)
                .expect("resolve")
        })
        .collect::<Vec<_>>();

        core.delete_fragment(first.id).expect("delete first");
        for path in &paths {
            assert!(path.exists(), "{} should remain", path.display());
        }

        core.delete_fragment(second.id).expect("delete second");
        for path in paths {
            assert!(!path.exists(), "{} should be removed", path.display());
        }
    }

    #[test]
    fn trash_policy_hides_fragment_without_removing_asset_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        let original_path = core
            .paths()
            .resolve_relative_path(&fragment.original_path)
            .expect("resolve");

        core.delete_fragment_with_policy(fragment.id.clone(), Some(7))
            .expect("trash");

        assert!(core.get_fragment(fragment.id).is_err());
        assert!(original_path.exists());
        assert!(core.list_all_fragments().expect("list").is_empty());
        let trashed = core
            .list_trashed_fragments()
            .expect("list trashed fragments");
        assert_eq!(trashed.len(), 1);
        assert!(trashed[0].deleted_at.is_some());
        assert!(trashed[0].delete_after.is_some());
    }

    #[test]
    fn restore_fragment_returns_trashed_fragment_to_active_library() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");

        core.delete_fragment_with_policy(fragment.id.clone(), Some(7))
            .expect("trash");
        let restored = core
            .restore_fragment(fragment.id.clone())
            .expect("restore fragment");

        assert_eq!(restored.id, fragment.id);
        assert!(restored.deleted_at.is_none());
        assert!(restored.delete_after.is_none());
        assert_eq!(core.list_all_fragments().expect("active").len(), 1);
        assert!(core.list_trashed_fragments().expect("trash").is_empty());
    }

    #[test]
    fn delete_fragment_everywhere_removes_all_shared_references_and_asset_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");
        let _second = core
            .import_image(
                Some(frame.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("second import");
        let paths = [
            Some(first.original_path.as_str()),
            Some(first.thumbnail_path.as_str()),
            first.preview_path.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(|relative_path| {
            core.paths()
                .resolve_relative_path(relative_path)
                .expect("resolve")
        })
        .collect::<Vec<_>>();

        core.delete_fragment_everywhere(first.id)
            .expect("delete everywhere");

        assert!(core.list_all_fragments().expect("active").is_empty());
        for path in paths {
            assert!(!path.exists(), "{} should be removed", path.display());
        }
    }
}
