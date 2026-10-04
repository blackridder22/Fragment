# AGENTS.md — Fragment by Auto Scale Agency

This file is the project operating guide for Codex, coding agents, and future contributors working on **Fragment by Auto Scale Agency**.

Fragment is a macOS-first, local-first visual reference vault. Users save images and visual references from the web as **Fragments** inside **Frames**. The product is inspired by the organization gap left by browser-only visual platforms, but it must not be built as a scraper, downloader clone, or unauthorized bulk extraction tool.

---

## 1. Product summary

### Product name

**Fragment**

### Brand

**Fragment by Auto Scale Agency**

### One-line description

A fast local-first desktop vault for capturing, organizing, and searching visual inspiration from the web and local files.

### Core promise

Users can browse Pinterest, Google Images, Instagram, blogs, design sites, and other visual sources, then save specific user-selected images into a structured local library without breaking their browsing flow.

### Product language

Use these words in the app UI, code, database, docs, and tests:

- **Frame**: a user-created visual collection, workspace, or folder-like container.
- **Fragment**: a saved image/reference item.
- **Vault**: the local Fragment library on the user's machine.
- **Capture Mode**: browser-extension mode where overlay buttons appear on detected images.
- **Save Fragment**: the primary capture action.
- **Source**: the original URL/page where a Fragment came from.

Do not use these words in product-facing UI or internal domain code except when documenting comparisons:

- Pin
- Board
- Repin
- Pinterest board
- Pinterest downloader

A correct user-facing phrase is:

> Save this image as a Fragment into a Frame.

---

## 2. Non-negotiable product boundaries

Fragment must be built as a **user-directed reference manager**, not a scraping tool.

The product must:

- Capture only images the user intentionally selects.
- Keep source URL/page URL metadata when available.
- Support local import from files.
- Be local-first by default.
- Avoid bulk board/profile/account downloads.
- Avoid bypassing authentication, rate limits, robots controls, paywalls, or platform protections.
- Avoid using platform-specific names like Pin/Board in UI.
- Avoid pretending the user owns copyright to captured images.
- Keep capture behavior transparent and reversible.

The MVP must not include:

- Cloud sync.
- Team collaboration.
- Public sharing.
- AI generation.
- Mass scraping.
- Pinterest API integration.
- Account import from Pinterest, Instagram, or other platforms.
- Mobile app.

---

## 3. Canonical user flow

The canonical capture flow is:

1. User browses Pinterest, Google Images, Instagram, a blog, a design site, or another visual webpage.
2. User clicks the Fragment browser extension icon.
3. The extension enters **Capture Mode** on the active tab.
4. The content script detects candidate images on the page.
5. Overlay buttons appear on detected images.
6. User hovers over an image and clicks **Save Fragment**.
7. A small inline picker appears so the user can choose a destination Frame and optionally add tags/notes.
8. The extension sends a capture payload to the local native host.
9. Rust saves the asset locally, generates a thumbnail, stores metadata in SQLite, and keeps source metadata.
10. The browser shows a small success state without forcing the desktop app to open.

Deep links may exist, but they must not be the main save path because saving many images should not repeatedly open or focus the desktop app.

---

## 4. Technical stack

### First-class target

- macOS desktop first.
- Cross-platform structure is welcome, but macOS is the initial priority.

### Desktop app

- Tauri v2
- Rust
- React
- TypeScript
- Vite
- SQLite
- Local filesystem storage

### Browser extension

- Chrome Extension Manifest V3
- TypeScript
- React for popup/settings UI
- Content script injected into active tab for Capture Mode
- Background service worker
- Chrome Native Messaging for production communication with local native host
- Local HTTP bridge allowed only for development/debugging if useful

### Rust crates

- `fragment-core`: shared Rust domain library for database, storage, image processing, and capture logic.
- `fragment-host`: Chrome Native Messaging host binary using `fragment-core`.
- `apps/desktop/src-tauri`: Tauri shell that calls `fragment-core` through commands.

