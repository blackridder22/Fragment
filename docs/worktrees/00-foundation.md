# Worktree 00 — Foundation (wave 1, merge first)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript + Vite). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md`
before touching code. This worktree restructures the desktop frontend so the page worktrees in
wave 2 can work in parallel without colliding. It must land before them.

## Branch and PR

- Create `wt/00-foundation` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-00: foundation"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/App.tsx`, new `apps/desktop/src/store/**`, `apps/desktop/src/lib/**`,
`apps/desktop/src/styles/globals.css`, `apps/desktop/src/styles/tokens.css`,
`apps/desktop/src/main.tsx`, new `apps/desktop/src/components/Toast.tsx` and
`ConfirmDialog.tsx`, the test files of anything you change, and every user-facing string under
`apps/desktop/src` for the vocabulary fix. You may change the props contract of the v7 page
components (`apps/desktop/src/v7/*.tsx`) because wave 2 starts from your merged result, but do not
redesign those pages and do not rename or move files you do not delete.

## Tasks

1. Delete dead code. These 19 files are unreachable from `main.tsx`; remove them and their tests:
   `features/frames/FrameNavigator.tsx`, `features/fragments/FragmentInspector.tsx`,
   `features/filters/FilterPanel.tsx`, `features/fragments/FragmentDetailSheet.tsx`,
   `features/settings/SettingsPage.tsx`, `components/FragmentCard.tsx`, `components/FrameCard.tsx`,
   `components/IconRail.tsx`, `features/fragments/FragmentQuickPreview.tsx`,
   `features/selection/SelectionToolbar.tsx`, `components/LoadMoreSentinel.tsx`,
   `features/fragments/fragment-metadata.ts`, `features/frames/FrameBreadcrumbs.tsx`,
   `components/MasonryGrid.tsx`, `components/FrameChipBar.tsx`, `features/trash/TrashedFramesList.tsx`,
   `app/AppShell.tsx`, `lib/format.ts`, `components/EmptyState.tsx`. Re-run a reachability walk
   from `main.tsx` afterwards and confirm nothing else is orphaned. `pnpm typecheck` must pass.
2. Cut dead CSS. 368 of the 562 rules in `styles/globals.css` reference classes no reachable
   component uses. Remove them. Move what remains into `styles/base.css` (resets, typography,
   shared buttons) and page-specific files. Remove the double cascade on `.fragment-card`
   (the live card in `v7/FrameGallery.tsx` reuses that legacy class) and drop every `!important`
   that no longer has a reason. Report CSS bytes from `vite build` before and after.
3. Fix the vocabulary. Frame = collection/folder, Fragment = saved image, Vault = library.
   The v7 UI has these backwards. Fix at least: sidebar tree header "Fragments" -> "Frames";
   Add menu "New Fragment / Create a folder for Frames" -> "New Frame / A collection for your
   Fragments" and "Import Frames / Add images from this Mac" -> "Import Fragments / Add images
   from this Mac"; the primary nav item "Frames" (it lists images) -> "All Fragments"; every count
   or empty state about images ("{n} Frames", "No Frames in your Vault yet", "Untitled Frame",
   "Frames from across your Vault", "Selected n Frames", "Importing n Frames") -> Fragment(s);
   the overlay destination label "Fragment" -> "Frame"; "Smart Fragment" -> "Smart Frame";
   "Renamed Fragment", "Inbox is a protected Fragment", "New nested Fragment", "Rename Fragment"
   -> Frame; `CreateFrameModal` titles; `PaginationFooter` noun default. Add a Vitest that scans
   `apps/desktop/src/**/*.tsx` for the inverted phrases and fails on them. Do not rename component
   files (`FrameGallery`, `V7FrameCard`) in this wave.
4. Extract the state into a store. Create `store/library-store.ts` (zustand is acceptable, or
   `useSyncExternalStore` by hand; selectors are required) holding frames, Smart Frames, tags,
   the active fragment page, the trash page, selection, filters, view, settings and the import
   queue. Pages subscribe through selectors or small hooks, not through 40 props from App.tsx.
   App.tsx becomes a composition root under 400 lines. Fix the render-time side effect
   (`importPathsRef.current = importPaths`) and remove the `Date.parse` sort in `filteredFragments`.
5. One loader. Create `store/library-loader.ts`: a query key `{view, frameId, includeDescendants,
   trashed, filter, sort}` drives page loading; dedupe in-flight requests, cancel stale ones with a
   request id, reset pagination on key change. Debounce only the free-text query (150 ms); filter
   pills, sort, view and Frame selection load immediately. Remove the double fetch (`changeView`
   plus the `activeView` effect), the duplicate first page at launch (snapshot plus effect), the
   duplicate `getFragmentTags` for the same Fragment, and the client-side re-filter/re-sort of
   server pages. Replace `refreshSnapshot` after rename/move/link/tag/restore with targeted patches
   of the store; keep a full refresh only for focus-revision changes and import completion.
6. Stable card props. Precompute `assetSources` and `folderName` per page item in a memoized
   selector keyed by fragment id and asset root. Wrap `V7FrameCard` in `React.memo` and pass
   primitives plus stable callbacks. Hovering a card or showing a toast must not re-render the gallery.
7. Feedback surface. Render the 57 silent `setStatus` messages through a `Toast` component
   (bottom-center, aria-live, auto-dismiss 4 s, one visible at a time, actions allowed for Undo).
   Replace the 7 `window.confirm` calls with an in-app `ConfirmDialog` (focus trapped, Esc cancels,
   destructive button styled).
8. Motion tokens. In `tokens.css` define `--dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 320ms;
   --ease-out: cubic-bezier(0.22, 1, 0.36, 1); --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
   --ease-spring: linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%,
   0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)`.
   Replace hard-coded durations and easings in the live CSS with the tokens. Honor
   `prefers-reduced-motion` and `html[data-reduce-motion="true"]` by setting the duration tokens
   to 0ms instead of the current global `1ms !important` override. Do not add new animations here.
9. Dev perf flag. Create `lib/perf.ts`, enabled when `localStorage["fragment:perf"] === "1"`:
   wrap `invoke` in `lib/tauri.ts` to count calls and log `[perf] invoke <command> <ms>` with a
   resettable counter at `window.__fragmentPerf.invokes`; a requestAnimationFrame sampler started
   with Ctrl+Option+Shift+P (or `__fragmentPerf.startFrames()`) that reports p50/p95/max frame
   interval and the number of intervals over 100 ms; `performance.mark` for module start, first
   snapshot received, first thumbnail `load`, overlay mount and overlay image `load`, logged as
   durations. Zero cost when the flag is off. Document it in `docs/worktrees/README.md`.

## Acceptance

- App.tsx under 400 lines; no component file over 600 lines.
- `invoke` count per interaction, measured with the perf flag on an isolated Vault: switch view 1,
  select Frame 1, click a filter pill 1, change sort 1, open a preview <= 3 (page item is already
  loaded; tags and palette may load). Before numbers are taken on `test-main` first.
- React Profiler with "Highlight updates": hover a card, open a toast, drag over the Trash row.
  The gallery does not repaint.
- CSS from `vite build`: 164 KB raw before; target under 80 KB raw. JS does not grow by more than 5 KB gz.
- Launch -> first thumbnail (perf flag) is not slower than before.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. Tests that only covered deleted files are
  deleted; every other existing test still passes.
- The vocabulary test exists and passes. Manual smoke on an isolated Vault: create Frame, import
  3 images, select, move to Trash, Undo, open preview, edit title, change theme.

## Out of scope

Page redesigns, new animations, Rust changes, the extension.
