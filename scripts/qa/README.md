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

## Focused preview timing (wt-21)

`preview-perf-harness.js` drives the focused preview from inside the WebView so
no console or OS automation is needed. Import it from `main.tsx` in a QA source
copy, then run with `VITE_FRAGMENT_QA=1 VITE_FRAGMENT_PERF=1 DEBUG=vite:time` and
`FRAGMENT_APP_DATA_DIR` pointing at an empty QA Vault. Drop one command at a time
into `apps/desktop/public/qa-commands.json` (`seed`, `measure-open`,
`measure-nav`, `memory-cycle`; see the file header). Results arrive as
`/favicon.svg?p=<json>` lines in the Vite debug output. Sample the
`com.apple.WebKit.WebContent` process that appeared with the app using
`footprint <pid>` during `memory-cycle` for the retained-memory gate. Remove the
import and the command file afterwards; neither is shipped.