### Recommended Rust dependencies

Use equivalent alternatives only when there is a strong reason.

- `serde`, `serde_json`
- `thiserror`
- `anyhow` only at binary/app boundaries, not as the core public error model
- `uuid`
- `chrono` or `time`
- `rusqlite` or `sqlx` for SQLite
- `image` for thumbnail generation
- `sha2` for SHA-256
- `reqwest` for URL download in native host/core
- `url` for URL validation
- `directories` for app data path resolution outside Tauri
- `tracing` and `tracing-subscriber` for logging

### Recommended TypeScript dependencies

- React
- Vite
- TypeScript strict mode
- Zod for runtime validation of messages where helpful
- Vitest for tests
- ESLint + Prettier

---

## 5. Repository structure

Use this structure unless there is a compelling reason to change it.

```txt
fragment/
  AGENTS.md
  PROMPT.md
  README.md
  package.json
  pnpm-workspace.yaml
  Cargo.toml
  .gitignore
  .editorconfig

  apps/
    desktop/
      package.json
      index.html
      vite.config.ts
      src/
        app/
        components/
        features/
          frames/
          fragments/
          import/
          settings/
        lib/
        styles/
        main.tsx
      src-tauri/
        Cargo.toml
        tauri.conf.json
        src/
          main.rs
          commands.rs
          state.rs

    extension/
      package.json
      manifest.json
      vite.config.ts
      src/
        background/
          service-worker.ts
          native-client.ts
        content/
          capture-mode.ts
          image-detector.ts
          overlay.ts
          adapters/
            generic.ts
            pinterest.ts
            instagram.ts
            google-images.ts
        popup/
          index.html
          main.tsx
          Popup.tsx
        shared/
          messages.ts
          types.ts
      public/
        icons/

  crates/
    fragment-core/
      Cargo.toml
      migrations/
        0001_init.sql
      src/
        lib.rs
        app_paths.rs
        db.rs
        errors.rs
        frames.rs
        fragments.rs
        capture.rs
        storage.rs
        thumbnails.rs
        hashing.rs
        models.rs

    fragment-host/
      Cargo.toml
      src/
        main.rs
        protocol.rs
        handlers.rs
      native-host-manifests/
        com.autoscale.fragment.chrome.json.example

  packages/
    shared/
      package.json
      src/
        index.ts
        domain.ts
        messages.ts

  scripts/
    install-native-host-macos.sh
    uninstall-native-host-macos.sh
    dev-reset-library.sh

  docs/
    ARCHITECTURE.md
    CAPTURE_PROTOCOL.md
    NATIVE_MESSAGING.md
    SECURITY_AND_PRIVACY.md
    ROADMAP.md
```

---

## 6. Agent operating rules

When working on this repo:

1. Read `AGENTS.md` before making architectural changes.
2. Prefer small, working vertical slices over giant incomplete rewrites.
3. Keep the domain vocabulary consistent: Frame and Fragment.
4. Do not introduce cloud infrastructure unless explicitly requested later.
5. Do not introduce scraping/bulk-download flows.
6. Do not store image bytes directly in SQLite.
7. Store originals/thumbnails on disk and metadata in SQLite.
8. All DB schema changes must be done through migrations.
9. Keep TypeScript types and Rust models aligned.
10. Validate any payload that crosses the extension/native boundary.
11. Use explicit error messages and typed errors.
12. Never commit secrets, API keys, local absolute paths, or real user data.
13. Add or update tests when changing core logic.
14. Update documentation when changing architecture or protocols.
15. If a tradeoff is required, choose the simplest working MVP path and document the decision.

---

## 7. Architecture overview

### Production capture path

