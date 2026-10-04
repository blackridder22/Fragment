# Worktree 22 — Your Vault home page (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`.

## Branch and PR

- Create `wt/22-vault-home` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-22: vault home"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/VaultPage.tsx`, the `.v7-vault-*` and `.v7-folder-*` rules in
`styles/v7-gallery.css` (move them to a new `styles/v7-vault.css`), and their tests. If you need
per-Frame preview items from the backend, add one small read-only Tauri command
(`list_frame_previews`, three latest active Fragments per top-level Frame) in
`apps/desktop/src-tauri/src/commands.rs` plus its `fragment-core` query, isolated in its own commit
and called out in the PR; do not touch other Rust.

## Why

The home page shows only `frames.slice(0, 4)` folder cards with no sign that more exist; folder
collages are built from whatever happens to be in the first loaded page, so Frames outside it show
empty tiles; "Recently added" is an infinite list in hand-weighted rows of 3 and 4 that crop images.
The page is the first thing a user sees and currently makes the Vault look smaller and emptier than it is.

## Tasks

1. Purpose. The home page answers "what do I have and what did I add lately" in one screen with no
   infinite scroll. Two sections: Frames (all top-level Frames) and Recently added (a bounded set).
2. Frames section. Show every top-level Frame as a folder card with a real collage of its three
   latest Fragments and its recursive count; wrap to as many rows as needed, or show the first 8
   with a "Show all Frames" expander that reveals the rest inline. Clicking opens the Frame in the
   gallery. Drop targets for Fragment drags stay. Inbox is visually marked as the system Frame.
3. Recently added. The latest 12 to 24 Fragments from the whole Vault, laid out with the same real
   aspect-ratio masonry component that worktree 20 builds (import it; if it has not merged yet, use a
   simple fixed-height row that shows images whole with `object-fit: contain` and note it in the PR).
   "Browse all" opens the All Fragments gallery. No pagination here.
4. Empty Vault. A single clear state for a brand-new Vault: what Frames and Fragments are, an
   Import button, and a pointer to Capture Mode setup in Settings. Replace the current one-line message.
5. Motion (tokens, reduced motion respected): folder cards lift 2 px on hover over `--dur-base`;
   first paint staggers folder cards and recent items by 20 ms, capped at 8; nothing animates on data refresh.
6. Copy: Frame for collections, Fragment for images ("{n} Fragments" under a folder card, "Fragments
   from across your Vault"). Counts use the recursive totals from the store.

## Acceptance

- Launch -> home painted (perf flag: first snapshot received and first thumbnail load) is not slower
  than before; report both numbers before and after.
- The home page issues at most 2 `invoke` calls beyond the shared snapshot (perf flag counter).
- All top-level Frames are reachable from the home page on a Vault with 12 top-level Frames (seed one).
- Collages show each Frame's latest Fragments even when none of them is in the first gallery page.
- No infinite scroll on the home page; "Browse all" navigates to the gallery with the Vault scope.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass with tests for the row/collage selection logic.

## Out of scope

Gallery internals, preview overlay, sidebar, other Rust.
