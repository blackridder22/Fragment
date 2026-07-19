# Changelog

All notable changes to Fragment are documented here.

## [0.0.3] - In progress

### Added

- Pinned Node 24.18.0, pnpm 10.20.0, and Rust 1.96.0 development toolchains.
- A synchronized application-version command for package, Cargo, Tauri, and
  extension manifests.
- A real ESLint flat configuration for repository TypeScript, TSX, and scripts.
- Deterministic synthetic Vault metadata fixtures for 60, 1,000, and 10,000
  Fragment memberships, plus an in-memory metadata benchmark.
- A macOS clean-checkout CI workflow covering JavaScript, Rust, extension, and
  desktop frontend quality gates.

### Changed

- Capture documentation now describes multi-Frame requests and plural response
  IDs while preserving legacy single-Frame compatibility fields.
- Architecture documentation distinguishes stored assets from per-Frame
  Fragment memberships and records current Trash/version semantics.
- The v0.0.3 roadmap and implementation plan now use the same release scope and
  quality gates.

### In development

- Transactional shared-asset, duplicate, Trash, Restore, and retention behavior.
- Paginated startup data, reliable asset delivery, and background import jobs.
- Compact UIX, complete selection semantics, motion, themes, and accessibility.
- Production native-host packaging and protocol compatibility checks.
