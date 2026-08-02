use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Duration, Utc};
use image::ImageFormat;
use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Row, TransactionBehavior,
};
use uuid::Uuid;

use crate::db::FragmentCore;
use crate::errors::{CoreError, CoreResult};
use crate::hashing::sha256_hex;
use crate::models::{FileCleanupReport, Fragment, FragmentFilter, PurgeReport};
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

pub(crate) struct MembershipBatchResult {
    pub(crate) fragments: Vec<Fragment>,
    pub(crate) duplicates: Vec<(String, bool)>,
    pub(crate) reused_existing_asset: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportOutcome {
    New(Fragment),
    Linked(Fragment),
    SkippedDuplicate {
        existing_fragment_id: String,
        trashed: bool,
    },
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

fn trimmed_lower(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
}

fn push_contains_filter(
    conditions: &mut Vec<String>,
    values: &mut Vec<Value>,
    expression: &str,
    value: &Option<String>,
) {
    if let Some(value) = trimmed_lower(value) {
        conditions.push(format!("instr(lower(COALESCE({expression}, '')), ?) > 0"));
        values.push(Value::Text(value));
    }
}

fn build_filtered_scope(
    frame_id: Option<String>,
    include_descendants: bool,
    trashed: bool,
    filter: &FragmentFilter,
) -> CoreResult<(String, Vec<Value>)> {
    if filter.tags.len() > 32 || filter.mime_types.len() > 16 {
        return Err(CoreError::InvalidInput(
            "Fragment filter contains too many tag or format values".to_string(),
        ));
    }
    let mut conditions = Vec::with_capacity(24);
    let mut values = Vec::with_capacity(24);
    if let Some(frame_id) = frame_id {
        conditions.push(
            if include_descendants {
                "fragments.frame_id IN (
                   WITH RECURSIVE frame_tree(id) AS (
                     SELECT id FROM frames WHERE id = ?
                     UNION ALL
                     SELECT frames.id FROM frames
                     INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
                     WHERE frames.deleted_at IS NULL
                   )
                   SELECT id FROM frame_tree
                 )"
            } else {
                "fragments.frame_id = ?"
            }
            .to_string(),
        );
        values.push(Value::Text(frame_id));
    }
    conditions.push(
        if trashed {
            "fragments.deleted_at IS NOT NULL"
        } else {
            "fragments.deleted_at IS NULL"
        }
        .to_string(),
    );
    conditions.push("frames.deleted_at IS NULL".to_string());

    match filter.source_kind.as_deref().unwrap_or("all") {
        "all" => {}
        "source" => conditions.push(
            "(NULLIF(trim(fragments.source_url), '') IS NOT NULL OR NULLIF(trim(fragments.page_url), '') IS NOT NULL)".to_string(),
        ),
        "local" => conditions.push(
            "NULLIF(trim(fragments.source_url), '') IS NULL AND NULLIF(trim(fragments.page_url), '') IS NULL".to_string(),
        ),
        value => {
            return Err(CoreError::InvalidInput(format!(
                "Unknown Fragment source kind: {value}"
            )))
        }
    }

    if let Some(query) = trimmed_lower(&filter.query) {
        conditions.push(
            "instr(lower(
               COALESCE(fragments.title, '') || char(31) ||
               COALESCE(fragments.description, '') || char(31) ||
               COALESCE(fragments.note, '') || char(31) ||
               COALESCE(fragments.source_url, '') || char(31) ||
               COALESCE(fragments.page_url, '') || char(31) ||
               COALESCE(fragments.site_name, '') || char(31) ||
               COALESCE(fragments.creator_name, '') || char(31) ||
               COALESCE(frames.name, '')
             ), ?) > 0"
                .to_string(),
        );
        values.push(Value::Text(query));
    }

    let mime_types = filter
        .mime_types
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if !mime_types.is_empty() {
        conditions.push(format!(
            "lower(COALESCE(assets.mime_type, fragments.mime_type, '')) IN ({})",
            std::iter::repeat_n("?", mime_types.len())
                .collect::<Vec<_>>()
                .join(", ")
        ));
        values.extend(mime_types.into_iter().map(Value::Text));
    }

    for tag in filter
        .tags
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
    {
        conditions.push(
            "EXISTS (
               SELECT 1 FROM fragment_tags
               INNER JOIN tags ON tags.id = fragment_tags.tag_id
               WHERE fragment_tags.fragment_id = fragments.id AND lower(tags.name) = ?
             )"
            .to_string(),
        );
        values.push(Value::Text(tag));
    }

    if let Some(domain) = trimmed_lower(&filter.source_domain) {
        let domain = domain
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_start_matches("www.")
            .trim_end_matches('/')
            .to_string();
        conditions.push(
            "lower(COALESCE(fragments.source_url, '') || char(31) || COALESCE(fragments.page_url, '')) LIKE ?"
                .to_string(),
        );
        values.push(Value::Text(format!("%{domain}%")));
    }

    for (expression, value, operator) in [
        ("fragments.captured_at", &filter.captured_after, ">="),
        ("fragments.captured_at", &filter.captured_before, "<="),
    ] {
        if let Some(value) = value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            conditions.push(format!("{expression} {operator} ?"));
            values.push(Value::Text(value.to_string()));
        }
    }

    for (expression, value, operator) in [
        (
            "COALESCE(assets.width, fragments.width)",
            filter.min_width,
            ">=",
        ),
        (
            "COALESCE(assets.width, fragments.width)",
            filter.max_width,
            "<=",
        ),
        (
            "COALESCE(assets.height, fragments.height)",
            filter.min_height,
            ">=",
        ),
        (
            "COALESCE(assets.height, fragments.height)",
            filter.max_height,
            "<=",
        ),
        (
            "COALESCE(assets.file_size, fragments.file_size)",
            filter.min_file_size,
            ">=",
        ),
        (
            "COALESCE(assets.file_size, fragments.file_size)",
            filter.max_file_size,
            "<=",
        ),
    ] {
        if let Some(value) = value {
            if value < 0 {
                return Err(CoreError::InvalidInput(
                    "Fragment numeric filters cannot be negative".to_string(),
                ));
            }
            conditions.push(format!("{expression} {operator} ?"));
            values.push(Value::Integer(value));
        }
    }

    match filter.orientation.as_deref().unwrap_or("all") {
        "all" => {}
        "landscape" => conditions.push(
            "COALESCE(assets.width, fragments.width, 0) > COALESCE(assets.height, fragments.height, 0)".to_string(),
        ),
        "portrait" => conditions.push(
            "COALESCE(assets.height, fragments.height, 0) > COALESCE(assets.width, fragments.width, 0)".to_string(),
        ),
        "square" => conditions.push(
            "COALESCE(assets.width, fragments.width, 0) = COALESCE(assets.height, fragments.height, 0) AND COALESCE(assets.width, fragments.width, 0) > 0".to_string(),
        ),
        value => {
            return Err(CoreError::InvalidInput(format!(
                "Unknown Fragment orientation: {value}"
            )))
        }
    }

    if let Some(has_notes) = filter.has_notes {
        conditions.push(
            if has_notes {
                "NULLIF(trim(fragments.note), '') IS NOT NULL"
            } else {
                "NULLIF(trim(fragments.note), '') IS NULL"
            }
            .to_string(),
        );
    }
    push_contains_filter(
        &mut conditions,
        &mut values,
        "fragments.note",
        &filter.note_contains,
    );
    push_contains_filter(
        &mut conditions,
        &mut values,
        "fragments.title",
        &filter.title_contains,
    );
    push_contains_filter(
        &mut conditions,
        &mut values,
        "fragments.site_name",
        &filter.site_contains,
    );
    push_contains_filter(
        &mut conditions,
        &mut values,
        "fragments.creator_name",
        &filter.creator_contains,
    );

    Ok((conditions.join(" AND "), values))
}

