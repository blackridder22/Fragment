# Architecture

Fragment is split into four parts:

- `crates/fragment-core`: shared Rust domain library for paths, SQLite,
  migrations, Frame and Fragment operations, image import, URL capture,
  hashing, thumbnails, and preview assets.
- `apps/desktop`: Tauri v2 desktop app with React UI. Tauri commands call
  `fragment-core`; the frontend never writes directly to the filesystem or DB.
- `crates/fragment-host`: Chrome Native Messaging host. It speaks Chrome's
  length-prefixed JSON protocol and delegates all persistence to
  `fragment-core`.
- `apps/extension`: Manifest V3 extension. It injects Capture Mode into the
  active tab, detects candidate images, shows isolated overlays, lists Frames
  through the native host, and sends user-selected capture requests.

## Storage

SQLite stores metadata only. Originals, thumbnails, and previews live under the
local Fragment app data root. Paths in SQLite are relative to the app data root
when possible.

Default macOS path:

```txt
~/Library/Application Support/Fragment/
  fragment.db
  originals/
  thumbnails/
  previews/
  temp/
  logs/
```

Originals preserve the detected source format. Derived thumbnails and previews
are PNG files for the MVP to keep Tauri/WebKit preview rendering reliable.

## Data Flow

Desktop import:

```txt
React UI -> Tauri command -> fragment-core -> SQLite + local files
```

Browser capture:

```txt
Chrome action -> content overlay -> service worker -> Native Messaging host
  -> fragment-core -> SQLite + local files -> overlay saved/error state
```

The desktop app refreshes on focus so background captures appear without forcing
the app to open or focus on every save.
