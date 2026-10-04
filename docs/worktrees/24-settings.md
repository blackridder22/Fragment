# Worktree 24 — Settings and shortcuts (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`.

## Branch and PR

- Create `wt/24-settings` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-24: settings"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/SettingsPage.tsx`, `apps/desktop/src/v7/settings-state.ts`,
`features/shortcuts/**`, `features/library/KeyboardShortcutsHelp.tsx`, the settings half of
`styles/v7-settings-trash.css` (split into `styles/v7-settings.css`; coordinate the split with
worktree 23 in a tiny first commit each), and their tests.

## Why

Settings is a 708-line page that mixes app behaviour, capture, appearance and diagnostics in one
scroll, with controls that re-render the whole page on each toggle. The native-host status offers no
fix steps when it fails, palette indexing progress is a raw string, and the shortcuts editor has
limited validation. Reduce motion sets a global `!important` override that the foundation replaces with tokens.

## Tasks

1. Information architecture. Left rail or segmented sections: General (import destination, delete
   policy, refresh on focus), Library (Vault location with Reveal, derivative regeneration progress
   from worktree 10's `derivatives_status` if present, palette indexing progress with a pause toggle,
   storage summary: originals / thumbnails / previews bytes), Capture (native host status, re-check,
   exact fix steps when not ready: open Chrome, load the extension, run the installer), Appearance
   (theme, reduce motion, density defaults), Keyboard (editable shortcuts with conflict detection and
   reset), About (version, release notes link, licenses).
2. Controls. One `Switch`, `SegmentedControl`, `Select` and `ShortcutField` component set with
   macOS-like proportions, focus rings and labels; every row has a label and a one-line description.
3. Performance. Each toggle re-renders only its row (selectors from the store; verify with the React
   Profiler). The page issues at most 2 `invoke` calls on open (host status and index status); the
   host probe spawns a process, so run it on demand and on open, not on every render.
4. Shortcuts. Capture key combos, reject system-reserved and duplicate bindings with inline reasons,
   show the help sheet (`KeyboardShortcutsHelp`) from a "Show all shortcuts" link, keep `?` working.
5. Motion (tokens, reduced motion respected): switches slide the knob over `--dur-fast` with
   `--ease-out`; section changes cross-fade over `--dur-fast`; the status pill pulses once while checking.
6. Copy: Frame for collections, Fragment for images; "Capture destination chooses one or more
   destination Frames"; no Pin or Board.

## Acceptance

- React Profiler: toggling Reduce motion or changing the delete policy commits at most 3 components.
- Open Settings: at most 2 `invoke` calls (perf flag).
- Every persisted setting survives relaunch on an isolated Vault (theme, delete policy, destination,
  refresh on focus, reduce motion, shortcuts).
- Native host "not ready" state shows actionable steps and a working Re-check.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `settings-state` and `shortcut-model` tests
  extended for new fields and conflict detection.

## Out of scope

Gallery, preview, sidebar, Rust beyond reading existing commands.
