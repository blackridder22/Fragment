# Worktree 21 — Focused preview overlay (wave 2)

You are working in a git worktree of Fragment by Auto Scale Agency (Tauri v2 + Rust + React 19 +
TypeScript). Read `AGENTS.md`, `docs/V0.0.9_DIAGNOSIS.md` and `docs/worktrees/README.md` first.
Start only after `wt/00-foundation` is merged into `test-main`.

## Branch and PR

- Create `wt/21-preview` from `origin/test-main`. Never push to `main`.
- Open the PR with `gh pr create --base test-main --title "wt-21: preview overlay"`.
- PR body: what changed, before/after table for every acceptance metric with the command used,
  checks run, what was left out, anything touched outside this scope.

## You own

`apps/desktop/src/v7/FocusedFrameOverlay.tsx`, `features/fragments/SvgPreview.tsx`,
`features/fragments/FragmentContextMenu.tsx` (overlay layer behaviour), `features/colors/PaletteSection.tsx`,
`features/colors/useFragmentPalette.ts`, `features/tags/**`, `styles/v7-preview.css`,
`styles/colors-svg.css`, and their tests.

## Why

Opening a Fragment loads a 1600 px preview (today a 1.3 to 3.8 MB PNG; WebP after worktree 10) with
nothing on screen until it decodes. Arrow-key navigation repeats that with no prefetch. The overlay
mounts with no enter or exit and applies an 8 px `backdrop-filter` over the whole gallery, which is
expensive to animate. The details panel saves silently.

## Tasks

1. Progressive image. Show the already-decoded thumbnail (the gallery has it cached) scaled to the
   stage immediately, then load the preview behind it and cross-fade over `--dur-fast` when it
   decodes. Two stacked `<img>` elements with the box sized from the Fragment's aspect ratio so
   nothing jumps. SVG keeps `SvgPreview` but shows the thumbnail first in the same way.
2. Prefetch neighbours. After the current preview decodes, preload the previous and next previews
   with `new Image()`; cancel on close; keep at most 3 decoded previews alive. Arrow navigation
   should show the next image within one frame.
3. Open and close motion (tokens, reduced motion respected): scrim fades in over `--dur-base`;
   the stage scales 0.96 -> 1 with `--ease-out`; the details panel slides in 12 px from the right.
   Close reverses over `--dur-fast`. Replace the full-screen `backdrop-filter: blur(8px)` with a solid
   76% scrim unless you can show the blur costs nothing on the frame sampler. Stretch: FLIP the image
   from the clicked card's rect when the gallery passes it.
4. Details panel. Title edit inline (Enter saves, Esc cancels), tags with add/remove and known-tag
   suggestions, notes autosave on blur and on Cmd+S with a "Saved" state through the Toast, Frame
   selector moves the Fragment, source row opens the URL, metadata row (dimensions, type, size,
   captured date, site). Palette swatches with copy feedback and "Find this color". Every action
   reports success or failure visibly.
5. Keyboard. Left/Right navigate, Esc closes (or closes an inner editor first), Space toggles quick
   preview as today, Cmd+C copies the image, Cmd+Backspace moves to Trash with the in-app confirm.
   Focus returns to the originating card on close.
6. Raster zoom. Scroll-wheel or pinch zoom and drag-to-pan on raster images, with Fit / 100% toggle,
   mirroring `SvgPreview` controls. Stretch if time allows.

## Acceptance

- Perf flag marks: overlay mount -> first pixels <= 50 ms (thumbnail path); mount -> preview decoded
  <= 300 ms for a local 1600 px WebP; measure 10 opens before and after and report p50/p95.
- Arrow navigation across 20 Fragments shows no blank frame (visual check plus frame sampler, zero
  intervals > 100 ms).
- Memory gate from `docs/V0.0.8_QA.md`: open 100 distinct previews twice; the WebContent process
  plateau after the second cycle is within 50 MB of the first (Activity Monitor). Report both numbers.
- No layout shift when the panel content changes (title edit, tags add, notes grow).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; existing `FocusedFrameOverlay.render.test.tsx`
  updated, new tests for prefetch bookkeeping and keyboard handling.

## Out of scope

Gallery layout, sidebar, Rust, SVG renderer internals.
