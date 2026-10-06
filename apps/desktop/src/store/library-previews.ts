import type { Fragment, Frame } from "@fragment/shared";
import { frameBreadcrumbs } from "../features/frames/frame-tree";
import {
  isTauriRuntime,
  listFramePreviews,
  type FramePreview,
} from "../lib/tauri";
import { FOLDER_PREVIEW_LIMIT } from "../v7/vault-home";
import { reportError } from "./library-feedback";
import { selectShowsHomeDashboard } from "./library-selectors";
import { libraryStore } from "./library-store";
import type { FramePreviews, LibraryState } from "./library-types";

const { getState, setState } = libraryStore;

/**
 * Home-page collage previews: the three latest active Fragments of every
 * top-level Frame, nested Frames included (`list_frame_previews`).
 *
 * The call is made at most once per library revision while the home page is
 * visible. In-app writes patch the loaded previews the same way they patch
 * `coverFragments`, so a Fragment moved to the Trash never lingers in a
 * collage; a new snapshot (new `revision`) refetches them. A failed fetch
 * clears whatever was loaded so collages fall back to the snapshot page
 * instead of showing stale tiles.
 */

/** Revision of the last attempt (success or failure); no retry until it changes. */
let attemptedRevision: string | null = null;
let inFlight: { revision: string; promise: Promise<void> } | null = null;
/** Bumped by every local patch so a response that predates one is dropped. */
let generation = 0;

/** Whether the store needs previews for its current revision. */
export function framePreviewsStale(state: LibraryState) {
  return (
    state.revision !== "" && state.framePreviewsRevision !== state.revision
  );
}

/** Fetches previews for the current revision unless they were already attempted. */
export function refreshFramePreviews(): Promise<void> {
  const state = getState();
  if (!isTauriRuntime() || !framePreviewsStale(state)) {
    return Promise.resolve();
  }
  const { revision } = state;
  if (inFlight?.revision === revision) return inFlight.promise;
  if (attemptedRevision === revision) return Promise.resolve();
  attemptedRevision = revision;
  const startedAt = generation;
  let request: Promise<FramePreview[]>;
  try {
    request = listFramePreviews(FOLDER_PREVIEW_LIMIT);
  } catch (caught) {
    request = Promise.reject(caught);
  }
  const promise = request
    .then((previews) => {
      if (getState().revision !== revision) return;
      if (startedAt !== generation) {
        // A local write raced the read; let the next pass fetch fresh data.
        attemptedRevision = null;
        return;
      }
      const byFrame: Record<string, readonly Fragment[]> = {};
      for (const preview of previews) {
        byFrame[preview.frameId] = preview.fragments;
      }
      setState({ framePreviews: byFrame, framePreviewsRevision: revision });
    })
    .catch((caught) => {
      // Never keep previews from an older revision: they may include
      // Fragments trashed since. Collages fall back to the snapshot page.
      setState({ framePreviews: null, framePreviewsRevision: null });
      reportError(caught);
    })
    .finally(() => {
      if (inFlight?.revision === revision) inFlight = null;
    });
  inFlight = { revision, promise };
  return promise;
}

/** Side-effect hook: fetch whenever the home dashboard shows a stale revision. */
export function syncFramePreviews(state: LibraryState) {
  if (selectShowsHomeDashboard(state) && framePreviewsStale(state)) {
    void refreshFramePreviews();
  }
}

/** Test-only: forgets the attempted revision and any in-flight request. */
export function resetFramePreviewLoader() {
  attemptedRevision = null;
  inFlight = null;
  generation = 0;
}

function dedupeKey(fragment: Fragment) {
  return fragment.assetId ?? fragment.id;
}

function compareNewestFirst(left: Fragment, right: Fragment) {
  return (
    right.capturedAt.localeCompare(left.capturedAt) ||
    right.id.localeCompare(left.id)
  );
}

/** Top-level ancestor id of `frameId`, or the id itself when it is a root. */
function rootFrameId(frames: Frame[], frameId: string) {
  return frameBreadcrumbs(frames, frameId)[0]?.id ?? frameId;
}

