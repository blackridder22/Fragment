CREATE TABLE IF NOT EXISTS vault_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO vault_metadata (id, revision) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_frames_insert
AFTER INSERT ON frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_frames_update
AFTER UPDATE ON frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_frames_delete
AFTER DELETE ON frames
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_fragments_insert
AFTER INSERT ON fragments
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_fragments_update
AFTER UPDATE ON fragments
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_fragments_delete
AFTER DELETE ON fragments
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_assets_insert
AFTER INSERT ON assets
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_assets_update
AFTER UPDATE ON assets
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS bump_vault_revision_assets_delete
AFTER DELETE ON assets
BEGIN
  UPDATE vault_metadata SET revision = revision + 1 WHERE id = 1;
END;
