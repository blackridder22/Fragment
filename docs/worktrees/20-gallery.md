# Worktree 20 — Frames gallery page (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`; the store, loader, toast, motion
tokens and perf flag you rely on come from it.

## Branch and PR

- Create `wt/20-gallery` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-20: gallery"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/FrameGallery.tsx`, `apps/desktop/src/v7/FramesPage.tsx`,
`apps/desktop/src/v7/PaginationFooter.tsx`, the gallery part of `styles/v7-gallery.css`
(`.v7-frame-*`, `.v7-masonry-*`, `.v7-frames-page`, filters), `features/filters/**`,
`features/colors/ColorFilterControl.tsx`, `features/selection/**`, and their tests.
Not `VaultPage.tsx` (worktree 22) and not the store (ask via PR comment if a selector is missing).

## Why

The masonry assigns heights from a fixed pattern (`PAPER_MASONRY_HEIGHTS`) by column index and
crops every image with `object-fit: cover`, so a reference vault never shows the real shape of an
image. Columns fill by index modulo, not shortest column. Nothing is virtualized, so after ten pages
600 image nodes stay mounted. Native scroll frame time has never been measured.

## Tasks

1. Real masonry. Compute each card's height from `fragment.width / fragment.height` at the column
   width (fall back to 4:3 when unknown). Place items shortest-column-first, stable across page
   appends (new items only append; existing positions never change). Set the box size with CSS
   `aspect-ratio` so layout is final before the image loads: zero layout shift. Images are shown
   whole in masonry (`object-fit: contain` is unnecessary when the box matches the ratio). Grid view
   keeps uniform cells and may crop; say so in a tooltip or label.
2. Virtualize. Window the masonry and grid on the `.v7-frames-page` scroll container with about one
   viewport of overscan so at most ~150 cards are mounted at any time. Keep working: shift-click
   selection, marquee (`useMarqueeSelection` reads DOM rects, so it must select among mounted cards
   and fall back to id ranges for unmounted ones), pointer drag to Frames and Trash, context menu,
   keyboard Left/Right/Enter/Space, Select All (query-based, already independent of the DOM),
   infinite load through `PaginationFooter`.
3. Loading experience. Cards render their box immediately with a neutral tone (the existing
   `toneFor` palette), `loading="lazy"` and `decoding="async"` stay, image fades in over
   `--dur-base` with `--ease-out` on load. Stretch: if the store exposes a dominant palette color
   per item, use it as the placeholder background.
4. Filters. Keep the existing pills and popovers but make them feel instant: no debounce on clicks
   (the loader handles it), active-filter chips with one-click clear, result count updates in the
   page bar, "Clear filters" visible whenever any filter is active. Color filter stays.
5. Motion (transform and opacity only, tokens from `tokens.css`, reduced motion respected):
   card hover lifts 2 px and scales the image to 1.02 over `--dur-base`; selection indicator pops in
   with `--ease-spring` over `--dur-base`; newly appended page items fade in with a 20 ms stagger
   capped at 8 items; nothing animates layout in a virtualized list.
6. Empty and error states: no Fragments in this Frame, no matches for filters (with clear action),
   page load failed (with retry). Copy uses Fragment for images and Frame for collections.

## Acceptance

- Scroll test on a 1,000-item isolated Vault (`media_qa_corpus` + `seed_media_qa`, see
  `scripts/qa/README.md`), perf flag frame sampler on, 30 s of continuous trackpad scrolling,
  three runs each before and after: p95 frame interval <= 20 ms, zero intervals > 100 ms after.
  Report all three runs.
- Mounted `.fragment-card` count never exceeds 150 at 1,000 items (count in DevTools).
- Zero layout shift when images load (visual check with the Rendering panel's Layout Shift Regions).
- Images are never cropped in masonry; a 3:1 panorama and a 1:3 portrait from the fixtures both show whole.
- Selection, marquee, drag, context menu and keyboard navigation all still work in a manual smoke; the
  `selection-model` and `useMarqueeSelection` tests pass plus new tests for masonry placement and windowing math.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.

## Out of scope

Vault home page, preview overlay, sidebar, Rust.
