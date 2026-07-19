# Roadmap

## v0.0.2 baseline

- Local-first macOS Vault with SQLite metadata and filesystem assets.
- System Inbox and Frame creation, rename, and navigation.
- Local image import, thumbnails, previews, and image-first masonry browsing.
- Fragment details, search, sort, filter, selection, and theme preferences.
- Chrome Manifest V3 capture through the native host.
- Multi-Frame capture with one shared asset and multiple Fragment memberships.
- Fragment Trash metadata and Restore entry points.

## v0.0.3 - In progress

This release is focused on reliability, measured speed, UIX polish, and a
reproducible desktop-plus-extension release.

### Foundation

- Unified `0.0.3` application versions and pinned Node/Rust toolchains.
- Real zero-warning ESLint baseline.
- Deterministic synthetic Vault fixtures at 60, 1,000, and 10,000 memberships.
- Clean-checkout CI for lint, typecheck, tests, Rust format/Clippy/tests, and
  desktop/extension frontend builds.
- Current architecture, capture, native messaging, and release documentation.

### Data safety

- Versioned migrations and pre-migration database backup.
- Unique `(frame_id, asset_id)` memberships.
- Transactional multi-Frame capture and shared-asset deletion.
- Reversible Frame Trash, Restore conflict handling, and retention purge.
- Exact duplicate decisions for active and trashed memberships.

### Performance

- One paginated startup snapshot and revision-based focus refresh.
- Reliable asset URLs with no normal-path base64 IPC fallback.
- Incremental gallery pages and stable card rendering.
- Background import queue with one read/hash/decode per image.
- Measured launch, first-thumbnail, scrolling, import, and selection budgets.

### UIX

- Compact toolbar at the 960 x 680 minimum window.
- Contextual selection with complete-query Select All.
- Non-blocking import and duplicate-resolution UI.
- Correct details navigation, Copy Image, focus, and keyboard behavior.
- Animated Trash drop with Undo and reduced-motion parity.
- Complete Light, Dark, and System theme QA.

### Extension and release

- Hardened native connection lifecycle and request-ID validation.
- Consistent current branding and a canonical extension manifest.
- Signed bundled native host and stable Chrome manifest installation.
- Deterministic extension ZIP and coherent app/host/extension artifacts.

## Explicitly later

- Video storage and playback.
- `yt-dlp`, `gallery-dl`, or private downloader tooling.
- Cloud sync, accounts, collaboration, and public sharing.
- AI generation or semantic search.
- Safari extension and mobile companion.
- Bulk profile, account, or collection extraction.
- A replacement for SQLite without measured evidence.
