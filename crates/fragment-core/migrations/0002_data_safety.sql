CREATE TABLE IF NOT EXISTS pending_file_deletions (
  relative_path TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_assets_sha256
  ON assets(sha256)
  WHERE sha256 IS NOT NULL AND sha256 <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_fragments_frame_asset
  ON fragments(frame_id, asset_id)
  WHERE asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_frames_single_system
  ON frames(is_system)
  WHERE is_system = 1;

CREATE INDEX IF NOT EXISTS idx_frames_deleted_at ON frames(deleted_at);
CREATE INDEX IF NOT EXISTS idx_frames_delete_after ON frames(delete_after);
CREATE INDEX IF NOT EXISTS idx_frames_trash_group_id ON frames(trash_group_id);
CREATE INDEX IF NOT EXISTS idx_fragments_asset_id ON fragments(asset_id);
CREATE INDEX IF NOT EXISTS idx_fragments_deleted_at ON fragments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_fragments_delete_after ON fragments(delete_after);

CREATE TRIGGER IF NOT EXISTS protect_system_frame_delete
BEFORE DELETE ON frames
WHEN OLD.is_system = 1
BEGIN
  SELECT RAISE(ABORT, 'Inbox is a protected Frame');
END;

CREATE TRIGGER IF NOT EXISTS protect_system_frame_trash
BEFORE UPDATE OF deleted_at ON frames
WHEN OLD.is_system = 1 AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Inbox is a protected Frame');
END;

CREATE TRIGGER IF NOT EXISTS protect_system_frame_rename
BEFORE UPDATE OF name ON frames
WHEN OLD.is_system = 1 AND NEW.name <> OLD.name
BEGIN
  SELECT RAISE(ABORT, 'Inbox is a protected Frame');
END;
