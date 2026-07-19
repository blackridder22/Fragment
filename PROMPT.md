# Fragment Build Prompt

Fragment by Auto Scale Agency is a macOS-first, local-first visual reference
vault. Users save selected images as Fragments inside Frames.

Current build target:

- Tauri v2 desktop app.
- React + TypeScript + Vite frontend.
- Rust `fragment-core` shared domain crate.
- Rust `fragment-host` Chrome Native Messaging host.
- SQLite metadata with originals and thumbnails stored on disk.
- Chrome Manifest V3 extension with user-directed Capture Mode.

The desktop UI must be visual-first: masonry grids, Frame chips/cards, floating
actions, and modal/sheet details. Do not build a VS Code-style Frame tree as the
primary navigation.