```txt
Chrome action click
  ↓
Inject Capture Mode content script into active tab
  ↓
Detect image candidates
  ↓
Show overlay buttons
  ↓
User clicks Save Fragment
  ↓
Content script sends candidate to background service worker
  ↓
Service worker sends native message to com.autoscale.fragment
  ↓
fragment-host validates message
  ↓
fragment-host calls fragment-core
  ↓
fragment-core downloads/saves original image
  ↓
fragment-core generates thumbnail/preview
  ↓
fragment-core stores metadata in SQLite
  ↓
Service worker receives result
  ↓
Overlay shows success/error
```

### Desktop path

```txt
Tauri React UI
  ↓
Tauri command
  ↓
fragment-core
  ↓
SQLite + local files
  ↓
UI refreshes frame/fragment data
```

### Development bridge path

A local HTTP bridge is allowed for local development if it speeds up debugging.

```txt
Chrome extension
  ↓
http://127.0.0.1:<dev-port>/capture
  ↓
Tauri development bridge
  ↓
fragment-core
```

This bridge must be disabled or secured for production. Native Messaging is the preferred production path.

### Deep links

Deep links are allowed only for navigation and pairing flows, such as:

```txt
fragment://open/frame/:id
fragment://open/fragment/:id
fragment://pair-extension
fragment://settings/extension
```

Do not use deep links for the main Save Fragment operation.

---

## 8. Local storage model

Default macOS library path:

```txt
~/Library/Application Support/Fragment/
  fragment.db
  originals/
    2026/
      06/
        <fragment-id>.<ext>
  thumbnails/
    <asset-id>.webp          # raster sources; SVG sources keep <asset-id>.png
  previews/
    <asset-id>.webp          # only when the original is > 1600 px or not browser-displayable
  temp/
  logs/
```

Rules:

- SQLite stores metadata only.
- Original images are stored on disk.
- Thumbnails and previews are derived files.
- Raster derivatives are lossy WebP (libwebp via the `webp` crate): thumbnails 640 px at
  quality 82, previews 1600 px at quality 85, alpha plane kept lossless. Measured on the author's
  Vault (v0.0.9): 12 PNG thumbnails 2.99 MB -> WebP 0.37 MB (8.2x) with alpha intact; one
  1600x702 PNG preview 1.39 MB -> 175 KB. WKWebView on macOS 11+ decodes WebP natively.
- PNG is used only for SVG-rendered tiers (`svg.rs`, `previews.rs`), where tiny-skia's exact
  straight-alpha output matters more than bytes, and as the fallback if libwebp cannot be built.
- No preview file is written when the original's longest edge is <= 1600 px and its format is
  browser-displayable (JPEG, PNG, WebP, GIF); `preview_path` then equals `original_path`.
- `assets.derivatives_version` records the policy an asset was written with (1 = PNG,
  2 = WebP + skip rule). Older rows are regenerated in the background (`derivative_jobs.rs`),
  new files committed before old ones are deleted.
- The original file is the source of truth for the image asset.
- Paths stored in the database should be relative to the Fragment app data root whenever possible.
- Never trust paths received from the extension.
- Prevent path traversal.
- Create parent directories automatically.
- Use atomic write patterns where practical: write temp file, flush, rename into place.

---

## 9. Database schema v1

Use this as the first migration. Modify only through future migrations.

```sql
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

CREATE TABLE IF NOT EXISTS fragments (
  id TEXT PRIMARY KEY,
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
  updated_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_fragments_frame_id ON fragments(frame_id);
CREATE INDEX IF NOT EXISTS idx_fragments_sha256 ON fragments(sha256);
CREATE INDEX IF NOT EXISTS idx_fragments_captured_at ON fragments(captured_at);
```

