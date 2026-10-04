# Worktree 23 — Trash page (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`.

## Branch and PR

- Create `wt/23-trash` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-23: trash"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/TrashPage.tsx`, `features/trash/**`, the trash half of
`styles/v7-settings-trash.css` (split it into `styles/v7-trash.css`; leave the settings half for
worktree 24 and coordinate the split in a tiny first commit each), and their tests.

## Why

Trash mixes Frames and Fragments with limited feedback, restore and empty flows use native
`window.confirm` (replaced by the foundation's `ConfirmDialog`, which you must adopt), and the
retention policy is only explained in a footer string. Rows appear and disappear without motion,
so Undo and Restore feel abrupt.

## Tasks

1. Structure. Two clearly separated sections, Frames and Fragments, each with its own count, sort
   (deleted newest/oldest), and selection. Each row or card shows "Deletes in N days" from
   `deleteAfter`, or "Deleted forever on empty" when retention is off.
2. Actions. Restore (single, multi, all in section), Delete now (single, multi), Empty Trash, each
   through `ConfirmDialog` with the exact count and the consequence, each reporting through the
   Toast with Undo where reversible (restore can be undone by re-trashing within the toast window).
   Frame restore conflicts (name already exists) show the resolved name.
3. Consistency with the gallery. Shift-click, marquee and keyboard selection behave as in the
   gallery; the `SelectionActionBar` shows Restore and Delete now in Trash scope. Color filter stays.
4. Motion (tokens, reduced motion respected): restored or deleted rows collapse height and fade over
   `--dur-base`; the Empty Trash button pulses once when the trash first becomes non-empty in a
   session; nothing animates on initial load.
5. Copy: Frame for collections, Fragment for images; retention text mirrors the Settings choice.

## Acceptance

- Every destructive action requires the in-app confirm and produces a visible Toast; no `window.confirm` remains.
- Restoring 50 selected Fragments from a 1,000-item isolated Vault completes with one Toast and at most
  3 `invoke` calls (perf flag), and the page does not reload the whole list.
- Frame-level restore and Fragment-level restore both update counts in the sidebar immediately.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; existing `TrashPage` tests updated; new tests for
  the retention label and section sort.

## Out of scope

Gallery, preview, settings content, Rust.
