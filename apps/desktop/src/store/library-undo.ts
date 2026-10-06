import { restorePreviewItems } from "../features/trash/preview-trash-state";
import { deleteFragments, restoreFrame, restoreFragments } from "../lib/tauri";
import { refreshSnapshot } from "./library-bootstrap";
import { reportError, setToastPending, showToast } from "./library-feedback";
import { pluralize } from "./library-selectors";
import { libraryStore } from "./library-store";
import type { UndoEntry } from "./library-types";

const { getState, setState } = libraryStore;

/**
 * Shows a success toast whose Undo action reverts `entry`. The entry is
 * reachable only through that toast, so showToast/dismissToast clear it
 * when the toast is replaced or dismissed.
 */
export function offerUndo(entry: UndoEntry, label: string) {
  if (getState().undoPending) return;
  showToast(label, {
    tone: "success",
    action: { label: "Undo", onAction: undoLastAction },
  });
  setState({ undo: entry });
}

function applyFragmentsRestored(
  undo: Extract<UndoEntry, { kind: "fragments" }>,
) {
  setState((state) => {
    const page = state.activePage;
    let items = page.items;
    let key = page.key;
    if (key !== null && key === undo.pageKey) {
      items = [...items];
      for (const entry of [...undo.removed].sort((a, b) => a.index - b.index)) {
        items.splice(Math.min(entry.index, items.length), 0, entry.fragment);
      }
    } else {
      key = null;
    }
    const total = page.total + undo.ids.length;
    const frameCounts = { ...state.frameCounts };
    for (const { fragment } of undo.removed) {
      frameCounts[fragment.frameId] = (frameCounts[fragment.frameId] ?? 0) + 1;
    }
    return {
      activePage: { ...page, key, items, total, hasMore: items.length < total },
      trashPage: { ...state.trashPage, key: null },
      trashTotal: Math.max(0, state.trashTotal - undo.ids.length),
      frameCounts,
      coverFragments: [
        ...undo.removed.map((entry) => entry.fragment),
        ...state.coverFragments,
      ],
    };
  });
}

function applyFrameRestored(undo: Extract<UndoEntry, { kind: "frame" }>) {
  setState((state) => {
    const existing = new Set(state.frames.map((frame) => frame.id));
    const restoredCount = Object.values(undo.counts).reduce(
      (sum, n) => sum + n,
      0,
    );
    return {
      frames: [
        ...state.frames,
        ...undo.frames.filter((frame) => !existing.has(frame.id)),
      ],
      frameCounts: { ...state.frameCounts, ...undo.counts },
      trashTotal: Math.max(0, state.trashTotal - restoredCount),
      trashedFrames: state.trashedFrames.filter(
        (frame) => frame.id !== undo.frameId,
      ),
      activePage: { ...state.activePage, key: null },
      trashPage: { ...state.trashPage, key: null },
    };
  });
}

function applyLinksRemoved(undo: Extract<UndoEntry, { kind: "linked" }>) {
  const ids = new Set(undo.ids);
  setState((state) => {
    const removed = state.activePage.items.filter((fragment) =>
      ids.has(fragment.id),
    );
    const items = state.activePage.items.filter(
      (fragment) => !ids.has(fragment.id),
    );
    const total = Math.max(items.length, state.activePage.total - ids.size);
    const frameCounts = { ...state.frameCounts };
    for (const fragment of [
      ...removed,
      ...state.coverFragments.filter(
        (fragment) => ids.has(fragment.id) && !removed.includes(fragment),
      ),
    ]) {
      frameCounts[fragment.frameId] = Math.max(
        0,
        (frameCounts[fragment.frameId] ?? 0) - 1,
      );
    }
    return {
      activePage: {
        ...state.activePage,
        items,
        total,
        hasMore: items.length < total,
      },
      coverFragments: state.coverFragments.filter(
        (fragment) => !ids.has(fragment.id),
      ),
      frameCounts,
    };
  });
}

export async function undoLastAction() {
  const state = getState();
  const undo = state.undo;
  if (!undo || state.undoPending) return;
  const toastId = state.toast?.id;
  if (state.previewMode && undo.kind === "fragments") {
    setState((current) => ({
      previewTrashState: restorePreviewItems(
        current.previewTrashState,
        undo.ids,
      ),
      undo: null,
      toast: null,
    }));
    showToast(`Restored ${pluralize(undo.ids.length, "Fragment")}`, {
      tone: "success",
    });
    return;
  }
  const successLabel =
    undo.kind === "custom"
      ? undo.doneLabel
      : undo.kind === "frame"
        ? "Restored Frame"
        : undo.kind === "linked"
          ? `Removed ${pluralize(undo.ids.length, "linked Fragment")}`
          : `Restored ${pluralize(undo.ids.length, "Fragment")}`;
  setState({ undoPending: true, error: null });
  if (toastId !== undefined) {
    setToastPending(
      toastId,
      true,
      undo.kind === "custom" ? "Undoing…" : "Restoring…",
    );
  }
  try {
    if (undo.kind === "custom") {
      // The Trash page's own actions patch the library themselves.
      await undo.run();
    } else if (undo.kind === "fragments") {
      await restoreFragments(undo.ids);
      applyFragmentsRestored(undo);
    } else if (undo.kind === "frame") {
      await restoreFrame(undo.frameId);
      applyFrameRestored(undo);
    } else {
      if (undo.ids.length > 0) await deleteFragments(undo.ids, 0);
      applyLinksRemoved(undo);
    }
    setState({ undoPending: false, undo: null, toast: null });
    showToast(successLabel, { tone: "success" });
  } catch (caught) {
    setState({ undoPending: false, undo: null, toast: null });
    reportError(caught);
    showToast("Undo failed · Try again", { tone: "error" });
    await refreshSnapshot();
  }
}
