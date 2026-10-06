# Architecture

Fragment is a macOS-first, local-first visual reference Vault. Version 0.0.8 is
developed on branch `vbeta0.0.8`.

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
replaceable caches.

### Derivative format (v0.0.9)

Raster derivatives are lossy WebP encoded with libwebp (`webp` crate):
thumbnails fit 640 px at quality 82, previews fit 1600 px at quality 85, and
the alpha plane is kept lossless so transparent PNG sources stay transparent.
Opaque sources are encoded without an alpha plane. WKWebView on macOS 11+
decodes WebP natively.

Why: v0.0.8 wrote lossless PNG. On the author's 169-item Vault thumbnails were
median 273 KB (p90 439 KB) and previews median 1.3 MB (p90 2.3 MB), so one
60-item gallery page moved ~16 MB and the previews folder was 2.4x the size of
the originals. Re-encoding 12 real thumbnails gave PNG 2.99 MB -> WebP q82
0.37 MB (8.2x); one 1600x702 preview went 1.39 MB -> 175 KB.

Decoding applies the EXIF orientation (`decode_oriented`), so thumbnails,
previews and the stored `width`/`height` describe the image as WebKit displays
the original.

No preview file is written when the original's longest edge is <= 1600 px, the
format is browser-displayable (JPEG, PNG, WebP, GIF) and the file carries no
EXIF orientation. `preview_path` then equals `original_path`; the desktop asset
candidate chain deduplicates the two. A rotated or flipped original always gets
a generated, oriented preview (not upscaled), because WebKit would apply the
orientation to the original while the thumbnail is built from oriented pixels,
and the two must agree.

SVG tiers (`svg.rs`, `previews.rs`) stay PNG. tiny-skia emits exact
straight-alpha PNG, vector art is mostly flat colour where PNG is already
small, lossy encoding would ring on crisp edges, and the private worker
protocol and release verification check PNG magic. Converting them would mean
decoding and re-encoding every tier in the parent for little gain.

`assets.derivatives_version` (migration 0006) records the policy an asset was
written with: 1 = PNG, 2 = WebP with the skip rule. `derivative_jobs.rs` runs
one background worker, started by the desktop shell about 3 s after launch, that
leases assets below the current version (active Fragments first, Trash last),
decodes the original outside the SQLite lock, writes the new files atomically
to `temp/derivatives/<asset>.<lease token>.<tier>.webp`, then, inside one
transaction that first re-checks the lease, renames them into `thumbnails/`
and `previews/`, updates paths and version for the asset and its memberships,
queues the old files in `pending_file_deletions` with `deferred_until_relaunch = 1`
(migration 0007), and commits. A worker whose lease expired is refused at that
re-check and removes only its own staging files, so it can never delete or
overwrite what the live lease holder committed; the desktop shell clears
leftover staging files at launch. The old files are not
removed by the process that replaced them: the WebView only refetches paths on
focus, so a card or preview could still be showing them. The desktop shell
sweeps the deferred rows at its next launch (`sweep_deferred_file_deletions`,
run by the regeneration worker before anything else), when every view has
loaded the new paths. The regular cleanup pass used by hard deletes and Trash
purges skips deferred rows, and the native host never sweeps them. A crash at
any point leaves a browsable Vault. Leases expire after 120 s, three failed
attempts mark the job `failed`, and the worker pauses while an import or
preview holds a foreground permit. `derivatives_status` reports
`{ pending, done, failed }`; `retry_failed_derivatives` returns the number of
jobs it reset.

Upgrade note (v0.0.9). Regeneration is driven only by `derivatives_version`;
nothing checks whether the files a row points at exist. Once migration 0006 has
run and regeneration has completed, the old `thumbnails/*.png` and
`previews/*.png` files are deleted at the following launch. Restoring a
database backup taken before v0.0.9 then points every asset at those deleted
PNG files, and the gallery falls back to the originals until regeneration
catches up: the restored database has no `derivatives_version` column, so
migration 0006 runs again, marks every asset version 1, and the worker rewrites
all WebP derivatives from the untouched originals on that launch. A backup
taken after migration 0006 is different: assets it records at version 2 are
assumed current, so if their WebP files are missing (backup restored into a
different Vault folder, derivative folders deleted by hand) they are not
regenerated. Originals are never modified by any of this.

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

