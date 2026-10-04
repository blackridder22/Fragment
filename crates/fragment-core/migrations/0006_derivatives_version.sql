-- Derivative policy version per asset. Existing rows (1) hold 640/1600 lossless
-- PNG derivatives; the current policy (2) writes lossy WebP with alpha and skips
-- the preview file for small browser-displayable originals. Rows below the
-- current version are regenerated in the background (derivative_jobs.rs).
ALTER TABLE assets ADD COLUMN derivatives_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE asset_derivative_jobs (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','processing','failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    error_code TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_asset_derivative_jobs_status ON asset_derivative_jobs(status, lease_expires_at);
CREATE INDEX idx_assets_derivatives_version ON assets(derivatives_version);
