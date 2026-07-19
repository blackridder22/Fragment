CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES frames(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,

  original_path TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  preview_path TEXT,

  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,

  sha256 TEXT UNIQUE,
  perceptual_hash TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fragments (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
  frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE CASCADE,

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
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  delete_after TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fragment_tags (
  fragment_id TEXT NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (fragment_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_frames_parent_id ON frames(parent_id);
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_fragments_frame_id ON fragments(frame_id);
CREATE INDEX IF NOT EXISTS idx_fragments_sha256 ON fragments(sha256);
CREATE INDEX IF NOT EXISTS idx_fragments_captured_at ON fragments(captured_at);
