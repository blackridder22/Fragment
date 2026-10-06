-- Replaced derivative files (derivative_jobs.rs) must outlive the process that
-- replaced them: the running UI may still hold the old paths in its candidate
-- chain, and nothing in the frontend refetches on `derivatives-changed`. Rows
-- with deferred_until_relaunch = 1 are skipped by the regular cleanup pass and
-- promoted to immediate deletions by the desktop shell at its next launch, when
-- no live view can reference them any more. Hard deletes keep queueing with 0.
ALTER TABLE pending_file_deletions ADD COLUMN deferred_until_relaunch INTEGER NOT NULL DEFAULT 0;
