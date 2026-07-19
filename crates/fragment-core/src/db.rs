use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::Utc;
use reqwest::blocking::Client;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use uuid::Uuid;

use crate::app_paths::AppPaths;
use crate::errors::{CoreError, CoreResult};

const INIT_MIGRATION: &str = include_str!("../migrations/0001_init.sql");
const DATA_SAFETY_MIGRATION: &str = include_str!("../migrations/0002_data_safety.sql");
const LIBRARY_REVISION_MIGRATION: &str = include_str!("../migrations/0003_library_revision.sql");
const CURRENT_SCHEMA_VERSION: i64 = 3;

#[derive(Clone)]
pub struct FragmentCore {
    paths: AppPaths,
    connection: Arc<Mutex<Connection>>,
    http_client: Client,
}

impl FragmentCore {
    pub fn new() -> CoreResult<Self> {
        let paths = AppPaths::discover()?;
        Self::from_paths(paths)
    }

    pub fn new_at(root: PathBuf) -> CoreResult<Self> {
        let paths = AppPaths::from_root(root)?;
        Self::from_paths(paths)
    }

    pub fn from_paths(paths: AppPaths) -> CoreResult<Self> {
        let mut connection = Connection::open(paths.db_path())?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "busy_timeout", 5000_i64)?;
        connection.pragma_update(None, "cache_size", -12000_i64)?;
        run_migrations(&mut connection)?;

        let core = Self {
            paths,
            connection: Arc::new(Mutex::new(connection)),
            http_client: Client::builder().timeout(Duration::from_secs(20)).build()?,
        };
        core.ensure_default_frame()?;
        if let Err(error) = core.purge_expired_trash() {
            tracing::warn!(%error, "expired Fragment Trash could not be fully purged");
        }
        Ok(core)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn schema_version(&self) -> CoreResult<i64> {
        let conn = self.conn()?;
        Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn library_revision(&self) -> CoreResult<u64> {
        let conn = self.conn()?;
        let revision: i64 = conn.query_row(
            "SELECT revision FROM vault_metadata WHERE id = 1",
            [],
            |row| row.get(0),
        )?;
        u64::try_from(revision)
            .map_err(|_| CoreError::InvalidInput("Vault revision cannot be negative".to_string()))
    }

    pub(crate) fn conn(&self) -> CoreResult<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| CoreError::InvalidInput("database lock was poisoned".to_string()))
    }

    pub(crate) fn http_client(&self) -> &Client {
        &self.http_client
    }
}

fn run_migrations(connection: &mut Connection) -> CoreResult<()> {
    let mut version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchemaVersion {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    if version < 1 {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(INIT_MIGRATION)?;
        migrate_unversioned_schema(&tx)?;
        tx.pragma_update(None, "user_version", 1_i64)?;
        tx.commit()?;
        version = 1;
    }

    if version < 2 {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        migrate_data_safety_schema(&tx)?;
        tx.pragma_update(None, "user_version", 2_i64)?;
        tx.commit()?;
        version = 2;
    }

    if version < 3 {
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(LIBRARY_REVISION_MIGRATION)?;
        tx.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
        tx.commit()?;
    }

    Ok(())
}

fn migrate_unversioned_schema(connection: &Connection) -> CoreResult<()> {
    ensure_column(connection, "fragments", "asset_id", "TEXT")?;
    ensure_column(connection, "fragments", "deleted_at", "TEXT")?;
    ensure_column(connection, "fragments", "delete_after", "TEXT")?;
    connection.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_fragments_asset_id ON fragments(asset_id);
        CREATE INDEX IF NOT EXISTS idx_fragments_deleted_at ON fragments(deleted_at);

        INSERT OR IGNORE INTO assets (
          id, original_path, thumbnail_path, preview_path, mime_type, width, height, file_size,
          sha256, perceptual_hash, created_at, updated_at
        )
        SELECT
          COALESCE(NULLIF(sha256, ''), id),
          original_path,
          thumbnail_path,
          preview_path,
          mime_type,
          width,
          height,
          file_size,
          NULLIF(sha256, ''),
          perceptual_hash,
          created_at,
          updated_at
        FROM fragments
        WHERE asset_id IS NULL;

        UPDATE fragments
        SET asset_id = COALESCE(NULLIF(sha256, ''), id)
        WHERE asset_id IS NULL;
        ",
    )?;
    Ok(())
}

fn migrate_data_safety_schema(connection: &Connection) -> CoreResult<()> {
    ensure_column(
        connection,
        "frames",
        "is_system",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(connection, "frames", "deleted_at", "TEXT")?;
    ensure_column(connection, "frames", "delete_after", "TEXT")?;
    ensure_column(connection, "frames", "trash_group_id", "TEXT")?;

    ensure_cleanup_table(connection)?;
    connection.execute(
        "UPDATE assets SET sha256 = NULL WHERE trim(COALESCE(sha256, '')) = ''",
        [],
    )?;
    canonicalize_duplicate_assets(connection)?;
    canonicalize_duplicate_memberships(connection)?;
    ensure_system_frame(connection)?;
    connection.execute_batch(DATA_SAFETY_MIGRATION)?;
    Ok(())
}

fn ensure_cleanup_table(connection: &Connection) -> CoreResult<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS pending_file_deletions (
          relative_path TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        ",
    )?;
    Ok(())
}

