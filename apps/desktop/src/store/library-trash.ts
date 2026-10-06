import type { Fragment, Frame } from "@fragment/shared";
import { filterWithLibraryControls } from "../features/filters/filter-model";
import { descendantFrameIds } from "../features/frames/frame-tree";
import {
  movePreviewItemsToTrash,
  purgePreviewItems,
  purgePreviewTrash,
  restorePreviewItems,
} from "../features/trash/preview-trash-state";
import {
  deleteFragmentsForever,
  deleteFramesForever,
  emptyTrashNow,
  moveFragmentsBackToTrash,
  moveFrameBackToTrash,
  restoreFragmentsNow,
  restoreFramesWithUniqueNames,
  tauriTrashBackend,
  type EmptyTrashSummary,
  type FrameDeleteReport,
  type FrameRestoreReport,
  type RetrashFragment,
  type RetrashFrame,
} from "../features/trash/trash-actions";
import { listFragmentIds } from "../lib/tauri";
import { selectDemoTrashedFragments } from "./demo-library";
import { refreshSnapshot, rememberLibraryRevision } from "./library-bootstrap";
import { reportError, showToast } from "./library-feedback";
import {
  adjustFrameCounts,
  removeFragmentsFromTrashPage,
} from "./library-fragments";
import { currentPageKey, libraryLoader } from "./library-loader";
import { selectTrashRetention } from "./library-selectors";
import { createPageState, libraryStore } from "./library-store";
import type { ToastTone } from "./library-types";
import { offerUndo } from "./library-undo";

/*
 * Trash page actions. Each one is a backend call followed by a local patch of
 * the loaded Trash page and the sidebar counts; the page itself owns the
 * confirm dialog and asks for feedback through `notifyFromTrash`.
 */

const { getState, setState } = libraryStore;

/** Feedback the Trash page asks for once an action completed. */
export type TrashToast = {
  label: string;
  tone?: ToastTone;
  /** Offered as the toast's Undo action when the action is reversible. */
  undo?: { run: () => Promise<void>; doneLabel: string };
};

export function notifyFromTrash(toast: TrashToast) {
  if (getState().undoPending) return;
  if (toast.undo) {
    offerUndo(
      { kind: "custom", run: toast.undo.run, doneLabel: toast.undo.doneLabel },
      toast.label,
    );
    return;
  }
  showToast(toast.label, { tone: toast.tone ?? "success" });
}

/** Records a failed Trash action; the dialog shows the message, the library resyncs. */
export function reportTrashActionFailure(caught: unknown) {
  reportError(caught);
  void refreshSnapshot();
}

function isDemoId(id: string) {
  return id.startsWith("demo-");
}

function dropFocused(ids: ReadonlySet<string>) {
  setState((current) =>
    current.focused && ids.has(current.focused.fragment.id)
      ? { focused: null }
      : {},
  );
}

/**
 * After a Frame-level change (restore, hard delete, re-trash) the tree, the
 * counts, the Trash total and the revision come from one snapshot, and the
 * Trash page reloads once through the loader: the snapshot marks a loaded
 * page stale, which the loader picks up on its own; a page that was never
 * loaded is invalidated here so the next visit cannot show stale rows.
 */
async function resyncAfterFrameChange() {
  try {
    await refreshSnapshot(true);
  } catch {
    // Already reported by refreshSnapshot; the action itself succeeded.
  }
  const page = getState().trashPage;
  if (page.key === null && !page.loading) libraryLoader.invalidate("trash");
}

/**
 * Restores Fragments with one call and patches the loaded page: rows leave
 * the Trash list, the Trash total drops once, their Frames count them again.
 */
export async function restoreTrashedFragments(ids: string[]): Promise<string[]> {
  const state = getState();
  if (state.previewMode) {
    const demoIds = ids.filter(isDemoId);
    setState((current) => ({
      previewTrashState: restorePreviewItems(current.previewTrashState, demoIds),
    }));
    return demoIds;
  }
  setState({ error: null });
  const realIds = await restoreFragmentsNow(tauriTrashBackend, ids);
  if (realIds.length === 0) return realIds;
  const idSet = new Set(realIds);
  const restored = getState().trashPage.items.filter((fragment) =>
    idSet.has(fragment.id),
  );
  removeFragmentsFromTrashPage(idSet);
  const deltas: Record<string, number> = {};
  for (const fragment of restored) {
    deltas[fragment.frameId] = (deltas[fragment.frameId] ?? 0) + 1;
  }
  adjustFrameCounts(deltas);
  setState((current) => ({
    coverFragments: [...restored, ...current.coverFragments],
  }));
  dropFocused(idSet);
  libraryLoader.invalidate("active");
  if (restored.length < realIds.length) {
    // Restore all can include rows that were never loaded; their Frame counts
    // come from one snapshot, which also records the revision.
    await refreshSnapshot(true);
  } else {
    await rememberLibraryRevision();
  }
  return realIds;
}

