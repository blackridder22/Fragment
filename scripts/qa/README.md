# Native media QA

These hooks are for disposable QA builds only. They are not imported by the
shipping frontend or registered by its Tauri shell. Use a temporary Vault and
separate bundle identity; never seed or downgrade the user's Vault.

## Backend reproduction

Build the release host and the `media_benchmark`, `raster_benchmark`,
`media_qa_corpus`, and `seed_media_qa` examples. SVG processing needs the host at
its supported lookup path (a sibling `fragment-host` is sufficient). Each example
shows positional arguments in its source; use absolute empty output roots when
required by its guard.

- `media_benchmark`: palette/SVG/import and 10,000-row SQLite measurements.
- `raster_benchmark`: portable identical harness for frozen .7 and current .8.
- `media_qa_corpus`: creates 1,000 unique actual images for native browsing QA.
- `seed_media_qa`: imports the corpus; `mixed` selects 100 SVGs with 900 PNGs;
  omit it for matching .7 PNG equivalents.
- `node scripts/media-host-smoke.mjs <host> <report.json>`: isolated HTTP/native
  protocol/persistence tests, including child crash and slow capture.

Metadata-scale harnesses are not native UI performance tests.

## Native frame-time recording

1. Copy the frozen baseline and current source into separate disposable folders.
2. Copy `native-metrics.js` into each frontend and import it from `main.tsx`.
3. Copy `native_metrics.rs` into each Tauri source directory, declare the module,
   and register `native_metrics::qa_record_metrics` in the command handler.
4. Run with `FRAGMENT_APP_DATA_DIR` set to each isolated QA Vault. Permit that
   exact root in the asset protocol. Skip host-manifest installation in the QA
   source copy to preserve the user's Chrome host setup.
5. Build each frontend before its native binary. Keep the shipping artifacts
   separate from these instrumented builds.
6. Match foreground window size, display, theme, Masonry density and 1,000-item
   scope. Press Control+Option+Shift+M, then scroll for 30 seconds.
7. Read `logs/qa-*-scroll-*.json` in that Vault: raw frame intervals, window/DPR,
   visibility, elapsed time and version. Repeat three times per condition and
   record the actual gestures and whether backfill stayed active throughout.

Use actual native UI interactions. Discard hidden/interrupted recordings. Do not
substitute browser mocks, synthetic wheel dispatch or backend timings. Retain
raw samples and report p95/max beside the baseline.

Memory is a separate native gate: navigate through 100 distinct SVGs twice,
measure the app and attributable WebView processes, and compare the retained
plateau after each cycle. Worker RSS alone does not satisfy it.

See `docs/V0.0.8_QA.md` for evidence. The hooks and real 1,000-asset Vaults are
prepared; native frame-time and retained-memory measurements remain unverified
because the macOS automation session did not reliably capture/control windows.

## Frames gallery harness (browser, worktree 20)

`apps/desktop/qa/gallery-harness.html` fakes the Tauri IPC bridge with a
1,000-item Vault so the Frames gallery can be measured in any Chromium
browser against the Vite dev server. It is never shipped: it lives outside
`src/`, is not an entry of `vite build`, and the thumbnails it needs are
generated and git-ignored.

```sh
python3 scripts/qa/gallery-harness-thumbs.py        # 36 PNGs incl. 3:1 and 1:3 shapes
cd apps/desktop && pnpm exec vite --port 5180 --strictPort
open http://127.0.0.1:5180/qa/gallery-harness.html  # ?count=1000&latency=20&fail=page
```

Open the Frames page, then in DevTools count `document.querySelectorAll(".fragment-card").length`
while scrolling. For before/after numbers run the headless driver against each
build (it loads all pages, then scrolls continuously for 30 s per run and
samples `requestAnimationFrame` intervals, mounted cards, layout shift and long
tasks in Chromium via the repo's Playwright devDependency):

```sh
node scripts/qa/gallery-scroll-benchmark.mjs http://127.0.0.1:5180/qa/gallery-harness.html 3 30 after
```

Numbers from this harness are Chromium numbers; the native WebKit recording
above remains the release gate.
