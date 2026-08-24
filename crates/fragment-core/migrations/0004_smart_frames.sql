CREATE TABLE IF NOT EXISTS smart_frames (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smart_frames_sort_order
  ON smart_frames(sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_fragments_filter_dates
  ON fragments(deleted_at, captured_at);
CREATE INDEX IF NOT EXISTS idx_fragments_filter_metadata
  ON fragments(site_name, creator_name);
CREATE INDEX IF NOT EXISTS idx_assets_filter_media
  ON assets(mime_type, width, height, file_size);
CREATE INDEX IF NOT EXISTS idx_fragment_tags_tag_fragment
  ON fragment_tags(tag_id, fragment_id);

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_smart_frames_insert
AFTER INSERT ON smart_frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_smart_frames_update
AFTER UPDATE ON smart_frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_smart_frames_delete
AFTER DELETE ON smart_frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;