fn filtered_order(sort_mode: Option<&str>, trashed: bool) -> CoreResult<&'static str> {
    match sort_mode.unwrap_or(if trashed { "deleted" } else { "newest" }) {
        "newest" => Ok("fragments.captured_at DESC, fragments.id DESC"),
        "oldest" => Ok("fragments.captured_at ASC, fragments.id ASC"),
        "name" => Ok("lower(COALESCE(fragments.title, '')) ASC, fragments.id ASC"),
        "largest" => {
            Ok("COALESCE(assets.file_size, fragments.file_size, 0) DESC, fragments.id DESC")
        }
        "deleted" if trashed => Ok("fragments.deleted_at DESC, fragments.id DESC"),
        value => Err(CoreError::InvalidInput(format!(
            "Unknown Fragment sort mode: {value}"
        ))),
    }
}

impl FragmentCore {
    pub fn active_fragment_counts_by_frame(&self) -> CoreResult<BTreeMap<String, u64>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "
            SELECT fragments.frame_id, count(*)
            FROM fragments
            INNER JOIN frames ON frames.id = fragments.frame_id
            WHERE fragments.deleted_at IS NULL AND frames.deleted_at IS NULL
            GROUP BY fragments.frame_id
            ",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(frame_id, count)| {
                u64::try_from(count)
                    .map(|count| (frame_id, count))
                    .map_err(|_| {
                        CoreError::InvalidInput("Fragment count cannot be negative".to_string())
                    })
            })
            .collect()
    }

    pub fn list_all_fragments(&self) -> CoreResult<Vec<Fragment>> {
        let conn = self.conn()?;
        let sql = fragment_select_sql(
            "WHERE fragments.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM frames
               WHERE frames.id = fragments.frame_id AND frames.deleted_at IS NULL
             )
             ORDER BY fragments.captured_at DESC",
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
            "WHERE fragments.deleted_at IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM frames
               WHERE frames.id = fragments.frame_id AND frames.deleted_at IS NULL
             )
             ORDER BY fragments.deleted_at DESC",
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
            "WHERE fragments.frame_id = ?1
             AND fragments.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM frames
               WHERE frames.id = fragments.frame_id AND frames.deleted_at IS NULL
             )
             ORDER BY fragments.captured_at DESC",
        );
        let mut stmt = conn.prepare(&sql)?;
        let fragments = stmt
            .query_map(params![frame_id], map_fragment)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(fragments)
    }

    pub fn list_fragment_page(
        &self,
        frame_id: Option<String>,
        trashed: bool,
        offset: usize,
        limit: usize,
    ) -> CoreResult<(Vec<Fragment>, u64)> {
        self.list_fragment_page_scoped(frame_id, false, trashed, offset, limit)
    }

    pub fn list_fragment_page_scoped(
        &self,
        frame_id: Option<String>,
        include_descendants: bool,
        trashed: bool,
        offset: usize,
        limit: usize,
    ) -> CoreResult<(Vec<Fragment>, u64)> {
        self.list_fragment_page_filtered(
            frame_id,
            include_descendants,
            trashed,
            FragmentFilter::default(),
            None,
            offset,
            limit,
        )
    }

    pub fn list_fragment_page_filtered(
        &self,
        frame_id: Option<String>,
        include_descendants: bool,
        trashed: bool,
        filter: FragmentFilter,
        sort_mode: Option<String>,
        offset: usize,
        limit: usize,
    ) -> CoreResult<(Vec<Fragment>, u64)> {
        if let Some(frame_id) = frame_id.as_deref() {
            self.require_frame(frame_id)?;
        }
        let (predicate, values) =
            build_filtered_scope(frame_id, include_descendants, trashed, &filter)?;
        let conn = self.conn()?;
        let count_sql = format!(
            "SELECT count(*) FROM fragments
             LEFT JOIN assets ON assets.id = fragments.asset_id
             INNER JOIN frames ON frames.id = fragments.frame_id
             WHERE {predicate}"
        );
        let total: i64 = conn.query_row(&count_sql, params_from_iter(values.iter()), |row| {
            row.get(0)
        })?;
        let order = filtered_order(sort_mode.as_deref(), trashed)?;
        let page_clause = format!(
            "INNER JOIN frames ON frames.id = fragments.frame_id
             WHERE {predicate} ORDER BY {order} LIMIT ? OFFSET ?"
        );
        let sql = fragment_select_sql(&page_clause);
        let mut page_values = values;
        page_values.push(Value::Integer(i64::try_from(limit).map_err(|_| {
            CoreError::InvalidInput("Fragment page limit is too large".to_string())
        })?));
        page_values.push(Value::Integer(i64::try_from(offset).map_err(|_| {
            CoreError::InvalidInput("Fragment page offset is too large".to_string())
        })?));
        let mut stmt = conn.prepare(&sql)?;
        let items = stmt
            .query_map(params_from_iter(page_values.iter()), map_fragment)?
            .collect::<Result<Vec<_>, _>>()?;
        let total = u64::try_from(total).map_err(|_| {
            CoreError::InvalidInput("Fragment count cannot be negative".to_string())
        })?;
        Ok((items, total))
    }

    pub fn list_fragment_ids(
        &self,
        frame_id: Option<String>,
        trashed: bool,
        query: Option<String>,
        source_filter: Option<String>,
    ) -> CoreResult<Vec<String>> {
        self.list_fragment_ids_scoped(frame_id, false, trashed, query, source_filter)
    }

    pub fn list_fragment_ids_scoped(
        &self,
        frame_id: Option<String>,
        include_descendants: bool,
        trashed: bool,
        query: Option<String>,
        source_filter: Option<String>,
    ) -> CoreResult<Vec<String>> {
        if let Some(frame_id) = frame_id.as_deref() {
            self.require_frame(frame_id)?;
        }

        let mut conditions = Vec::with_capacity(6);
        let mut values = Vec::with_capacity(3);
        if let Some(frame_id) = frame_id {
            conditions.push(if include_descendants {
                "fragments.frame_id IN (
                   WITH RECURSIVE frame_tree(id) AS (
                     SELECT id FROM frames WHERE id = ?
                     UNION ALL
                     SELECT frames.id FROM frames
                     INNER JOIN frame_tree ON frames.parent_id = frame_tree.id
                     WHERE frames.deleted_at IS NULL
                   )
                   SELECT id FROM frame_tree
                 )"
            } else {
                "fragments.frame_id = ?"
            });
            values.push(Value::Text(frame_id));
        }
        conditions.push(if trashed {
            "fragments.deleted_at IS NOT NULL"
        } else {
            "fragments.deleted_at IS NULL"
        });
        conditions.push("frames.deleted_at IS NULL");

        match source_filter.as_deref().unwrap_or("all") {
            "all" => {}
            "source" => conditions.push(
                "(NULLIF(trim(fragments.source_url), '') IS NOT NULL OR
                  NULLIF(trim(fragments.page_url), '') IS NOT NULL)",
            ),
            "local" => conditions.push(
                "NULLIF(trim(fragments.source_url), '') IS NULL AND
                 NULLIF(trim(fragments.page_url), '') IS NULL",
            ),
            "png" => conditions.push(
                "(lower(COALESCE(assets.mime_type, fragments.mime_type, '')) LIKE '%png%' OR
                  lower(COALESCE(assets.original_path, fragments.original_path, '')) LIKE '%.png')",
            ),
            filter => {
                return Err(CoreError::InvalidInput(format!(
                    "Unknown Fragment source filter: {filter}"
                )))
            }
        }

        if let Some(query) = query.map(|value| value.trim().to_lowercase()) {
            if !query.is_empty() {
                conditions.push(
                    "instr(
                       lower(
                         COALESCE(fragments.title, '') || char(31) ||
                         COALESCE(fragments.description, '') || char(31) ||
                         COALESCE(fragments.note, '') || char(31) ||
                         COALESCE(fragments.source_url, '') || char(31) ||
                         COALESCE(fragments.page_url, '') || char(31) ||
                         COALESCE(frames.name, '')
                       ),
                       ?
                     ) > 0",
                );
                values.push(Value::Text(query));
            }
        }

        let order = if trashed {
            "fragments.deleted_at DESC, fragments.id DESC"
        } else {
            "fragments.captured_at DESC, fragments.id DESC"
        };
        let predicate = conditions.join(" AND ");
        let sql = format!(
            "SELECT fragments.id
             FROM fragments
             LEFT JOIN assets ON assets.id = fragments.asset_id
             INNER JOIN frames ON frames.id = fragments.frame_id
             WHERE {predicate}
             ORDER BY {order}"
        );
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&sql)?;
        let ids = stmt
            .query_map(params_from_iter(values.iter()), |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn list_fragment_ids_filtered(
        &self,
        frame_id: Option<String>,
        include_descendants: bool,
        trashed: bool,
        filter: FragmentFilter,
        sort_mode: Option<String>,
    ) -> CoreResult<Vec<String>> {
        if let Some(frame_id) = frame_id.as_deref() {
            self.require_frame(frame_id)?;
        }
        let (predicate, values) =
            build_filtered_scope(frame_id, include_descendants, trashed, &filter)?;
        let order = filtered_order(sort_mode.as_deref(), trashed)?;
        let sql = format!(
            "SELECT fragments.id
             FROM fragments
             LEFT JOIN assets ON assets.id = fragments.asset_id
             INNER JOIN frames ON frames.id = fragments.frame_id
             WHERE {predicate}
             ORDER BY {order}"
        );
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&sql)?;
        let ids = stmt
            .query_map(params_from_iter(values.iter()), |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn get_fragment(&self, id: String) -> CoreResult<Fragment> {
        self.get_fragment_any(id, false)
    }

    pub fn fragment_membership_count(&self, id: String) -> CoreResult<u64> {
        let conn = self.conn()?;
        let asset_id = conn
            .query_row(
                "SELECT asset_id FROM fragments WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
        let Some(asset_id) = asset_id else {
            return Ok(1);
        };
        let count: i64 = conn.query_row(
            "SELECT count(*) FROM fragments WHERE asset_id = ?1",
            params![asset_id],
            |row| row.get(0),
        )?;
        u64::try_from(count)
            .map_err(|_| CoreError::InvalidInput("Fragment count cannot be negative".to_string()))
    }

    pub fn get_fragment_including_deleted(&self, id: String) -> CoreResult<Fragment> {
        self.get_fragment_any(id, true)
    }

    fn get_fragment_any(&self, id: String, include_deleted: bool) -> CoreResult<Fragment> {
        let conn = self.conn()?;
        let sql = if include_deleted {
            fragment_select_sql("WHERE fragments.id = ?1")
        } else {
            fragment_select_sql(
                "WHERE fragments.id = ?1
                 AND fragments.deleted_at IS NULL
                 AND EXISTS (
                   SELECT 1 FROM frames
                   WHERE frames.id = fragments.frame_id AND frames.deleted_at IS NULL
                 )",
            )
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

    pub fn fragment_tags(&self, id: &str) -> CoreResult<Vec<String>> {
        let conn = self.conn()?;
        let exists = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM fragments WHERE id = ?1)",
            params![id],
            |row| row.get::<_, bool>(0),
        )?;
        if !exists {
            return Err(CoreError::NotFound("Fragment".to_string()));
        }
        let mut statement = conn.prepare(
            "SELECT tags.name
             FROM tags
             INNER JOIN fragment_tags ON fragment_tags.tag_id = tags.id
             WHERE fragment_tags.fragment_id = ?1
             ORDER BY tags.name COLLATE NOCASE, tags.name",
        )?;
        let tags = statement
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn list_tags(&self) -> CoreResult<Vec<String>> {
        let conn = self.conn()?;
        let mut statement = conn.prepare(
            "SELECT tags.name
             FROM tags
             WHERE EXISTS(
               SELECT 1 FROM fragment_tags WHERE fragment_tags.tag_id = tags.id
             )
             ORDER BY tags.name COLLATE NOCASE, tags.name",
        )?;
        let tags = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn set_fragment_tags(&self, id: String, tags: Vec<String>) -> CoreResult<Vec<String>> {
        let tags = normalize_tags(tags)?;
        {
            let mut conn = self.conn()?;
            let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let exists = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM fragments WHERE id = ?1)",
                params![&id],
                |row| row.get::<_, bool>(0),
            )?;
            if !exists {
                return Err(CoreError::NotFound("Fragment".to_string()));
            }

            transaction.execute(
                "DELETE FROM fragment_tags WHERE fragment_id = ?1",
                params![&id],
            )?;
            insert_tags_in_conn(&transaction, &id, &tags)?;
            transaction.execute(
                "DELETE FROM tags
                 WHERE NOT EXISTS(
                   SELECT 1 FROM fragment_tags WHERE fragment_tags.tag_id = tags.id
                 )",
                [],
            )?;
            transaction.commit()?;
        }
        self.fragment_tags(&id)
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
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (frame_id, asset_id, deleted_at) = tx
            .query_row(
                "SELECT frame_id, asset_id, deleted_at FROM fragments WHERE id = ?1",
                params![&id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;

        let frame_is_active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM frames WHERE id = ?1 AND deleted_at IS NULL)",
            params![&frame_id],
            |row| row.get(0),
        )?;
        if !frame_is_active {
            return Err(CoreError::InvalidInput(
                "restore the containing Frame before restoring this Fragment".to_string(),
            ));
        }

        if deleted_at.is_some() {
            if let Some(asset_id) = asset_id.as_deref() {
                let conflict = tx
                    .query_row(
                        "
                        SELECT id FROM fragments
                        WHERE frame_id = ?1 AND asset_id = ?2 AND id <> ?3
                        LIMIT 1
                        ",
                        params![&frame_id, asset_id, &id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if let Some(existing_fragment_id) = conflict {
                    return Err(CoreError::RestoreConflict {
                        fragment_id: id,
                        existing_fragment_id,
                    });
                }
            }

            let now = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE fragments SET deleted_at = NULL, delete_after = NULL, updated_at = ?1 WHERE id = ?2",
                params![now, &id],
            )?;
        }
        tx.commit()?;
        drop(conn);
        self.get_fragment(id)
    }

    pub fn delete_fragment_everywhere(&self, id: String) -> CoreResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let fragment = fragment_by_id_in_conn(&tx, &id, true)?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
        if let Some(asset_id) = fragment.asset_id.as_deref() {
            tx.execute(
                "DELETE FROM fragments WHERE asset_id = ?1",
                params![asset_id],
            )?;
            enqueue_asset_cleanup_and_delete(&tx, asset_id)?;
        } else {
            tx.execute("DELETE FROM fragments WHERE id = ?1", params![&id])?;
            enqueue_fragment_cleanup(&tx, &fragment)?;
        }
        tx.commit()?;
        drop(conn);
        self.retry_cleanup_best_effort();
        Ok(())
    }

    pub fn delete_fragment_everywhere_with_policy(
        &self,
        id: String,
        retention_days: Option<u32>,
    ) -> CoreResult<()> {
        match retention_days {
            Some(days) if days > 0 => self.trash_fragment_everywhere(id, days),
            _ => self.delete_fragment_everywhere(id),
        }
    }

    fn trash_fragment_everywhere(&self, id: String, retention_days: u32) -> CoreResult<()> {
        let now = Utc::now();
        let deleted_at = now.to_rfc3339();
        let delete_after = (now + Duration::days(i64::from(retention_days))).to_rfc3339();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let fragment = fragment_by_id_in_conn(&tx, &id, true)?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
        let changed = if let Some(asset_id) = fragment.asset_id.as_deref() {
            tx.execute(
                "
                UPDATE fragments
                SET deleted_at = ?1, delete_after = ?2, updated_at = ?1
                WHERE asset_id = ?3 AND deleted_at IS NULL
                ",
                params![&deleted_at, &delete_after, asset_id],
            )?
        } else {
            tx.execute(
                "
                UPDATE fragments
                SET deleted_at = ?1, delete_after = ?2, updated_at = ?1
                WHERE id = ?3 AND deleted_at IS NULL
                ",
                params![&deleted_at, &delete_after, &id],
            )?
        };
        if changed == 0 {
            return Err(CoreError::NotFound("Active Fragment".to_string()));
        }
        tx.commit()?;
        Ok(())
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
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let fragment = fragment_by_id_in_conn(&tx, &id, true)?
            .ok_or_else(|| CoreError::NotFound("Fragment".to_string()))?;
        tx.execute("DELETE FROM fragments WHERE id = ?1", params![&id])?;
        if let Some(asset_id) = fragment.asset_id.as_deref() {
            enqueue_orphan_asset_cleanup(&tx, asset_id)?;
        } else {
            enqueue_fragment_cleanup(&tx, &fragment)?;
        }
        tx.commit()?;
        drop(conn);
        self.retry_cleanup_best_effort();
        Ok(())
    }

    pub fn purge_expired_trash(&self) -> CoreResult<PurgeReport> {
        let (fragments, fragment_assets) = self.purge_expired_fragments()?;
        let (frames, frame_assets) = self.purge_expired_frames()?;
        let cleanup = self.retry_pending_file_cleanup()?;
        Ok(PurgeReport {
            fragments,
            frames,
            assets: fragment_assets.saturating_add(frame_assets),
            cleanup,
        })
    }

    pub fn retry_pending_file_cleanup(&self) -> CoreResult<FileCleanupReport> {
        let paths = {
            let conn = self.conn()?;
            let mut stmt = conn.prepare(
                "SELECT relative_path FROM pending_file_deletions ORDER BY created_at ASC",
            )?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        let mut report = FileCleanupReport::default();
        for relative_path in paths {
            let deletion = self
                .paths()
                .resolve_relative_path(&relative_path)
                .and_then(|path| match fs::remove_file(path) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error.into()),
                });
            let conn = self.conn()?;
            match deletion {
                Ok(()) => {
                    conn.execute(
                        "DELETE FROM pending_file_deletions WHERE relative_path = ?1",
                        params![&relative_path],
                    )?;
                    report.removed = report.removed.saturating_add(1);
                }
                Err(error) => {
                    let now = Utc::now().to_rfc3339();
                    conn.execute(
                        "
                        UPDATE pending_file_deletions
                        SET attempts = attempts + 1, last_error = ?1, updated_at = ?2
                        WHERE relative_path = ?3
                        ",
                        params![error.to_string(), now, &relative_path],
                    )?;
                    report.deferred = report.deferred.saturating_add(1);
                }
            }
        }
        Ok(report)
    }

    pub(crate) fn retry_cleanup_best_effort(&self) {
        if let Err(error) = self.retry_pending_file_cleanup() {
            tracing::warn!(%error, "Fragment file cleanup was deferred");
        }
    }

    fn purge_expired_fragments(&self) -> CoreResult<(u64, u64)> {
        let now = Utc::now().to_rfc3339();
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let expired = {
            let mut stmt = tx.prepare(
                "
                SELECT id, asset_id
                FROM fragments
                WHERE deleted_at IS NOT NULL AND delete_after IS NOT NULL AND delete_after <= ?1
                ",
            )?;
            let rows = stmt
                .query_map(params![&now], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        let mut removed_assets = 0_u64;
        for (fragment_id, asset_id) in &expired {
            let legacy_fragment = if asset_id.is_none() {
                fragment_by_id_in_conn(&tx, fragment_id, true)?
            } else {
                None
            };
            tx.execute("DELETE FROM fragments WHERE id = ?1", params![fragment_id])?;
            if let Some(asset_id) = asset_id.as_deref() {
                if enqueue_orphan_asset_cleanup(&tx, asset_id)? {
                    removed_assets = removed_assets.saturating_add(1);
                }
            } else if let Some(fragment) = legacy_fragment.as_ref() {
                enqueue_fragment_cleanup(&tx, fragment)?;
            }
        }
        tx.commit()?;
        Ok((usize_to_u64(expired.len()), removed_assets))
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
            false,
        )
    }

    pub fn import_image_outcome(
        &self,
        frame_id: Option<String>,
        file_path: String,
        title_override: Option<String>,
    ) -> CoreResult<ImportOutcome> {
        let frame_id = self.resolve_frame_id(frame_id)?;
        let safe_path = safe_existing_file(Path::new(&file_path))?;
        let bytes = fs::read(&safe_path)?;
        let format = image::guess_format(&bytes)?;
        let fallback_title = file_title(&safe_path);
        let title = title_override
            .as_ref()
            .and_then(|value| {
                let trimmed = value.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            })
            .or(fallback_title);

        let result = self.insert_fragments_from_asset(
            &[frame_id],
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
            &[],
            true,
        )?;
        if let Some(fragment) = result.fragments.into_iter().next() {
            return Ok(if result.reused_existing_asset {
                ImportOutcome::Linked(fragment)
            } else {
                ImportOutcome::New(fragment)
            });
        }
        if let Some((existing_fragment_id, trashed)) = result.duplicates.into_iter().next() {
            return Ok(ImportOutcome::SkippedDuplicate {
                existing_fragment_id,
                trashed,
            });
        }
        Err(CoreError::InvalidInput(
            "Fragment import produced no outcome".to_string(),
        ))
    }

    pub(crate) fn insert_fragment_from_asset(
        &self,
        frame_id: &str,
        asset: NewFragmentAsset,
        allow_existing_asset_reuse: bool,
    ) -> CoreResult<Fragment> {
        let result = self.insert_fragments_from_asset(
            &[frame_id.to_string()],
            asset,
            &[],
            allow_existing_asset_reuse,
        )?;
        if let Some(fragment) = result.fragments.into_iter().next() {
            return Ok(fragment);
        }
        if let Some((fragment_id, trashed)) = result.duplicates.into_iter().next() {
            return Err(CoreError::DuplicateMembership {
                frame_id: frame_id.to_string(),
                fragment_id,
                trashed,
            });
        }
        Err(CoreError::InvalidInput(
            "Fragment membership was not created".to_string(),
        ))
    }

    pub(crate) fn insert_fragments_from_asset(
        &self,
        frame_ids: &[String],
        asset: NewFragmentAsset,
        tags: &[String],
        allow_existing_asset_reuse: bool,
    ) -> CoreResult<MembershipBatchResult> {
        if frame_ids.is_empty() {
            return Err(CoreError::InvalidInput(
                "at least one destination Frame is required".to_string(),
            ));
        }

        let sha256 = sha256_hex(&asset.bytes);
        let image = decode_image(&asset.bytes)?;
        let (width, height) = dimensions(&image);
        let existing_asset = {
            let conn = self.conn()?;
            asset_by_sha_in_conn(&conn, &sha256)?
        };
        let staged_asset = if existing_asset.is_none() {
            Some(self.prepare_asset_files(&asset, &sha256, &image, width, height)?)
        } else {
            None
        };

        let transaction_result = (|| -> CoreResult<(MembershipBatchResult, bool)> {
            let mut conn = self.conn()?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            for frame_id in frame_ids {
                let active: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM frames WHERE id = ?1 AND deleted_at IS NULL)",
                    params![frame_id],
                    |row| row.get(0),
                )?;
                if !active {
                    return Err(CoreError::NotFound("Frame".to_string()));
                }
            }

            let (stored_asset, reused_existing_asset) = match asset_by_sha_in_conn(&tx, &sha256)? {
                Some(existing) => (existing, true),
                None => {
                    let prepared = staged_asset.as_ref().ok_or_else(|| {
                        CoreError::InvalidInput("asset staging was not available".to_string())
                    })?;
                    insert_asset_record(&tx, prepared)?;
                    (prepared.clone(), false)
                }
            };
            let inserted_staged_asset = staged_asset
                .as_ref()
                .is_some_and(|prepared| prepared.id == stored_asset.id);

            let mut fragments = Vec::with_capacity(frame_ids.len());
            let mut duplicates = Vec::new();
            for frame_id in frame_ids {
                if let Some((fragment_id, trashed)) =
                    membership_by_asset_in_conn(&tx, frame_id, &stored_asset.id)?
                {
                    duplicates.push((fragment_id, trashed));
                    continue;
                }

                if reused_existing_asset && !allow_existing_asset_reuse {
                    let (fragment_id, existing_frame_id, trashed) = tx.query_row(
                        "SELECT id, frame_id, deleted_at IS NOT NULL
                         FROM fragments
                         WHERE asset_id = ?1
                         ORDER BY (deleted_at IS NULL) DESC, captured_at ASC
                         LIMIT 1",
                        params![&stored_asset.id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )?;
                    return Err(CoreError::ExistingAsset {
                        frame_id: existing_frame_id,
                        fragment_id,
                        trashed,
                    });
                }

                let fragment = fragment_from_asset(frame_id, &asset, &stored_asset);
                insert_fragment_record(&tx, &fragment).map_err(|error| {
                    map_membership_insert_error(&tx, frame_id, &stored_asset.id, error)
                })?;
                insert_tags_in_conn(&tx, &fragment.id, tags)?;
                fragments.push(fragment);
            }
            tx.commit()?;
            Ok((
                MembershipBatchResult {
                    fragments,
                    duplicates,
                    reused_existing_asset,
                },
                inserted_staged_asset,
            ))
        })();

        match transaction_result {
            Ok((result, inserted_staged_asset)) => {
                if !inserted_staged_asset {
                    if let Some(staged_asset) = staged_asset.as_ref() {
                        self.remove_uncommitted_asset_files(staged_asset);
                    }
                }
                Ok(result)
            }
            Err(error) => {
                if let Some(staged_asset) = staged_asset.as_ref() {
                    self.remove_uncommitted_asset_files(staged_asset);
                }
                Err(error)
            }
        }
    }

    pub fn add_existing_fragment_to_frame(
        &self,
        existing_fragment_id: String,
        frame_id: Option<String>,
    ) -> CoreResult<Fragment> {
        let frame_id = self.resolve_frame_id(frame_id)?;
        let existing = self.get_fragment_including_deleted(existing_fragment_id.clone())?;
        let asset_id = existing
            .asset_id
            .clone()
            .ok_or_else(|| CoreError::NotFound("Fragment asset".to_string()))?;
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        if let Some((fragment_id, trashed)) =
            membership_by_asset_in_conn(&tx, &frame_id, &asset_id)?
        {
            return Err(CoreError::DuplicateMembership {
                frame_id,
                fragment_id,
                trashed,
            });
        }

        let now = Utc::now().to_rfc3339();
        let fragment = Fragment {
            id: Uuid::new_v4().to_string(),
            frame_id,
            captured_at: now.clone(),
            created_at: now.clone(),
            updated_at: now,
            deleted_at: None,
            delete_after: None,
            ..existing
        };
        insert_fragment_record(&tx, &fragment).map_err(|error| {
            map_membership_insert_error(&tx, &fragment.frame_id, &asset_id, error)
        })?;
        tx.execute(
            "INSERT OR IGNORE INTO fragment_tags (fragment_id, tag_id)
             SELECT ?1, tag_id FROM fragment_tags WHERE fragment_id = ?2",
            params![&fragment.id, &existing_fragment_id],
        )?;
        tx.commit()?;
        Ok(fragment)
    }

    fn resolve_frame_id(&self, frame_id: Option<String>) -> CoreResult<String> {
        let frame_id = match frame_id {
            Some(id) if !id.trim().is_empty() => id,
            _ => self.default_frame_id()?,
        };
        self.require_frame(&frame_id)?;
        Ok(frame_id)
    }

    fn prepare_asset_files(
        &self,
        asset: &NewFragmentAsset,
        sha256: &str,
        image: &image::DynamicImage,
        width: i64,
        height: i64,
    ) -> CoreResult<StoredAsset> {
        let now = Utc::now();
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

        Ok(StoredAsset {
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
        })
    }

    fn remove_uncommitted_asset_files(&self, asset: &StoredAsset) {
        for relative_path in asset_paths(asset) {
            let deletion = self
                .paths()
                .resolve_relative_path(relative_path)
                .and_then(|path| match fs::remove_file(path) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error.into()),
                });
            if let Err(error) = deletion {
                tracing::warn!(%error, path = relative_path, "uncommitted asset cleanup was deferred");
                if let Ok(conn) = self.conn() {
                    let _ = enqueue_cleanup_paths(&conn, [relative_path]);
                }
            }
        }
    }
}

