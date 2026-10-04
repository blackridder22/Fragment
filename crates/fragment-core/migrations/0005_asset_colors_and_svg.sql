ALTER TABLE assets ADD COLUMN render_warnings_json TEXT;
ALTER TABLE vault_metadata ADD COLUMN palette_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE asset_palettes (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    algorithm_version INTEGER NOT NULL,
    source_sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','ready','empty','failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    error_code TEXT,
    next_retry_at INTEGER,
    lease_token TEXT,
    lease_expires_at INTEGER,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_asset_palettes_jobs ON asset_palettes(status, next_retry_at, lease_expires_at);

CREATE TABLE asset_palette_colors (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK(rank BETWEEN 0 AND 5),
    r INTEGER NOT NULL CHECK(r BETWEEN 0 AND 255),
    g INTEGER NOT NULL CHECK(g BETWEEN 0 AND 255),
    b INTEGER NOT NULL CHECK(b BETWEEN 0 AND 255),
    l REAL NOT NULL CHECK(l BETWEEN 0 AND 1),
    a REAL NOT NULL,
    lab_b REAL NOT NULL,
    coverage REAL NOT NULL CHECK(coverage > 0 AND coverage <= 1),
    PRIMARY KEY(asset_id, rank)
);

CREATE TABLE asset_preview_cache (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    tier INTEGER NOT NULL CHECK(tier IN (3200,4096)),
    relative_path TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
    last_access INTEGER NOT NULL,
    PRIMARY KEY(asset_id, fingerprint, tier)
);
CREATE INDEX idx_asset_preview_cache_lru ON asset_preview_cache(last_access);