Optional v1.1 search migration:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS fragments_fts USING fts5(
  fragment_id UNINDEXED,
  title,
  description,
  note,
  source_url,
  page_url,
  site_name,
  creator_name
);
```

---

## 10. Shared domain types

Keep Rust and TypeScript domain models semantically aligned.

### Frame

```ts
export type Frame = {
  id: string;
  parentId: string | null;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
```

### Fragment

```ts
export type Fragment = {
  id: string;
  frameId: string;
  title?: string | null;
  description?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  siteName?: string | null;
  creatorName?: string | null;
  originalPath: string;
  thumbnailPath: string;
  previewPath?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  sha256?: string | null;
  perceptualHash?: string | null;
  capturedFrom?: string | null;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
};
```

### ImageCandidate

```ts
export type ImageCandidate = {
  id: string;
  src: string;
  currentSrc?: string;
  pageUrl: string;
  sourceUrl?: string;
  siteName?: string;
  alt?: string;
  title?: string;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source: "pinterest" | "instagram" | "google_images" | "generic";
};
```

### Capture request

```ts
export type CaptureFragmentRequest = {
  type: "capture.fragment";
  requestId: string;
  frameId: string;
  candidate: ImageCandidate;
  note?: string;
  tags?: string[];
  requestedAt: string;
  extensionVersion: string;
};
```

### Capture response

```ts
export type CaptureFragmentResponse = {
  type: "capture.fragment.result";
  requestId: string;
  ok: boolean;
  fragmentId?: string;
  duplicateOfFragmentId?: string;
  thumbnailPath?: string;
  error?: {
    code: string;
    message: string;
  };
};
```

---

## 11. Native messaging protocol

### Host name

```txt
com.autoscale.fragment
```

### Native host responsibilities

The native host must:

- Speak Chrome Native Messaging protocol using 4-byte little-endian message length followed by UTF-8 JSON.
- Read messages from stdin.
- Write responses to stdout.
- Log diagnostics to stderr or a file, never stdout.
- Validate message shape.
- Reject unknown message types.
- Keep responses small.
- Call `fragment-core` for all database/file operations.

### Required message types

```ts
type NativeRequest =
  | { type: "ping"; requestId: string }
  | { type: "frames.list"; requestId: string }
  | CaptureFragmentRequest;
```

```ts
type NativeResponse =
  | { type: "pong"; requestId: string; ok: true; app: "Fragment"; version: string }
  | { type: "frames.list.result"; requestId: string; ok: true; frames: Frame[] }
  | CaptureFragmentResponse
  | { type: "error"; requestId?: string; ok: false; error: { code: string; message: string } };
```

### Native host manifest example

```json
{
  "name": "com.autoscale.fragment",
  "description": "Fragment native messaging host",
  "path": "/absolute/path/to/fragment-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://REPLACE_WITH_EXTENSION_ID/"
  ]
}
```

The installer script should write this manifest to the correct macOS NativeMessagingHosts location during development.

---

## 12. Capture and storage algorithm

### URL-first save

For most captures:

1. Validate `frameId` exists.
2. Pick best candidate image URL:
   - `currentSrc`
   - `sourceUrl`
   - `src`
3. Validate URL scheme is `http` or `https`.
4. Download image with reasonable timeout and size limit.
5. Detect MIME type.
6. Decode dimensions if possible.
7. Compute SHA-256.
8. Check for exact duplicate by SHA-256.
9. If duplicate exists, return duplicate result instead of saving a second original unless future settings say otherwise.
10. Save original under app data `originals/YYYY/MM/<fragment-id>.<ext>`.
11. Generate thumbnail under `thumbnails/<asset-id>.webp`.
12. Generate preview under `previews/<asset-id>.webp`, or point `preview_path` at the original
    when it is <= 1600 px and browser-displayable.
13. Insert row into `fragments`.
14. Insert tags into `tags` and `fragment_tags`.
15. Return success.

### Blob/base64 fallback

Some sites use blob URLs, protected CDN URLs, or temporary image sources. For MVP, show a useful error. Later, add an explicit fallback where the extension fetches bytes and sends them to the native host only if the payload is below a safe size threshold.

### Screenshot fallback

Do not implement screenshot fallback in the first MVP. Add later as an explicit user action.

---

## 13. Desktop app requirements

### Layout

Use a visual Finder / VS Code style layout:

```txt
Left sidebar: Frame tree
Top bar: search, import, settings/status
Center: Fragment masonry/grid for selected Frame
Right panel: selected Fragment details
```

### Required desktop MVP features

- Create Frame.
- List Frames.
- Rename Frame.
- Delete Frame, with confirmation if it contains Fragments.
- Select Frame.
- Drag-and-drop image files into selected Frame.
- Import image through file picker.
- Save original image locally.
- Generate thumbnail.
- Show Fragments in responsive grid.
- Select Fragment.
- Show Fragment detail panel.
- Edit Fragment title/note.
- Reveal original file in Finder.
- Open source URL when present.
- Refresh when app gains focus so background captures appear.
- Show empty states.
- Show errors in a non-crashing way.

### Tauri commands

Implement commands similar to:

```rust
create_frame(parent_id: Option<String>, name: String) -> Result<Frame>
list_frames() -> Result<Vec<Frame>>
rename_frame(id: String, name: String) -> Result<Frame>
delete_frame(id: String) -> Result<()>
list_fragments(frame_id: String) -> Result<Vec<Fragment>>
get_fragment(id: String) -> Result<Fragment>
update_fragment(id: String, title: Option<String>, note: Option<String>) -> Result<Fragment>
import_image(frame_id: String, file_path: String) -> Result<Fragment>
delete_fragment(id: String) -> Result<()>
reveal_fragment_in_finder(id: String) -> Result<()>
open_fragment_source(id: String) -> Result<()>
```

---

## 14. Extension requirements

### UX behavior

- Clicking the extension action toggles Capture Mode on the active tab.
- Capture Mode injects a content script if needed.
- Overlay buttons appear only on credible image candidates.
- The user can exit Capture Mode with Escape or by clicking the extension action again.
- Overlay UI must not permanently modify the page.
- Overlay should use Shadow DOM or strongly isolated CSS.
- The overlay button label should be **Save Fragment**.
- Clicking Save Fragment should open a small inline picker near the image.
- The picker should list Frames from the native host.
- If native host is unavailable, show setup guidance.
- On success, show a small saved state.
- On error, show a useful message.

### Detection requirements

The detector should find:

- `img[src]`
- `img[currentSrc]`
- `img[srcset]`
- `picture source[srcset]`
- `video[poster]`
- visible CSS `background-image` URLs where practical
- OpenGraph image metadata as a fallback
- large linked images inside anchors

Use:

- `MutationObserver` for infinite-scroll pages.
- `IntersectionObserver` for visible candidate tracking.
- `getBoundingClientRect()` for overlay placement.

### Candidate filtering

Default filters:

- Minimum displayed size: 120x120.
- Ignore hidden elements.
- Ignore transparent tracking pixels.
- Ignore SVG icons unless explicitly useful later.
- Prefer higher-resolution `currentSrc` or `srcset` variant.

### Site adapters

Create adapters, but keep generic fallback strong:

- `generic.ts`
- `pinterest.ts`
- `instagram.ts`
- `google-images.ts`

Adapters should improve metadata extraction and candidate quality. They must not bypass platform restrictions or implement account/board scraping.

### Extension permissions

Prefer minimal permissions:

- `activeTab`
- `scripting`
- `storage`
- `nativeMessaging`

Avoid broad host permissions unless needed for a specific, justified feature.

---

## 15. Security and privacy requirements

- The library is local-first.
- Do not transmit captured images to third-party servers in MVP.
- Do not add analytics in MVP.
- Validate all extension/native messages.
- Validate URL schemes.
- Reject `file://`, `javascript:`, `data:` by default unless a specific safe import flow handles it.
- Enforce download timeout.
- Enforce max download size.
- Sanitize filenames.
- Use generated filenames, not remote filenames.
- Avoid path traversal.
- Do not allow arbitrary filesystem writes from extension input.
- Native host stdout is reserved for protocol JSON only.
- Logs must not include full sensitive URLs by default if avoidable.
- Store source attribution metadata when available.