fn asset_by_sha_in_conn(connection: &Connection, sha256: &str) -> CoreResult<Option<StoredAsset>> {
    Ok(connection
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
        .optional()?)
}

fn asset_by_id_in_conn(connection: &Connection, asset_id: &str) -> CoreResult<Option<StoredAsset>> {
    Ok(connection
        .query_row(
            "
            SELECT id, original_path, thumbnail_path, preview_path, mime_type,
                   width, height, file_size, sha256, perceptual_hash
            FROM assets
            WHERE id = ?1
            ",
            params![asset_id],
            map_stored_asset,
        )
        .optional()?)
}

fn insert_asset_record(connection: &Connection, asset: &StoredAsset) -> CoreResult<()> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO assets (
          id, original_path, thumbnail_path, preview_path, mime_type, width, height,
          file_size, sha256, perceptual_hash, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![
            &asset.id,
            &asset.original_path,
            &asset.thumbnail_path,
            &asset.preview_path,
            &asset.mime_type,
            &asset.width,
            &asset.height,
            &asset.file_size,
            &asset.sha256,
            &asset.perceptual_hash,
            now
        ],
    )?;
    Ok(())
}

fn fragment_from_asset(
    frame_id: &str,
    asset: &NewFragmentAsset,
    stored_asset: &StoredAsset,
) -> Fragment {
    let now = Utc::now().to_rfc3339();
    Fragment {
        id: Uuid::new_v4().to_string(),
        asset_id: Some(stored_asset.id.clone()),
        frame_id: frame_id.to_string(),
        title: asset.title.clone(),
        description: None,
        note: asset.note.clone(),
        source_url: asset.source_url.clone(),
        page_url: asset.page_url.clone(),
        site_name: asset.site_name.clone(),
        creator_name: asset.creator_name.clone(),
        original_path: stored_asset.original_path.clone(),
        thumbnail_path: stored_asset.thumbnail_path.clone(),
        preview_path: stored_asset.preview_path.clone(),
        mime_type: stored_asset.mime_type.clone(),
        width: stored_asset.width,
        height: stored_asset.height,
        file_size: stored_asset.file_size,
        sha256: stored_asset.sha256.clone(),
        perceptual_hash: stored_asset.perceptual_hash.clone(),
        captured_from: asset.captured_from.clone(),
        captured_at: now.clone(),
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
        delete_after: None,
    }
}