type PreviewPatch = Pick<LibraryState, "framePreviews">;

/** Drops the given Fragments from every collage. Same reference when untouched. */
export function pruneFramePreviews(
  state: LibraryState,
  ids: ReadonlySet<string>,
): PreviewPatch {
  const previews = state.framePreviews;
  if (!previews || ids.size === 0) return { framePreviews: previews };
  let changed = false;
  const next: Record<string, readonly Fragment[]> = {};
  for (const [frameId, fragments] of Object.entries(previews)) {
    const kept = fragments.filter((fragment) => !ids.has(fragment.id));
    if (kept.length !== fragments.length) changed = true;
    if (kept.length > 0) next[frameId] = kept;
  }
  if (!changed) return { framePreviews: previews };
  generation += 1;
  return { framePreviews: next };
}

/** Drops the collages of trashed Frames and any Fragment that lived in them. */
export function pruneFramePreviewsByFrame(
  state: LibraryState,
  frameIds: ReadonlySet<string>,
): PreviewPatch {
  const previews = state.framePreviews;
  if (!previews || frameIds.size === 0) return { framePreviews: previews };
  let changed = false;
  const next: Record<string, readonly Fragment[]> = {};
  for (const [frameId, fragments] of Object.entries(previews)) {
    if (frameIds.has(frameId)) {
      changed = true;
      continue;
    }
    const kept = fragments.filter(
      (fragment) => !frameIds.has(fragment.frameId),
    );
    if (kept.length !== fragments.length) changed = true;
    if (kept.length > 0) next[frameId] = kept;
  }
  if (!changed) return { framePreviews: previews };
  generation += 1;
  return { framePreviews: next };
}

/** Swaps in the latest copy of a Fragment (title edits, moves). */
export function replaceFramePreviewFragment(
  state: LibraryState,
  updated: Fragment,
): PreviewPatch {
  const previews = state.framePreviews;
  if (!previews) return { framePreviews: previews };
  const previousRoot = Object.entries(previews).find(([, fragments]) =>
    fragments.some((fragment) => fragment.id === updated.id),
  );
  if (!previousRoot) return { framePreviews: previews };
  const nextRoot = rootFrameId(state.frames, updated.frameId);
  if (previousRoot[0] === nextRoot) {
    generation += 1;
    return {
      framePreviews: {
        ...previews,
        [nextRoot]: previousRoot[1].map((fragment) =>
          fragment.id === updated.id ? updated : fragment,
        ),
      },
    };
  }
  // Moved under another top-level Frame: leave the old collage, join the new one.
  const pruned = pruneFramePreviews(state, new Set([updated.id]));
  return insertFramePreviewFragments(
    { ...state, framePreviews: pruned.framePreviews },
    [updated],
  );
}

/**
 * Adds Fragments to the collage of their top-level Frame, newest first, one
 * tile per asset, trimmed to the collage size. Because the loaded previews
 * are the exact latest items, sorting them with the newcomers and trimming
 * gives the exact answer without another read.
 */
export function insertFramePreviewFragments(
  state: LibraryState,
  fragments: readonly Fragment[],
): PreviewPatch {
  const previews = state.framePreviews;
  if (!previews || fragments.length === 0) return { framePreviews: previews };
  const next: Record<string, readonly Fragment[]> = { ...previews };
  let changed = false;
  for (const fragment of fragments) {
    const root = rootFrameId(state.frames, fragment.frameId);
    const current = next[root] ?? [];
    if (current.some((item) => item.id === fragment.id)) continue;
    const seen = new Set<string>();
    const merged = [fragment, ...current]
      .sort(compareNewestFirst)
      .filter((item) => {
        const key = dedupeKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, FOLDER_PREVIEW_LIMIT);
    if (
      merged.length === current.length &&
      merged.every((item, index) => item === current[index])
    ) {
      continue;
    }
    next[root] = merged;
    changed = true;
  }
  if (!changed) return { framePreviews: previews };
  generation += 1;
  return { framePreviews: next };
}
