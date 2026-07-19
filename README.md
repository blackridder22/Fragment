# Fragment

Fragment by Auto Scale Agency is a macOS-first, local-first visual reference
vault. Users save selected images as **Fragments** inside **Frames**, with
original files and thumbnails stored on disk and metadata stored in SQLite.

The desktop app is a visual vault, not an IDE or file explorer. The primary UI
uses a top command bar, Frame chips/cards, and a masonry Fragment grid inspired
by visual browsing products.

## Stack

- Tauri v2 desktop app
- Rust shared core crate
- React + TypeScript + Vite
- SQLite via `rusqlite`
- Chrome Extension Manifest V3
- Chrome Native Messaging host
- pnpm workspace and Cargo workspace

## Setup

Prerequisites:

- macOS
- Node.js 22+
- pnpm 10+
- Rust 1.96+
- Chrome for extension development

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development:

```bash
pnpm dev:desktop
```

Run Rust tests:

```bash
cargo test
```

Run TypeScript tests:

```bash
pnpm test
```

## Desktop MVP

The desktop app creates an **Inbox** Frame on first launch. It supports visual
Frame browsing, local image import, thumbnail and preview generation, masonry
display, Fragment detail editing, reveal in Finder, and opening Source URLs when
present.

Local data is stored by default at:

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
are PNG files in the MVP so macOS WebKit can render them reliably in the Tauri
webview.

For tests or development isolation, set:

```bash
export FRAGMENT_APP_DATA_DIR=/tmp/fragment-dev
```

## Extension

Build the extension:

```bash
pnpm build:extension
```

Load `apps/extension/dist` as an unpacked extension in Chrome. Clicking the
toolbar icon toggles **Capture Mode** on the active tab. Overlay buttons appear
on detected images, and **Save Fragment** opens an inline Frame picker.

## Native Host

Build the host:

```bash
cargo build --bin fragment-host
```

Install the macOS Native Messaging manifest after loading the extension and
copying its Chrome extension ID:

```bash
scripts/install-native-host-macos.sh <chrome-extension-id>
```

The installer prefers the host bundled inside an installed or locally built
`Fragment.app`, then falls back to a release/debug workspace binary. This keeps
Chrome connected after the source checkout is moved or cleaned.

Uninstall it with:

```bash
scripts/uninstall-native-host-macos.sh
```

Build a complete local app/extension release with checksums and a release
manifest:

```bash
pnpm release:local
```

Artifacts are written under `target/release/artifacts/v<version>/`; the app
bundle remains under `target/release/bundle/macos/Fragment.app`.

## MVP Scope

Included:

- Desktop local Vault
- Default Inbox Frame
- Frame create, rename, delete
- Local image import
- Thumbnail generation
- Masonry Fragment grid
- Fragment detail modal
- Chrome Capture Mode overlay
- Native host `ping`, `frames.list`, and `capture.fragment`
- URL-first web image capture
- SHA-256 duplicate detection

Not included:

- Cloud sync
- Accounts
- Public sharing
- AI features
- Bulk imports or account/profile extraction
- Chrome Web Store production packaging
- Mobile app

## Known Limitations

- Blob, data, and protected image URLs return a clear capture error.
- The first capture flow is URL-first only; screenshot fallback is not included.
- Frame nesting is supported by the data model but not exposed deeply in the UI.
- Extension popup is minimal because the toolbar click is reserved for Capture Mode.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
cargo test
```
