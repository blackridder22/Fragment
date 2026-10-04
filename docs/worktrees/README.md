# v0.0.9 worktree plan

Eight worktrees improve Fragment one surface at a time. Each prompt file in this folder is
self-contained: paste it into the agent that owns that worktree. All agents read
`AGENTS.md` and `docs/V0.0.9_DIAGNOSIS.md` first.

## Branches

- `main` and `vbeta0.0.8` point at the v0.0.8 release commit. Nobody pushes to `main`.
- `test-main` is cut from that same commit. Every worktree PR targets `test-main`.
- Worktree branches are named `wt/NN-<slug>` as listed below.
- GitHub's default branch is still `vbeta0.0.3`, so always pass `--base test-main` explicitly.

## Waves

Wave 1 runs first and in parallel. Wave 2 starts only after `wt/00-foundation` is merged into
`test-main`, because it changes App.tsx, the store, the page props and the CSS files every page uses.

| Wave | Branch | Prompt | Owns |
| --- | --- | --- | --- |
| 1 | `wt/00-foundation` | `00-foundation.md` | App.tsx split, store, loader, dead code/CSS, vocabulary, toast, confirm dialog, motion tokens, perf flag |
| 1 | `wt/10-core-derivatives` | `10-core-derivatives.md` | Rust: WebP/JPEG derivatives, regeneration, palette loop backoff, resize throttle, release profile |
| 2 | `wt/20-gallery` | `20-gallery.md` | Frames gallery page: real masonry, virtualization, filters, card motion |
| 2 | `wt/21-preview` | `21-preview.md` | Focused preview overlay: progressive image, prefetch, open/close motion, details panel |
| 2 | `wt/22-vault-home` | `22-vault-home.md` | Your Vault home page: folder cards, recently added, empty state |
| 2 | `wt/23-trash` | `23-trash.md` | Trash page |
| 2 | `wt/24-settings` | `24-settings.md` | Settings page and shortcuts |
| 2 | `wt/25-shell` | `25-shell.md` | Sidebar, Frame tree, window bar, menus, search, history, selection bar |

## Ownership rule

Only the owning worktree edits its files. If a change outside your files is unavoidable, keep it
minimal, isolate it in its own commit, and call it out in the PR under "Touches outside my scope".
Do not rename or move component files in wave 2; wave 1 already removed the dead ones.

## Setup for every agent

```sh
git fetch origin
git worktree add ../fragment-wt-NN -b wt/NN-<slug> origin/test-main
cd ../fragment-wt-NN && pnpm install
```

Run the desktop app with an isolated Vault, never the real one:

```sh
mkdir -p /tmp/fragment-qa-vault
FRAGMENT_APP_DATA_DIR=/tmp/fragment-qa-vault pnpm dev:desktop
```

## Definition of done for a PR

1. Scope in the prompt is complete, or the PR says exactly what was left out and why.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. `cargo fmt --all -- --check`,
   `cargo clippy --workspace --all-targets --all-features -- -D warnings` and
   `cargo test --workspace` pass when Rust changed.
3. Before/after numbers for the prompt's acceptance metrics, with the exact command or steps,
   in the PR body. No performance claim without a number.
4. Vocabulary check: Frame = collection, Fragment = saved image, Vault = library. No Pin/Board.
5. No cloud, analytics, AI, scraping, or new broad permissions. Local-first stays intact.
6. PR opened with `gh pr create --base test-main --title "wt-NN: <summary>"`.

## Review and merge

The reviewer (the planning session) reviews each PR for correctness, scope and measurements,
requests changes on the PR, and merges approved PRs into `test-main` in this order:
00, 10, then 20 to 25 (each rebased on the current `test-main` first). The author then builds
`test-main` locally (`pnpm dev:desktop` or `pnpm release:local`) and decides what goes to `main`.
