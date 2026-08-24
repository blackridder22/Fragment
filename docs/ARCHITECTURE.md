# Architecture

Fragment is a macOS-first, local-first visual reference Vault. Version 0.0.7 is
developed on branch `vbeta0.0.7`.

## Runtime components

- `crates/fragment-core`: Rust domain library for paths, SQLite, migrations,
  Frames, Fragment memberships, assets, import, capture, hashing, thumbnails,
  previews, and Trash behavior.
- `apps/desktop`: Tauri v2 shell and React UI. Tauri commands call
  `fragment-core`; React never writes directly to SQLite or the Vault.
- `crates/fragment-host`: Chrome Native Messaging host. It implements Chrome's
  length-prefixed JSON transport and delegates persistence to `fragment-core`.
- `apps/extension`: Manifest V3 extension. It detects credible image
  candidates, presents isolated user-directed capture controls, lists Frames,
  and sends capture requests through the native host.
- `packages/shared`: TypeScript domain and protocol types shared by the desktop
  app and extension.

## Assets and Fragment memberships

An asset is the stored image. It owns the original, thumbnail, preview,
SHA-256, MIME type, dimensions, and file size. The `assets.sha256` value is
unique when present.

A row in `fragments` is a membership between one asset and one Frame. It owns
Frame-specific metadata and lifecycle state, including title, note,
`deleted_at`, and `delete_after`.

```txt
assets (one stored image)
  1
  +-- fragments (membership in Frame A)
  +-- fragments (membership in Frame B)
```

Capturing or importing the same bytes into another Frame reuses the asset and
creates another membership. It must not copy the original or derived files.
The release invariant is one active membership for each
`(frame_id, asset_id)` pair.

Removing a Fragment from one Frame affects that membership only. Delete
Everywhere targets every membership for the asset. Asset files may be purged
only after no active or retained membership references them.

## Trash semantics

Trash is lifecycle state, not a second copy of an image. A retained membership
has `deleted_at` and `delete_after`; Restore clears both fields. Supported
retention choices are 7, 14, 24, or 31 days, plus Delete Forever. The v0.0.7
product default is 31 days.

Frame Trash, restart-safe expiry purge, and atomic Delete Everywhere are
implemented and covered by core tests.

## Frame hierarchy and navigation

`frames.parent_id` expresses a Frame tree and `sort_order` expresses order among
siblings. The Vault is a virtual root rather than a database row. Inbox is the
protected system Frame used by capture and imports when no destination is
chosen; it stays at the Vault root but may contain user-created Sub-frames.

Frame moves are transactional. The core rejects attempts to move Inbox, move a
Frame into itself, or create a parent/descendant cycle. Moving a Frame rewrites
both source and destination sibling order.

The desktop Frame Navigator derives the visible tree from the flat Frame list.
Expand state, Quick Access pins, width, collapsed state, and the recursive-view
preference are local UI preferences. Frame search keeps matching Frames and
their ancestors visible. Breadcrumbs expose the current path.

Fragment listing stays paginated. When **Include Sub-frame Fragments** is on,
the core uses a recursive Frame CTE for page and selection-ID queries; otherwise
queries remain scoped to the selected Frame only. Snapshot `frame_counts` are
direct counts, while the UI derives recursive totals from the Frame tree.

## Storage

SQLite stores metadata only. Originals, thumbnails, and previews live under the
local Fragment app-data root. Stored paths are relative to this root whenever
possible.

```txt
~/Library/Application Support/Fragment/
  fragment.db
  originals/
  thumbnails/
  previews/
  temp/
  logs/
```

Originals are the source of truth. Derived thumbnails and previews are
replaceable caches and remain PNG during v0.0.7 for transparent-image and
macOS WebKit reliability.

## Data flow

Desktop import:

```txt
React UI -> Tauri command -> fragment-core -> SQLite + local files
```

Browser capture:

```txt
User capture action -> content overlay -> service worker -> native host
  -> fragment-core -> one asset + one or more memberships -> overlay result
```

Production capture uses Native Messaging. On macOS, the desktop app makes a
best-effort startup attempt to create or repair Chrome's native-host manifest
so it points to the bundled `fragment-host` and permits the packaged extension
origin. Setup failure is non-fatal and is surfaced through diagnostics and the
Settings status. The manual installer script remains available as a repair and
development fallback. The localhost bridge is a development tool only.

## Version semantics

- Product packages, Tauri configuration, Cargo packages, and extension
  manifests use the same application version. Run `pnpm version:set -- <x.y.z>`
  to update them together.
- `extensionVersion` in a capture request identifies the sending extension
  build; it is not a negotiated protocol revision.
- `pong.version` identifies the running native host build.
- Native Messaging negotiates protocol version `2` with minimum compatible
  version `1`. The extension and desktop readiness probe both reject a host
  whose supported range does not overlap their own; version-1 clients remain
  compatible during the v0.0.7 transition.

## Performance fixtures

`scripts/vault-fixture-lib.mjs` creates deterministic synthetic metadata for
60, 1,000, and 10,000 Fragment memberships. It uses fixed timestamps,
generated relative paths, and reserved `.invalid` URLs. It never reads a user
database, Vault, image, or source URL.

```bash
pnpm benchmark:vault:fixtures:verify
pnpm benchmark:vault:fixtures
pnpm benchmark:vault:metadata
```