export async function deleteTrashedFragmentsNow(
  ids: string[],
): Promise<string[]> {
  const state = getState();
  if (state.previewMode) {
    const demoIds = ids.filter(isDemoId);
    setState((current) => ({
      previewTrashState: purgePreviewItems(current.previewTrashState, demoIds),
    }));
    return demoIds;
  }
  setState({ error: null });
  const realIds = await deleteFragmentsForever(tauriTrashBackend, ids);
  if (realIds.length === 0) return realIds;
  const idSet = new Set(realIds);
  removeFragmentsFromTrashPage(idSet);
  dropFocused(idSet);
  await rememberLibraryRevision();
  return realIds;
}

/**
 * Restores Frames one by one against one accumulating sibling list, then
 * refreshes once. Failures are returned, not thrown, so the page can keep
 * them in its dialog for a retry while toasting what did complete.
 */
export async function restoreTrashedFrames(
  frames: Frame[],
): Promise<FrameRestoreReport> {
  const state = getState();
  const real = frames.filter((frame) => !isDemoId(frame.id));
  if (state.previewMode || real.length === 0) {
    return {
      restored: real.map((frame) => ({ frame, renamedFrom: null })),
      failed: [],
    };
  }
  setState({ error: null });
  const report = await restoreFramesWithUniqueNames(
    tauriTrashBackend,
    real,
    state.frames,
  );
  if (report.restored.length > 0) {
    const restoredIds = new Set(report.restored.map((item) => item.frame.id));
    setState((current) => ({
      trashedFrames: current.trashedFrames.filter(
        (frame) => !restoredIds.has(frame.id),
      ),
    }));
    await resyncAfterFrameChange();
  }
  return report;
}

export async function deleteTrashedFramesNow(
  frames: Frame[],
): Promise<FrameDeleteReport> {
  const state = getState();
  const real = frames.filter((frame) => !isDemoId(frame.id));
  if (state.previewMode || real.length === 0) {
    return { deleted: real, failed: [] };
  }
  setState({ error: null });
  const report = await deleteFramesForever(tauriTrashBackend, real);
  if (report.deleted.length > 0) {
    const deletedIds = new Set(report.deleted.map((frame) => frame.id));
    setState((current) => ({
      trashedFrames: current.trashedFrames.filter(
        (frame) => !deletedIds.has(frame.id),
      ),
    }));
    // `hard_delete_frame` also removes the tree's Fragments that were trashed
    // on their own. Trashed descendants are not listed (only tree roots are),
    // so those rows and the Trash total cannot be patched locally: the
    // snapshot brings the total and the loader reloads the page.
    await resyncAfterFrameChange();
  }
  return report;
}

export async function emptyTrashAction(): Promise<EmptyTrashSummary> {
  const state = getState();
  if (state.undoPending) {
    throw new Error("Wait for Undo to finish before emptying the Trash");
  }
  if (state.previewMode) {
    const removed = selectDemoTrashedFragments(state).length;
    setState((current) => ({
      previewTrashState: purgePreviewTrash(current.previewTrashState),
      focused: null,
    }));
    return { fragments: removed, frames: 0 };
  }
  setState({ error: null });
  const summary = await emptyTrashNow(tauriTrashBackend);
  setState((current) => ({
    trashPage: { ...createPageState(), key: currentPageKey(current, "trash") },
    trashedFrames: [],
    trashedFramesLoaded: true,
    trashTotal: 0,
    focused: null,
  }));
  await rememberLibraryRevision();
  return summary;
}

/** Undo of a Fragment restore: the rows go back with the days they had left. */
export async function retrashFragments(
  entries: RetrashFragment[],
): Promise<void> {
  const state = getState();
  if (state.previewMode) {
    setState((current) => ({
      previewTrashState: movePreviewItemsToTrash(
        current.previewTrashState,
        entries.map((entry) => entry.id),
      ),
    }));
    return;
  }
  setState({ error: null });
  await moveFragmentsBackToTrash(
    tauriTrashBackend,
    entries,
    selectTrashRetention(state),
  );
  await resyncAfterFrameChange();
}

/** Undo of a Frame restore: renamed Frames get their name back first. */
export async function retrashFrames(entries: RetrashFrame[]): Promise<void> {
  const state = getState();
  if (state.previewMode || entries.length === 0) return;
  setState({ error: null });
  const retention = selectTrashRetention(state);
  for (const entry of entries) {
    await moveFrameBackToTrash(tauriTrashBackend, entry, retention);
  }
  const trashedIds = new Set(
    entries.flatMap((entry) =>
      descendantFrameIds(getState().frames, entry.frame.id),
    ),
  );
  setState((current) => ({
    selectedFrameId:
      current.selectedFrameId && trashedIds.has(current.selectedFrameId)
        ? null
        : current.selectedFrameId,
  }));
  await resyncAfterFrameChange();
}

/** Every trashed Fragment id matching the Trash page's filters, for Restore all. */
export function listAllTrashedFragmentIds(): Promise<string[]> {
  const state = getState();
  if (state.previewMode) {
    return Promise.resolve(
      selectDemoTrashedFragments(state).map((fragment: Fragment) => fragment.id),
    );
  }
  return listFragmentIds({
    expectedPaletteRevision: state.fragmentFilter.color
      ? state.trashPage.paletteRevision
      : null,
    trashed: true,
    query: state.query,
    sourceFilter: state.sourceFilter,
    filter: filterWithLibraryControls(
      state.fragmentFilter,
      state.query,
      state.sourceFilter,
    ),
    sortMode: state.sortMode,
  });
}