Vault home (desktop):

```txt
load_library_snapshot (shared) -> frames, counts, newest page
list_frame_previews            -> three latest active Fragments per top-level Frame,
                                  nested Frames included, one tile per asset,
                                  one call per library revision
```

The home page reads only those two results: folder collages come from
`list_frame_previews` so a Frame whose Fragments fall outside the first page still
shows real tiles, and "Recently added" is a bounded slice of the snapshot page.
Nothing on the home page paginates. The previews live in the store
(`store/library-previews.ts`): they are fetched once per `revision` while the home
page is visible, patched locally by the same writes that patch the snapshot page
(trash, undo, restore, move, link, import), dropped when a fetch fails, and read
through `selectFolderCovers`, which falls back to the snapshot page per Frame.

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

## Background workers in the desktop shell

The palette worker drains its queue, then sleeps on a `Condvar` until an
import completes, a palette is retried, a priority or Frame changes, or the
window regains focus, with a 30 s fallback poll for captures written by the
native host process. It pauses while a foreground import or preview runs.

The derivative regeneration worker starts about 3 s after launch, parks on its
own `Condvar` once nothing is pending, and emits `derivatives-changed` with the
regenerated asset IDs. The `retry_failed_derivatives` command resets terminal
failures and wakes it, so a retry never needs a relaunch. Both workers stop on
`ExitRequested`.

macOS window-control realignment (`window_chrome.rs`) runs immediately on focus
and theme changes; `Resized` events are coalesced into one refresh 150 ms after
the last event so a resize drag no longer forces a synchronous redraw per tick.

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

## v0.0.8 media pipeline

`media.rs` detects raster signatures or bounded UTF-8 SVG input. Desktop imports
and host captures call the same preparation path. A SHA-256 hit reuses the
existing asset before decoding. Raster files receive 640/1600 WebP derivatives
(see "Derivative format"); SVG files receive transparent 640/1600 PNG tiers;
original bytes and nominal dimensions are retained unchanged.

`fragment-host --render-svg` is a private child process, entered before Vault
initialization. `svg_worker.rs` owns a five-second deadline, cancellation,
kill/reap and staging cleanup. One child plus eight queued requests are allowed
per process. Two foreground preparation permits cover imports and previews.
`svg.rs` applies the static resource policy before resvg 0.48.1 rendering.

Migration 0005 adds asset-owned palettes, palette job leases, optional preview
cache metadata, SVG diagnostics and a separate palette revision. Migration
performs no image decoding. Palette extraction uses an alpha-weighted 256-edge
sample of the canonical thumbnail, deterministic Oklab clustering and at most
six colors. Missing old palettes are processed after first display, with
25-item batches, current item/Frame priority and at most three automatic
attempts. Image work occurs outside SQLite transactions.

Color filters use a bound SQLite EXISTS predicate before pagination. Page,
count and Select All share it. A swatch must cover at least 1% of visible area;
HEX is canonical `#RRGGBB`, and tolerance 0–200 means Oklab distance ×1000.
Color pages carry a separate palette revision. New completions offer Refresh
instead of resetting gallery position or mixing pages from different results.

Focused SVG previews use PNG file URLs. Fit/100/200/400% requests are debounced
and coalesced; obsolete consumers cancel work. Optional 3200/4096 previews have
a 512 MiB LRU budget and two tiers per asset. Keys include source hash, renderer
policy and font fingerprint. Base files and originals are never evicted.
Last-reference deletion queues optional files before cascading cache rows.

`FRAGMENT_APP_DATA_DIR` supports isolated QA Vaults. Asset-protocol access is
scoped to the configured root; QA launches do not rewrite Chrome's installed
native-host manifest. See `V0.0.8_QA.md` for measured verification boundaries.
