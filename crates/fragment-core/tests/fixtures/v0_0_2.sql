PRAGMA user_version = 0;

CREATE TABLE frames (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES frames(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assets (
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

CREATE TABLE fragments (
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

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE fragment_tags (
  fragment_id TEXT NOT NULL REFERENCES fragments(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (fragment_id, tag_id)
);

INSERT INTO frames (id, name, sort_order, created_at, updated_at)
VALUES
  ('inbox-v002', 'Inbox', 0, '2026-06-24T00:00:00Z', '2026-06-24T00:00:00Z'),
  ('references-v002', 'References', 1, '2026-06-24T00:01:00Z', '2026-06-24T00:01:00Z');

INSERT INTO assets (
  id, original_path, thumbnail_path, preview_path, mime_type, width, height,
  file_size, sha256, created_at, updated_at
)
VALUES (
  'asset-v002', 'originals/2026/06/asset-v002.png', 'thumbnails/asset-v002.png',
  'previews/asset-v002.png', 'image/png', 24, 16, 128, 'sha-v002',
  '2026-06-24T00:02:00Z', '2026-06-24T00:02:00Z'
);

INSERT INTO fragments (
  id, asset_id, frame_id, title, original_path, thumbnail_path, preview_path,
  mime_type, width, height, file_size, sha256, captured_from, captured_at,
  created_at, updated_at, deleted_at, delete_after
)
VALUES
  (
    'active-v002', 'asset-v002', 'inbox-v002', 'Legacy active',
    'originals/2026/06/asset-v002.png', 'thumbnails/asset-v002.png',
    'previews/asset-v002.png', 'image/png', 24, 16, 128, 'sha-v002',
    'local_import', '2026-06-24T00:03:00Z', '2026-06-24T00:03:00Z',
    '2026-06-24T00:03:00Z', NULL, NULL
  ),
  (
    'trashed-duplicate-v002', 'asset-v002', 'inbox-v002', 'Legacy trashed duplicate',
    'originals/2026/06/asset-v002.png', 'thumbnails/asset-v002.png',
    'previews/asset-v002.png', 'image/png', 24, 16, 128, 'sha-v002',
    'local_import', '2026-06-24T00:04:00Z', '2026-06-24T00:04:00Z',
    '2026-06-24T00:04:00Z', '2026-06-25T00:00:00Z', '2099-06-25T00:00:00Z'
  ),
  (
    'shared-v002', 'asset-v002', 'references-v002', 'Legacy shared membership',
    'originals/2026/06/asset-v002.png', 'thumbnails/asset-v002.png',
    'previews/asset-v002.png', 'image/png', 24, 16, 128, 'sha-v002',
    'local_import', '2026-06-24T00:05:00Z', '2026-06-24T00:05:00Z',
    '2026-06-24T00:05:00Z', NULL, NULL
  );
