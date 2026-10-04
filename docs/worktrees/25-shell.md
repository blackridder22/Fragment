# Worktree 25 — Shell: sidebar, Frame tree, window bar, menus (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`.

## Branch and PR

- Create `wt/25-shell` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-25: shell"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/DesktopShell.tsx`, `apps/desktop/src/v7/SelectionActionBar.tsx`,
`features/frames/**` (`CreateFrameModal.tsx`, `frame-tree.ts`), `features/dragdrop/**`,
`styles/v7-shell.css`, `styles/v7-modal.css`, and their tests.

## Why

The Add and Sort menus never close on outside click (the shell registers no document listener).
The Forward button is permanently disabled because no history exists. The Frame tree has no inline
rename or context menu, and the active rail does not move. The window bar's search has no clear
button or scope indicator. Sidebar hover currently repaints the gallery (fixed by the foundation's
memoization; verify it stays fixed).

## Tasks

1. Menus. Add and Sort menus close on outside click, Esc and focus-out; arrow keys move between
   items; the first item receives focus on open; menus flip when near the window edge.
2. Navigation history. Implement a real back/forward stack over view + Frame + filter state in the
   store (max 50 entries); Cmd+[ and Cmd+] mirror the buttons; Forward enables when available.
3. Frame tree. Inline rename (double-click or F2, Enter saves, Esc cancels), context menu on a row
   (New sub-Frame, Rename, Move to Trash, Reveal in Finder for the Frame's originals folder is out of
   scope), drag to reorder and reparent with clear before/inside/after indicators, chevron rotates
   over `--dur-fast`, expanded state persists (it already does), counts come from recursive totals,
   Inbox is marked as the system Frame and cannot be renamed or trashed.
4. Active rail. The selected-row indicator slides between rows with a transform over `--dur-base`
   and `--ease-out` instead of re-mounting; reduced motion disables the slide.
5. Window bar. Search gets a clear button, a scope hint ("in Posters" when a Frame is selected), and
   Cmd+K focus as today; traffic-light spacing respects the Tauri overlay position (16, 26) at the
   960x680 minimum and when maximized; the drag region covers the whole bar except controls.
6. Selection action bar. Enters and exits with a 12 px slide and fade over `--dur-base`; shows the
   count with correct vocabulary ("3 Fragments"); Move to Frame and Add tag panels close on outside click.
7. Create Frame modal. Uses the foundation's tokens, traps focus, validates empty and duplicate names
   inline, and reports success through the Toast.

## Acceptance

- Menus and panels never stay open after clicking elsewhere (manual check on every menu in the shell).
- Back/Forward traverse at least five navigation steps correctly, including a filter change.
- React Profiler: hovering sidebar rows or opening a menu does not re-render the gallery.
- Tree operations round-trip: rename, reorder, reparent and trash each produce the right backend call
  (one `invoke` each on the perf flag) and the right Toast.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `frame-tree` tests extended; new tests for the
  history stack and menu keyboard handling.

## Out of scope

Gallery layout, preview, settings content, Rust.