---

## 16. Design direction

### Visual style

- Dark-friendly neutral interface.
- Fast, calm, utilitarian.
- Inspired by Finder, VS Code, image boards, and creative asset managers.
- Avoid copying Pinterest UI/branding.

### Layout primitives

- Sidebar tree.
- Masonry/grid.
- Detail inspector.
- Compact toolbar.
- Inline capture picker.

### Naming examples

- “New Frame”
- “Save Fragment”
- “Capture Mode”
- “Open Source”
- “Reveal Original”
- “No Fragments in this Frame yet”

---

## 17. Roadmap

### Sprint 1 — Desktop local MVP

Goal: working local library.

Deliverables:

- Tauri app.
- SQLite database.
- Frame CRUD.
- Drag/drop local image import.
- Thumbnail generation.
- Fragment grid.
- Fragment detail panel.

### Sprint 2 — Extension capture UX

Goal: prove browser overlay flow.

Deliverables:

- Manifest V3 extension.
- Action click toggles Capture Mode.
- Image detection.
- Overlay buttons.
- Frame picker.
- Mock/native ping support.

### Sprint 3 — Native host capture

Goal: save browser-selected images into local vault.

Deliverables:

- `fragment-host` binary.
- Native messaging protocol.
- macOS host manifest install script.
- `frames.list` message.
- `capture.fragment` message.
- URL-first download save.