fn insert_fragment_record(connection: &Connection, fragment: &Fragment) -> rusqlite::Result<()> {
    connection.execute(
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
    Ok(())
}

fn insert_tags_in_conn(
    connection: &Connection,
    fragment_id: &str,
    tags: &[String],
) -> CoreResult<()> {
    for tag in tags
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
    {
        let tag_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![tag_id, tag, now],
        )?;
        let existing_id: String =
            connection.query_row("SELECT id FROM tags WHERE name = ?1", params![tag], |row| {
                row.get(0)
            })?;
        connection.execute(
            "INSERT OR IGNORE INTO fragment_tags (fragment_id, tag_id) VALUES (?1, ?2)",
            params![fragment_id, existing_id],
        )?;
    }
    Ok(())
}

fn normalize_tags(tags: Vec<String>) -> CoreResult<Vec<String>> {
    const MAX_TAGS: usize = 32;
    const MAX_TAG_LENGTH: usize = 64;
    let mut normalized = Vec::with_capacity(tags.len().min(MAX_TAGS));
    let mut seen = std::collections::BTreeSet::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > MAX_TAG_LENGTH {
            return Err(CoreError::InvalidInput(format!(
                "tag names must be {MAX_TAG_LENGTH} characters or fewer"
            )));
        }
        let comparison_key = tag.to_lowercase();
        if seen.insert(comparison_key) {
            normalized.push(tag.to_string());
        }
    }
    if normalized.len() > MAX_TAGS {
        return Err(CoreError::InvalidInput(format!(
            "a Fragment can have at most {MAX_TAGS} tags"
        )));
    }
    Ok(normalized)
}

