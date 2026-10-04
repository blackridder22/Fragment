# Worktree 10 — Core derivatives and runtime (wave 1, Rust)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
This worktree is Rust only. It runs in parallel with `wt/00-foundation` and must not edit
`apps/desktop/src/**`.

## Branch and PR

- Create `wt/10-core-derivatives` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-10: WebP derivatives and runtime"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`crates/fragment-core/**`, `apps/desktop/src-tauri/**`, `crates/fragment-host/**` (only if the
derivative change requires it), the workspace `Cargo.toml`, `docs/ARCHITECTURE.md`,
`docs/SECURITY_AND_PRIVACY.md`, and AGENTS.md section 8 (the PNG rule). Nothing under
`apps/desktop/src` or `apps/extension`.

## Why

Thumbnails are 640 px lossless PNGs: median 273 KB, p90 439 KB. Previews are 1600 px PNGs:
median 1.3 MB, p90 2.3 MB, and the previews folder is 2.4x the originals. A 60-item page moves
~16 MB. Re-encoding 12 real thumbnails gave PNG 2.99 MB -> WebP q82 0.37 MB (8.2x) with alpha kept;
one 1600x702 preview went 1.39 MB -> 175 KB. WKWebView on macOS 11+ decodes WebP natively.

## Tasks

1. Derivative format. In `crates/fragment-core/src/thumbnails.rs`, write thumbnails (640 px) and
   previews (1600 px) as lossy WebP that preserves alpha, quality about 82 for thumbnails and 85 for
   previews. Use the `webp` crate (libwebp bindings); the `image` crate's WebP encoder is lossless
   only. If libwebp cannot be built cleanly for the macOS bundle, fall back to JPEG q85 for opaque
   images and PNG only when the source has alpha, and say so in the PR. Keep the originals
   byte-identical as today. Store the new extension in `thumbnail_path` / `preview_path`.
2. Skip pointless previews. When the original's longest edge is <= 1600 px and the format is
   browser-displayable (JPEG, PNG, WebP, GIF), set `preview_path` to the original path and write no
   preview file. Confirm the desktop asset candidate chain already tolerates
   `previewPath == originalPath` (it deduplicates candidates).
3. Regenerate existing Vaults. Add migration `0006` with `assets.derivatives_version INTEGER NOT NULL
   DEFAULT 1`, set 2 for the new format. Add a background regeneration job modelled on
   `palette_jobs.rs` (leased batches, one worker, pauses while `processing::foreground_busy()`):
   decode the original, write new derivatives atomically, update paths and version in one
   transaction, bump the library revision, then delete the old files. Never delete an old file
   before the new one is committed. Expose a Tauri command `derivatives_status` returning
   `{ pending, done, failed }` and start the job from the desktop `setup` after a short idle delay
   (about 3 s after launch) so first paint is not contended.
4. SVG tiers in `previews.rs` may stay PNG for exactness unless switching is trivial; decide and document.
5. Palette loop. In `apps/desktop/src-tauri/src/media_commands.rs` the indexing thread wakes every
   500 ms forever. Replace with: drain the queue, then wait on a `Condvar` notified by import
   completion, capture, retry, and priority changes, with a 30 s fallback poll. Confirm palette
   extraction still decodes the (now WebP) thumbnail correctly and that `foreground_busy` is honored.
6. Window chrome. `lib.rs` calls `window_chrome::refresh` on every `Resized` event, which forces a
   synchronous `displayIfNeeded`. Keep `Focused` and `ThemeChanged` immediate; coalesce `Resized`
   to one refresh 150 ms after the last resize event. Verify the traffic lights still realign after
   resize, full-screen exit and theme change.
7. Startup. Build the blocking `reqwest` client lazily (`OnceLock`) in `db.rs`; the desktop never
   downloads. Add `[profile.release]` to the workspace `Cargo.toml` with `lto = "thin"`,
   `codegen-units = 1`, `strip = true`. Keep `panic` unchanged. Record binary size and cold
   launch-to-window before and after (`time` the release binary with `FRAGMENT_APP_DATA_DIR` set to
   an empty temp Vault, closing the window immediately; take 5 samples, report median).
8. Docs. Update AGENTS.md section 8 (derivatives are WebP, PNG only for SVG tiers or alpha fallback),
   `docs/ARCHITECTURE.md`, and the storage layout block. Note the decision and the measured reason.

## Acceptance

- New imports of `fixtures/media/nasa-blue-marble.jpg` and the PNGs in `fixtures/media/` produce
  `.webp` thumbnails and previews; alpha is preserved for `transparent-logo.png` and `transparent.png`
  (test by decoding and checking pixel alpha).
- Thumbnail bytes p50 under 60 KB and preview bytes p50 under 300 KB on the 1,000-image QA corpus
  (`media_qa_corpus` + `seed_media_qa`, see `scripts/qa/README.md`). Report p50/p90 before and after.
- Import time for the NASA fixture via `raster_benchmark`: p95 not more than 10% slower than before.
- Regeneration of a copied 1,000-asset Vault completes without errors, old files are gone, paths and
  versions updated, and the app browses normally while it runs.
- Palette thread wakes only when there is work (log at debug level and show a 60 s idle sample).
- `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace` pass with new tests for format, alpha, skip-preview rule, regeneration
  transaction and rollback.
- The packaged app renders the new derivatives (build with `pnpm release:local`, run with an
  isolated Vault, screenshot the gallery and one preview).

## Out of scope

Any change under `apps/desktop/src`, UI copy, the extension, FTS search (roadmap only).