### Sprint 4 — Polish and reliability

Goal: make daily use smooth.

Deliverables:

- Duplicate detection.
- Better errors.
- Search.
- Tagging.
- Capture success toasts.
- App refresh on focus.
- Source URL opening.

### Later

- Canvas/moodboard view.
- Full-text search.
- Color extraction/filtering.
- Perceptual hashing.
- AI/semantic image search.
- Optional encrypted sync.
- Safari extension.
- Mobile companion.

---

## 18. Testing requirements

### Rust tests

Test at minimum:

- DB migration creates expected tables.
- Frame CRUD.
- Fragment insert/list/delete.
- App path resolution.
- URL validation.
- Hashing.
- Thumbnail generation with sample image.
- Native messaging length-prefix parser/writer.

### TypeScript tests

Test at minimum:

- Message validation.
- Image candidate filtering.
- Best image URL selection.
- Overlay state transitions.
- Frame picker behavior.

### Manual QA

Before considering MVP done:

- Create Frame in desktop app.
- Import image from Finder.
- See thumbnail in grid.
- Open Fragment detail.
- Install extension locally.
- Click extension on a regular image-heavy page.
- Save one image into Frame.
- Confirm it appears in desktop app after refresh/focus.
- Confirm original image exists on disk.
- Confirm thumbnail exists on disk.
- Confirm source URL is stored.
- Confirm app does not open/focus for every save.

---

## 19. Definition of done for MVP

The MVP is done when a user can:

1. Launch Fragment on macOS.
2. Create a Frame.
3. Import local images as Fragments.
4. Browse Fragments in a fast grid.
5. Open a Fragment detail panel.
6. Install/load the Chrome extension in developer mode.
7. Click the extension icon on a visual webpage.
8. See overlay buttons on detected images.
9. Save a selected image as a Fragment into a Frame.
10. See the saved Fragment in the local desktop app.
11. Quit/relaunch the app and retain all data locally.

---

## 20. Current defaults

Unless the user explicitly changes direction, assume:

- App name: Fragment.
- Company/brand: Auto Scale Agency.
- Initial platform: macOS.
- Stack: Tauri v2 + Rust + React + TypeScript.
- Storage: SQLite + local app data folder.
- Browser: Chrome first.
- Extension communication: Native Messaging for production.
- Deep links: navigation/pairing only.
- Cloud sync: not in MVP.
- AI: not in MVP.
- Product vocabulary: Frame and Fragment.