fn canonicalize_duplicate_assets(connection: &Connection) -> CoreResult<()> {
    let duplicate_groups = {
        let mut stmt = connection.prepare(
            "
            SELECT sha256, MIN(id)
            FROM assets
            WHERE sha256 IS NOT NULL AND sha256 <> ''
            GROUP BY sha256
            HAVING count(*) > 1
            ",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    for (sha256, canonical_id) in duplicate_groups {
        let duplicate_assets = {
            let mut stmt = connection.prepare(
                "
                SELECT id, original_path, thumbnail_path, preview_path
                FROM assets
                WHERE sha256 = ?1 AND id <> ?2
                ",
            )?;
            let rows = stmt
                .query_map(params![&sha256, &canonical_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        for (duplicate_id, original, thumbnail, preview) in duplicate_assets {
            connection.execute(
                "UPDATE fragments SET asset_id = ?1 WHERE asset_id = ?2",
                params![&canonical_id, &duplicate_id],
            )?;
            enqueue_cleanup_paths(connection, [Some(original), Some(thumbnail), preview])?;
            connection.execute("DELETE FROM assets WHERE id = ?1", params![duplicate_id])?;
        }
    }
    Ok(())
}

fn canonicalize_duplicate_memberships(connection: &Connection) -> CoreResult<()> {
    let groups = {
        let mut stmt = connection.prepare(
            "
            SELECT frame_id, asset_id
            FROM fragments
            WHERE asset_id IS NOT NULL
            GROUP BY frame_id, asset_id
            HAVING count(*) > 1
            ",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    for (frame_id, asset_id) in groups {
        let ids = {
            let mut stmt = connection.prepare(
                "
                SELECT id
                FROM fragments
                WHERE frame_id = ?1 AND asset_id = ?2
                ORDER BY (deleted_at IS NULL) DESC, captured_at ASC, id ASC
                ",
            )?;
            let rows = stmt
                .query_map(params![&frame_id, &asset_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let Some((winner, duplicates)) = ids.split_first() else {
            continue;
        };
        for duplicate in duplicates {
            connection.execute(
                "
                INSERT OR IGNORE INTO fragment_tags (fragment_id, tag_id)
                SELECT ?1, tag_id FROM fragment_tags WHERE fragment_id = ?2
                ",
                params![winner, duplicate],
            )?;
            connection.execute("DELETE FROM fragments WHERE id = ?1", params![duplicate])?;
        }
    }
    Ok(())
}

fn ensure_system_frame(connection: &Connection) -> CoreResult<()> {
    let existing_system = connection
        .query_row(
            "SELECT id FROM frames WHERE is_system = 1 LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let system_id = match existing_system {
        Some(id) => id,
        None => {
            let candidate = connection
                .query_row(
                    "
                    SELECT id
                    FROM frames
                    ORDER BY (lower(name) = 'inbox') DESC, sort_order ASC, created_at ASC
                    LIMIT 1
                    ",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            match candidate {
                Some(id) => id,
                None => {
                    let id = Uuid::new_v4().to_string();
                    let now = Utc::now().to_rfc3339();
                    connection.execute(
                        "
                        INSERT INTO frames (
                          id, parent_id, name, description, icon, sort_order, created_at,
                          updated_at, is_system, deleted_at, delete_after, trash_group_id
                        ) VALUES (?1, NULL, 'Inbox', NULL, NULL, 0, ?2, ?2, 1, NULL, NULL, NULL)
                        ",
                        params![&id, &now],
                    )?;
                    id
                }
            }
        }
    };

    connection.execute(
        "
        UPDATE frames
        SET is_system = CASE WHEN id = ?1 THEN 1 ELSE 0 END,
            deleted_at = CASE WHEN id = ?1 THEN NULL ELSE deleted_at END,
            delete_after = CASE WHEN id = ?1 THEN NULL ELSE delete_after END,
            trash_group_id = CASE WHEN id = ?1 THEN NULL ELSE trash_group_id END
        ",
        params![system_id],
    )?;
    Ok(())
}

fn enqueue_cleanup_paths<I>(connection: &Connection, paths: I) -> CoreResult<()>
where
    I: IntoIterator<Item = Option<String>>,
{
    let now = Utc::now().to_rfc3339();
    for path in paths.into_iter().flatten().filter(|path| !path.is_empty()) {
        connection.execute(
            "
            INSERT OR IGNORE INTO pending_file_deletions (
              relative_path, created_at, updated_at, attempts, last_error
            ) VALUES (?1, ?2, ?2, 0, NULL)
            ",
            params![path, &now],
        )?;
    }
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> CoreResult<()> {
    let mut stmt = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column_name);
    if exists {
        return Ok(());
    }

    connection.execute_batch(&format!(
        "ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const V0_0_2_FIXTURE: &str = include_str!("../tests/fixtures/v0_0_2.sql");

    #[test]
    fn migration_creates_expected_tables_and_version() {
        let temp = tempfile::tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let conn = core.conn().expect("conn");
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('frames', 'assets', 'fragments', 'tags', 'fragment_tags', 'pending_file_deletions', 'vault_metadata')",
                [],
                |row| row.get(0),
            )
            .expect("query");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version");
        assert_eq!(count, 7);
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn library_revision_changes_after_visible_mutations() {
        let temp = tempfile::tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let initial = core.library_revision().expect("initial revision");

        let frame = core
            .create_frame(None, "Revision Frame".to_string())
            .expect("create frame");
        let after_create = core.library_revision().expect("created revision");
        assert!(after_create > initial);

        core.rename_frame(frame.id, "Renamed Revision Frame".to_string())
            .expect("rename frame");
        assert!(core.library_revision().expect("renamed revision") > after_create);
    }

    #[test]
    fn migration_backfills_assets_for_legacy_fragments() {
        let temp = tempfile::tempdir().expect("tempdir");
        let db_path = temp.path().join("fragment.db");
        {
            let conn = Connection::open(&db_path).expect("open legacy");
            conn.execute_batch(
                "
                CREATE TABLE frames (
                  id TEXT PRIMARY KEY,
                  parent_id TEXT,
                  name TEXT NOT NULL,
                  description TEXT,
                  icon TEXT,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE fragments (
                  id TEXT PRIMARY KEY,
                  frame_id TEXT NOT NULL,
                  title TEXT,
                  description TEXT,
                  note TEXT,
                  source_url TEXT,
                  page_url TEXT,
                  site_name TEXT,
                  creator_name TEXT,
                  original_path TEXT NOT NULL,
                  thumbnail_path TEXT NOT NULL,
                  preview_path TEXT,
                  mime_type TEXT,
                  width INTEGER,
                  height INTEGER,
                  file_size INTEGER,
                  sha256 TEXT,
                  perceptual_hash TEXT,
                  captured_from TEXT,
                  captured_at TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                INSERT INTO frames (id, name, sort_order, created_at, updated_at)
                VALUES ('frame-1', 'Inbox', 0, '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z');
                INSERT INTO fragments (
                  id, frame_id, title, original_path, thumbnail_path, preview_path,
                  width, height, file_size, sha256, captured_at, created_at, updated_at
                )
                VALUES (
                  'fragment-1', 'frame-1', 'Legacy', 'originals/legacy.png',
                  'thumbnails/legacy.png', 'previews/legacy.png', 20, 20, 42,
                  'hash-1', '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z',
                  '2026-06-24T00:00:00Z'
                );
                ",
            )
            .expect("legacy schema");
        }

        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("migrate");
        let conn = core.conn().expect("conn");
        let asset_count: i64 = conn
            .query_row("SELECT count(*) FROM assets", [], |row| row.get(0))
            .expect("asset count");
        let asset_id: Option<String> = conn
            .query_row(
                "SELECT asset_id FROM fragments WHERE id = 'fragment-1'",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("asset id");
        assert_eq!(asset_count, 1);
        assert_eq!(asset_id.as_deref(), Some("hash-1"));
    }

    #[test]
    fn v0_0_2_fixture_upgrades_without_duplicate_memberships() {
        let temp = tempfile::tempdir().expect("tempdir");
        let db_path = temp.path().join("fragment.db");
        Connection::open(&db_path)
            .expect("open fixture")
            .execute_batch(V0_0_2_FIXTURE)
            .expect("load fixture");

        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("upgrade fixture");
        let conn = core.conn().expect("conn");
        let membership_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM fragments WHERE frame_id = 'inbox-v002' AND asset_id = 'asset-v002'",
                [],
                |row| row.get(0),
            )
            .expect("membership count");
        let active_id: String = conn
            .query_row(
                "SELECT id FROM fragments WHERE frame_id = 'inbox-v002' AND asset_id = 'asset-v002'",
                [],
                |row| row.get(0),
            )
            .expect("canonical membership");
        let system_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM frames WHERE is_system = 1",
                [],
                |row| row.get(0),
            )
            .expect("system count");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version");

        assert_eq!(membership_count, 1);
        assert_eq!(active_id, "active-v002");
        assert_eq!(system_count, 1);
        assert_eq!(version, CURRENT_SCHEMA_VERSION);

        let duplicate_insert = conn.execute(
            "
            INSERT INTO fragments (
              id, asset_id, frame_id, title, original_path, thumbnail_path,
              captured_at, created_at, updated_at
            ) VALUES (
              'blocked-duplicate', 'asset-v002', 'inbox-v002', 'Blocked',
              'originals/2026/06/asset-v002.png', 'thumbnails/asset-v002.png',
              '2026-06-24T00:06:00Z', '2026-06-24T00:06:00Z', '2026-06-24T00:06:00Z'
            )
            ",
            [],
        );
        assert!(duplicate_insert.is_err());
    }
}
