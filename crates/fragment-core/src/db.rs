use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use reqwest::blocking::Client;
use rusqlite::Connection;

use crate::app_paths::AppPaths;
use crate::errors::{CoreError, CoreResult};

const INIT_MIGRATION: &str = include_str!("../migrations/0001_init.sql");

#[derive(Clone)]
pub struct FragmentCore {
    paths: AppPaths,
    connection: Arc<Mutex<Connection>>,
    http_client: Client,
}

impl FragmentCore {
    pub fn new() -> CoreResult<Self> {
        let paths = AppPaths::default()?;
        Self::from_paths(paths)
    }

    pub fn new_at(root: PathBuf) -> CoreResult<Self> {
        let paths = AppPaths::from_root(root)?;
        Self::from_paths(paths)
    }

    pub fn from_paths(paths: AppPaths) -> CoreResult<Self> {
        let connection = Connection::open(paths.db_path())?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "busy_timeout", 5000_i64)?;
        connection.pragma_update(None, "cache_size", -12000_i64)?;
        connection.execute_batch(INIT_MIGRATION)?;
        migrate_existing_schema(&connection)?;

        let core = Self {
            paths,
            connection: Arc::new(Mutex::new(connection)),
            http_client: Client::builder().timeout(Duration::from_secs(20)).build()?,
        };
        core.ensure_default_frame()?;
        Ok(core)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
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

fn migrate_existing_schema(connection: &Connection) -> CoreResult<()> {
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
          sha256,
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
    use rusqlite::OptionalExtension;

    #[test]
    fn migration_creates_expected_tables() {
        let temp = tempfile::tempdir().expect("tempdir");
        let core = FragmentCore::new_at(temp.path().to_path_buf()).expect("core");
        let conn = core.conn().expect("conn");
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('frames', 'assets', 'fragments', 'tags', 'fragment_tags')",
                [],
                |row| row.get(0),
            )
            .expect("query");
        assert_eq!(count, 5);
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
}