fn membership_by_asset_in_conn(
    connection: &Connection,
    frame_id: &str,
    asset_id: &str,
) -> CoreResult<Option<(String, bool)>> {
    Ok(connection
        .query_row(
            "
            SELECT id, deleted_at IS NOT NULL
            FROM fragments
            WHERE frame_id = ?1 AND asset_id = ?2
            LIMIT 1
            ",
            params![frame_id, asset_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
        )
        .optional()?)
}

fn map_membership_insert_error(
    connection: &Connection,
    frame_id: &str,
    asset_id: &str,
    error: rusqlite::Error,
) -> CoreError {
    match membership_by_asset_in_conn(connection, frame_id, asset_id) {
        Ok(Some((fragment_id, trashed))) => CoreError::DuplicateMembership {
            frame_id: frame_id.to_string(),
            fragment_id,
            trashed,
        },
        _ => CoreError::Database(error),
    }
}

fn fragment_by_id_in_conn(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> CoreResult<Option<Fragment>> {
    let sql = if include_deleted {
        fragment_select_sql("WHERE fragments.id = ?1")
    } else {
        fragment_select_sql("WHERE fragments.id = ?1 AND fragments.deleted_at IS NULL")
    };
    Ok(connection
        .query_row(&sql, params![id], map_fragment)
        .optional()?)
}

pub(crate) fn enqueue_orphan_asset_cleanup(
    connection: &Connection,
    asset_id: &str,
) -> CoreResult<bool> {
    let remaining: i64 = connection.query_row(
        "SELECT count(*) FROM fragments WHERE asset_id = ?1",
        params![asset_id],
        |row| row.get(0),
    )?;
    if remaining > 0 {
        return Ok(false);
    }
    enqueue_asset_cleanup_and_delete(connection, asset_id)?;
    Ok(true)
}

fn enqueue_asset_cleanup_and_delete(connection: &Connection, asset_id: &str) -> CoreResult<()> {
    if let Some(asset) = asset_by_id_in_conn(connection, asset_id)? {
        enqueue_cleanup_paths(connection, asset_paths(&asset))?;
        connection.execute("DELETE FROM assets WHERE id = ?1", params![asset_id])?;
    }
    Ok(())
}

fn enqueue_fragment_cleanup(connection: &Connection, fragment: &Fragment) -> CoreResult<()> {
    enqueue_cleanup_paths(
        connection,
        [
            fragment.original_path.as_str(),
            fragment.thumbnail_path.as_str(),
            fragment.preview_path.as_deref().unwrap_or_default(),
        ],
    )
}

fn enqueue_cleanup_paths<'a, I>(connection: &Connection, paths: I) -> CoreResult<()>
where
    I: IntoIterator<Item = &'a str>,
{
    let now = Utc::now().to_rfc3339();
    for relative_path in paths.into_iter().filter(|path| !path.is_empty()) {
        connection.execute(
            "
            INSERT OR IGNORE INTO pending_file_deletions (
              relative_path, created_at, updated_at, attempts, last_error
            ) VALUES (?1, ?2, ?2, 0, NULL)
            ",
            params![relative_path, &now],
        )?;
    }
    Ok(())
}

fn asset_paths(asset: &StoredAsset) -> impl Iterator<Item = &str> {
    [
        Some(asset.original_path.as_str()),
        Some(asset.thumbnail_path.as_str()),
        asset.preview_path.as_deref(),
    ]
    .into_iter()
    .flatten()
}

pub(crate) fn usize_to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
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
    use rusqlite::params;
    use tempfile::tempdir;

    use crate::{CoreError, FragmentCore, FragmentFilter, ImportOutcome};

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
    fn fragment_tags_are_replaced_normalized_and_orphans_are_cleaned_up() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");

        let tags = core
            .set_fragment_tags(
                fragment.id.clone(),
                vec![
                    " Interface ".to_string(),
                    "interface".to_string(),
                    "Reference".to_string(),
                ],
            )
            .expect("set tags");
        assert_eq!(tags, vec!["Interface", "Reference"]);
        assert_eq!(core.list_tags().expect("list tags"), tags);

        let replaced = core
            .set_fragment_tags(fragment.id.clone(), vec!["Archive".to_string()])
            .expect("replace tags");
        assert_eq!(replaced, vec!["Archive"]);
        assert_eq!(
            core.fragment_tags(&fragment.id).expect("fragment tags"),
            replaced
        );
        assert_eq!(core.list_tags().expect("list tags"), replaced);
    }

    #[test]
    fn filtered_pages_use_metadata_tags_and_dimensions_before_pagination() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        core.set_fragment_tags(
            fragment.id.clone(),
            vec!["Editorial".to_string(), "Warm".to_string()],
        )
        .expect("tags");
        {
            let conn = core.conn().expect("conn");
            conn.execute(
                "UPDATE fragments
                 SET title = 'Museum identity', note = 'Typography study',
                     source_url = 'https://example.com/work/identity',
                     site_name = 'Example Studio', creator_name = 'Ada'
                 WHERE id = ?1",
                params![&fragment.id],
            )
            .expect("metadata");
        }

        let filter = FragmentFilter {
            tags: vec!["editorial".to_string()],
            mime_types: vec!["image/png".to_string()],
            source_domain: Some("example.com".to_string()),
            source_kind: Some("source".to_string()),
            min_width: Some(1),
            orientation: Some("landscape".to_string()),
            has_notes: Some(true),
            title_contains: Some("museum".to_string()),
            creator_contains: Some("ada".to_string()),
            ..FragmentFilter::default()
        };
        let (items, total) = core
            .list_fragment_page_filtered(None, false, false, filter.clone(), None, 0, 60)
            .expect("filtered page");
        assert_eq!(total, 1);
        assert_eq!(items[0].id, fragment.id);
        assert_eq!(
            core.list_fragment_ids_filtered(None, false, false, filter, None)
                .expect("ids"),
            vec![fragment.id]
        );
    }

    #[test]
    fn duplicate_image_requires_a_decision_before_reusing_the_asset() {
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
        let duplicate = core
            .import_image(
                Some(frame.id.clone()),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect_err("duplicate decision");
        assert!(matches!(
            duplicate,
            CoreError::ExistingAsset { fragment_id, .. } if fragment_id == first.id
        ));

        let second = core
            .add_existing_fragment_to_frame(first.id.clone(), Some(frame.id))
            .expect("add existing membership");

        assert_ne!(first.id, second.id);
        assert_eq!(first.asset_id, second.asset_id);
        assert_eq!(first.original_path, second.original_path);
        assert_eq!(
            core.fragment_membership_count(first.id)
                .expect("membership count"),
            2
        );
    }

    #[test]
    fn import_outcome_links_cross_frame_duplicate_without_error() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let target = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");

        let linked = match core
            .import_image_outcome(
                Some(target.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("link outcome")
        {
            ImportOutcome::Linked(fragment) => fragment,
            outcome => panic!("expected linked outcome, got {outcome:?}"),
        };

        assert_ne!(first.id, linked.id);
        assert_eq!(first.asset_id, linked.asset_id);
        let conn = core.conn().expect("conn");
        let assets: i64 = conn
            .query_row("SELECT count(*) FROM assets", [], |row| row.get(0))
            .expect("asset count");
        assert_eq!(assets, 1);
    }

    #[test]
    fn import_outcome_skips_same_frame_duplicate() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");

        let outcome = core
            .import_image_outcome(None, source_path.to_string_lossy().to_string(), None)
            .expect("skip outcome");

        assert_eq!(
            outcome,
            ImportOutcome::SkippedDuplicate {
                existing_fragment_id: first.id,
                trashed: false,
            }
        );
        assert_eq!(core.list_all_fragments().expect("fragments").len(), 1);
    }

    #[test]
    fn import_outcome_skip_reports_trashed_membership() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");
        core.delete_fragment_with_policy(first.id.clone(), Some(7))
            .expect("trash");

        let outcome = core
            .import_image_outcome(None, source_path.to_string_lossy().to_string(), None)
            .expect("skip outcome");

        assert_eq!(
            outcome,
            ImportOutcome::SkippedDuplicate {
                existing_fragment_id: first.id,
                trashed: true,
            }
        );
    }

    #[test]
    fn hard_delete_of_linked_membership_preserves_shared_asset_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let target = core
            .create_frame(None, "References".to_string())
            .expect("create frame");
        let first = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");
        let linked = match core
            .import_image_outcome(
                Some(target.id),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("link outcome")
        {
            ImportOutcome::Linked(fragment) => fragment,
            outcome => panic!("expected linked outcome, got {outcome:?}"),
        };
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

        core.delete_fragment_with_policy(linked.id, Some(0))
            .expect("hard delete linked membership");

        assert!(core.get_fragment(first.id).is_ok());
        for path in paths {
            assert!(path.exists(), "{} should remain", path.display());
        }
    }

    #[test]
    fn same_frame_duplicate_is_rejected_even_with_a_renamed_title() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        core.import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("first import");

        let error = core
            .import_image(
                None,
                source_path.to_string_lossy().to_string(),
                Some("Renamed duplicate".to_string()),
            )
            .expect_err("same Frame membership must be unique");

        assert!(matches!(
            error,
            CoreError::DuplicateMembership { trashed: false, .. }
        ));
        assert_eq!(core.list_all_fragments().expect("fragments").len(), 1);
        let conn = core.conn().expect("conn");
        let assets: i64 = conn
            .query_row("SELECT count(*) FROM assets", [], |row| row.get(0))
            .expect("asset count");
        assert_eq!(assets, 1);
    }

    #[test]
    fn trashed_membership_blocks_reimport_and_can_be_restored() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        core.delete_fragment_with_policy(fragment.id.clone(), Some(7))
            .expect("trash");

        let error = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect_err("trashed membership blocks reimport");
        assert!(matches!(
            error,
            CoreError::DuplicateMembership { trashed: true, .. }
        ));

        let restored = core.restore_fragment(fragment.id).expect("restore");
        assert!(restored.deleted_at.is_none());
        assert_eq!(core.list_all_fragments().expect("active").len(), 1);
    }

    #[test]
    fn restore_reports_a_membership_conflict_in_a_legacy_corrupt_database() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        core.delete_fragment_with_policy(fragment.id.clone(), Some(7))
            .expect("trash");
        {
            let conn = core.conn().expect("conn");
            conn.execute_batch("DROP INDEX ux_fragments_frame_asset")
                .expect("drop invariant for corruption fixture");
            conn.execute(
                "
                INSERT INTO fragments (
                  id, asset_id, frame_id, title, original_path, thumbnail_path, preview_path,
                  mime_type, width, height, file_size, sha256, captured_from, captured_at,
                  created_at, updated_at, deleted_at, delete_after
                )
                SELECT
                  'active-conflict', asset_id, frame_id, 'Conflict', original_path,
                  thumbnail_path, preview_path, mime_type, width, height, file_size, sha256,
                  captured_from, captured_at, created_at, updated_at, NULL, NULL
                FROM fragments WHERE id = ?1
                ",
                params![&fragment.id],
            )
            .expect("insert corrupt duplicate");
        }

        let error = core
            .restore_fragment(fragment.id)
            .expect_err("restore conflict");
        assert!(matches!(error, CoreError::RestoreConflict { .. }));
    }

    #[test]
    fn concurrent_same_frame_imports_create_one_membership_and_one_asset() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let vault = temp.path().join("vault");
        let first_core = FragmentCore::new_at(vault.clone()).expect("first core");
        let second_core = FragmentCore::new_at(vault).expect("second core");
        let barrier = Arc::new(Barrier::new(2));
        let source = source_path.to_string_lossy().to_string();

        let first = {
            let barrier = Arc::clone(&barrier);
            let source = source.clone();
            thread::spawn(move || {
                barrier.wait();
                first_core.import_image(None, source, None)
            })
        };
        let second = {
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                second_core.import_image(None, source, None)
            })
        };

        let results = [
            first.join().expect("first join"),
            second.join().expect("second join"),
        ];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(CoreError::DuplicateMembership { .. })))
                .count(),
            1
        );

        let core = FragmentCore::new_at(temp.path().join("vault")).expect("verify core");
        assert_eq!(core.list_all_fragments().expect("fragments").len(), 1);
        let conn = core.conn().expect("conn");
        let assets: i64 = conn
            .query_row("SELECT count(*) FROM assets", [], |row| row.get(0))
            .expect("asset count");
        assert_eq!(assets, 1);
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
            .add_existing_fragment_to_frame(first.id.clone(), Some(frame.id))
            .expect("second membership");
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
    fn retention_purge_removes_expired_fragment_and_asset_files() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        let original = core
            .paths()
            .resolve_relative_path(&fragment.original_path)
            .expect("original");
        core.delete_fragment_with_policy(fragment.id.clone(), Some(7))
            .expect("trash");
        {
            let conn = core.conn().expect("conn");
            conn.execute(
                "UPDATE fragments SET delete_after = '2000-01-01T00:00:00Z' WHERE id = ?1",
                params![&fragment.id],
            )
            .expect("expire fragment");
        }

        let report = core.purge_expired_trash().expect("purge");
        assert_eq!(report.fragments, 1);
        assert_eq!(report.assets, 1);
        assert!(!original.exists());
        assert!(core.list_trashed_fragments().expect("trash").is_empty());
    }

    #[test]
    fn multi_frame_batch_is_atomic_when_any_destination_is_invalid() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let frame = core
            .create_frame(None, "References".to_string())
            .expect("frame");
        let result = core.insert_fragments_from_asset(
            &[frame.id.clone(), "missing-frame".to_string()],
            super::NewFragmentAsset {
                bytes: sample_png_bytes(),
                format: ImageFormat::Png,
                title: Some("Atomic".to_string()),
                note: None,
                source_url: None,
                page_url: None,
                site_name: None,
                creator_name: None,
                captured_from: Some("test".to_string()),
            },
            &["atomic".to_string()],
            true,
        );

        assert!(matches!(result, Err(CoreError::NotFound(_))));
        assert!(core.list_fragments(frame.id).expect("fragments").is_empty());
        let conn = core.conn().expect("conn");
        let assets: i64 = conn
            .query_row("SELECT count(*) FROM assets", [], |row| row.get(0))
            .expect("assets");
        assert_eq!(assets, 0);
    }

    #[test]
    fn failed_file_cleanup_is_recorded_and_retryable() {
        let temp = tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let blocked = core.paths().temp_dir().join("blocked-cleanup");
        std::fs::create_dir_all(&blocked).expect("blocked directory");
        {
            let conn = core.conn().expect("conn");
            conn.execute(
                "
                INSERT INTO pending_file_deletions (
                  relative_path, created_at, updated_at, attempts, last_error
                ) VALUES ('temp/blocked-cleanup', '2026-06-24T00:00:00Z',
                          '2026-06-24T00:00:00Z', 0, NULL)
                ",
                [],
            )
            .expect("queue cleanup");
        }

        let deferred = core.retry_pending_file_cleanup().expect("first retry");
        assert_eq!(deferred.deferred, 1);
        std::fs::remove_dir(&blocked).expect("remove blocker");

        let recovered = core.retry_pending_file_cleanup().expect("second retry");
        assert_eq!(recovered.removed, 1);
        let conn = core.conn().expect("conn");
        let pending: i64 = conn
            .query_row("SELECT count(*) FROM pending_file_deletions", [], |row| {
                row.get(0)
            })
            .expect("pending count");
        assert_eq!(pending, 0);
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
            .add_existing_fragment_to_frame(first.id.clone(), Some(frame.id))
            .expect("second membership");
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

    #[test]
    fn trash_everywhere_preserves_one_shared_asset_until_retention_purge() {
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
        core.add_existing_fragment_to_frame(first.id.clone(), Some(frame.id))
            .expect("second membership");
        let original = core
            .paths()
            .resolve_relative_path(&first.original_path)
            .expect("resolve original");

        core.delete_fragment_everywhere_with_policy(first.id, Some(31))
            .expect("trash everywhere");

        assert!(core.list_all_fragments().expect("active").is_empty());
        assert_eq!(core.list_trashed_fragments().expect("trash").len(), 2);
        assert!(original.exists());
    }

    #[test]
    fn fragment_pages_return_bounded_items_and_complete_counts() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let mut imported: Vec<crate::Fragment> = Vec::new();

        for index in 0..3 {
            let frame = core
                .create_frame(None, format!("Page {index}"))
                .expect("create frame");
            let fragment = if let Some(first) = imported.first() {
                core.add_existing_fragment_to_frame(first.id.clone(), Some(frame.id))
                    .expect("add membership")
            } else {
                core.import_image(
                    Some(frame.id),
                    source_path.to_string_lossy().to_string(),
                    None,
                )
                .expect("import asset")
            };
            imported.push(fragment);
        }

        let (page, total) = core
            .list_fragment_page(None, false, 1, 1)
            .expect("active page");
        assert_eq!(page.len(), 1);
        assert_eq!(total, 3);

        core.delete_fragment_with_policy(imported[0].id.clone(), Some(7))
            .expect("trash membership");
        let (trash_page, trash_total) = core
            .list_fragment_page(None, true, 0, 10)
            .expect("trash page");
        assert_eq!(trash_page.len(), 1);
        assert_eq!(trash_total, 1);

        let counts = core
            .active_fragment_counts_by_frame()
            .expect("frame counts");
        assert_eq!(counts.values().sum::<u64>(), 2);
    }

    #[test]
    fn recursive_frame_scope_includes_descendant_memberships_only_when_requested() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let parent = core
            .create_frame(None, "Parent".to_string())
            .expect("create parent");
        let child = core
            .create_frame(Some(parent.id.clone()), "Child".to_string())
            .expect("create child");
        let unrelated = core
            .create_frame(None, "Unrelated".to_string())
            .expect("create unrelated");
        let parent_fragment = core
            .import_image(
                Some(parent.id.clone()),
                source_path.to_string_lossy().to_string(),
                None,
            )
            .expect("import parent membership");
        let child_fragment = core
            .add_existing_fragment_to_frame(parent_fragment.id.clone(), Some(child.id))
            .expect("add child membership");
        core.add_existing_fragment_to_frame(parent_fragment.id.clone(), Some(unrelated.id))
            .expect("add unrelated membership");

        let (direct, direct_total) = core
            .list_fragment_page_scoped(Some(parent.id.clone()), false, false, 0, 10)
            .expect("direct page");
        assert_eq!(direct_total, 1);
        assert_eq!(direct[0].id, parent_fragment.id);

        let (recursive, recursive_total) = core
            .list_fragment_page_scoped(Some(parent.id.clone()), true, false, 0, 10)
            .expect("recursive page");
        assert_eq!(recursive_total, 2);
        assert!(recursive
            .iter()
            .any(|fragment| fragment.id == child_fragment.id));

        let recursive_ids = core
            .list_fragment_ids_scoped(Some(parent.id), true, false, None, None)
            .expect("recursive ids");
        assert_eq!(recursive_ids.len(), 2);
    }

    #[test]
    fn fragment_id_query_matches_filters_without_loading_fragment_rows() {
        let temp = tempdir().expect("tempdir");
        let source_path = temp.path().join("source.png");
        std::fs::write(&source_path, sample_png_bytes()).expect("write source");
        let core = FragmentCore::new_at(temp.path().join("vault")).expect("core");
        let fragment = core
            .import_image(None, source_path.to_string_lossy().to_string(), None)
            .expect("import");
        core.update_fragment(
            fragment.id.clone(),
            Some("Calm Business Reference".to_string()),
            None,
        )
        .expect("rename fragment");

        assert_eq!(
            core.list_fragment_ids(
                None,
                false,
                Some("business".to_string()),
                Some("png".to_string()),
            )
            .expect("matching ids"),
            vec![fragment.id.clone()]
        );
        assert!(core
            .list_fragment_ids(None, false, None, Some("source".to_string()))
            .expect("source ids")
            .is_empty());

        core.delete_fragment_with_policy(fragment.id.clone(), Some(31))
            .expect("trash fragment");
        assert_eq!(
            core.list_fragment_ids(None, true, None, Some("all".to_string()))
                .expect("trash ids"),
            vec![fragment.id]
        );
    }
}
