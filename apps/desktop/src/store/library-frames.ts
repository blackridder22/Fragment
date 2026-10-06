import type { Frame } from "@fragment/shared";
import type {
  FragmentFilter,
  SmartFrame,
} from "../features/filters/filter-model";
import { filterWithLibraryControls } from "../features/filters/filter-model";
import {
  descendantFrameIds,
  resolveFrameDrop,
  sortFrames,
  type FrameDropTarget,
} from "../features/frames/frame-tree";
import { createSelectionState } from "../features/selection/selection-model";
import {
  createFrame,
  createSmartFrame,
  deleteFrame,
  deleteSmartFrame,
  moveFrame,
  renameFrame,
  restoreFrame,
  updateSmartFrame,
} from "../lib/tauri";
import {
  closeFrameModal,
  expandFrame,
  selectFrame,
  selectSmartFrame,
} from "./library-actions";
import { refreshSnapshot } from "./library-bootstrap";
import { confirmAction, reportError, showToast } from "./library-feedback";
import { libraryLoader } from "./library-loader";
import { pruneFramePreviewsByFrame } from "./library-previews";
import {
  isProtectedFrame,
  pluralize,
  selectDeleteRetentionDays,
  selectRecursiveCounts,
} from "./library-selectors";
import { libraryStore } from "./library-store";
import { offerUndo } from "./library-undo";

const { getState, setState } = libraryStore;

export function patchFrame(updated: Frame) {
  setState((state) => ({
    frames: state.frames.map((frame) =>
      frame.id === updated.id ? updated : frame,
    ),
    trashedFrames: state.trashedFrames.map((frame) =>
      frame.id === updated.id ? updated : frame,
    ),
  }));
}

export function deletePolicyLabel(policy = getState().deletePolicy) {
  return policy === "forever"
    ? "delete forever"
    : `move to Trash for ${policy} days`;
}

export async function submitFrameModal(name: string) {
  const state = getState();
  const modal = state.frameModal;
  if (!modal) return;
  if (modal.mode === "rename") {
    closeFrameModal();
    await renameFrameAction(modal.frame, name);
    return;
  }
  const parentId = modal.parentId;
  const created = await createFrame(name, parentId);
  setState((current) => ({
    frames: [...current.frames, created],
    frameCounts: { ...current.frameCounts, [created.id]: 0 },
  }));
  if (parentId) expandFrame(parentId);
  closeFrameModal();
  selectFrame(created.id);
  showToast(`Created Frame “${created.name}”`, { tone: "success" });
}

export async function renameFrameAction(frame: Frame, name: string) {
  if (isProtectedFrame(getState(), frame)) {
    showToast("Inbox is a protected Frame.", { tone: "error" });
    return;
  }
  try {
    const updated = await renameFrame(frame.id, name);
    patchFrame(updated);
    showToast(`Renamed Frame to ${updated.name}`, { tone: "success" });
  } catch (caught) {
    reportError(caught);
    showToast("Frame rename failed", { tone: "error" });
  }
}

/** Applies a drop placement locally so the tree updates without a refetch. */
export function applyFramePlacement(
  frames: Frame[],
  moved: Frame,
  parentId: string | null,
  position: number,
): Frame[] {
  const siblings = sortFrames(
    frames.filter(
      (frame) => frame.parentId === parentId && frame.id !== moved.id,
    ),
  );
  const index = Math.max(0, Math.min(position, siblings.length));
  siblings.splice(index, 0, { ...moved, parentId });
  const bySibling = new Map(
    siblings.map((frame, sortOrder) => [frame.id, { ...frame, sortOrder }]),
  );
  return frames.map((frame) => bySibling.get(frame.id) ?? frame);
}

export async function moveFrameAction(
  frameId: string,
  target: FrameDropTarget,
) {
  const state = getState();
  const placement = resolveFrameDrop(state.frames, frameId, target);
  if (!placement) {
    showToast(
      "A Frame cannot move inside itself or one of its nested Frames.",
      {
        tone: "error",
      },
    );
    return;
  }
  const moving = state.frames.find((frame) => frame.id === frameId);
  if (!moving) return;
  const updated = await moveFrame(
    frameId,
    placement.parentId,
    placement.position,
  );
  setState((current) => ({
    frames: applyFramePlacement(
      current.frames,
      { ...moving, ...updated },
      placement.parentId,
      placement.position,
    ),
  }));
  if (placement.parentId) expandFrame(placement.parentId);
  const parentName = placement.parentId
    ? state.frames.find((frame) => frame.id === placement.parentId)?.name
    : null;
  showToast(
    parentName
      ? `Moved ${moving.name} into ${parentName}`
      : `Moved ${moving.name} to the Vault root`,
    { tone: "success" },
  );
}

export async function moveFrameToTrash(frameId: string): Promise<boolean> {
  const state = getState();
  if (state.undoPending) {
    showToast("Wait for Undo to finish");
    return false;
  }
  const frame = state.frames.find((item) => item.id === frameId);
  if (!frame) return false;
  if (isProtectedFrame(state, frame)) {
    showToast("Inbox is a protected Frame.", { tone: "error" });
    return false;
  }
  const forever = state.deletePolicy === "forever";
  const count = selectRecursiveCounts(state).get(frame.id) ?? 0;
  const confirmed = await confirmAction({
    title: forever
      ? `Delete “${frame.name}” forever?`
      : `Move “${frame.name}” to Trash?`,
    message: `${count > 0 ? `Its ${pluralize(count, "Fragment")} ${count === 1 ? "goes" : "go"} with it. ` : ""}${
      forever
        ? "This cannot be undone."
        : `Items stay recoverable in Trash for ${state.deletePolicy} days.`
    }`,
    confirmLabel: forever ? "Delete forever" : "Move to Trash",
    destructive: true,
  });
  if (!confirmed) return false;
  await deleteFrame(frame.id, selectDeleteRetentionDays(state));
  const removedIds = new Set(descendantFrameIds(state.frames, frame.id));
  const removedFrames = state.frames.filter((item) => removedIds.has(item.id));
  const removedCounts = Object.fromEntries(
    removedFrames.map((item) => [item.id, state.frameCounts[item.id] ?? 0]),
  );
  setState((current) => {
    const frameCounts = { ...current.frameCounts };
    for (const id of removedIds) delete frameCounts[id];
    const items = current.activePage.items.filter(
      (fragment) => !removedIds.has(fragment.frameId),
    );
    const removedLoaded = current.activePage.items.length - items.length;
    const total = Math.max(
      items.length,
      current.activePage.total - Math.max(count, removedLoaded),
    );
    return {
      frames: current.frames.filter((item) => !removedIds.has(item.id)),
      frameCounts,
      coverFragments: current.coverFragments.filter(
        (fragment) => !removedIds.has(fragment.frameId),
      ),
      ...pruneFramePreviewsByFrame(current, removedIds),
      activePage: {
        ...current.activePage,
        items,
        total,
        hasMore: items.length < total,
      },
      trashPage: { ...current.trashPage, key: null },
      trashTotal: forever ? current.trashTotal : current.trashTotal + count,
      selectedFrameId:
        current.selectedFrameId && removedIds.has(current.selectedFrameId)
          ? null
          : current.selectedFrameId,
      selection: createSelectionState(),
      focused:
        current.focused && removedIds.has(current.focused.fragment.frameId)
          ? null
          : current.focused,
    };
  });
  if (forever) {
    showToast(`Deleted Frame “${frame.name}”`, { tone: "success" });
  } else {
    offerUndo(
      {
        kind: "frame",
        frameId: frame.id,
        frames: removedFrames,
        counts: removedCounts,
      },
      `${frame.name} moved to Trash`,
    );
  }
  return true;
}

/** Restores a Frame from the Trash page; counts come back with a snapshot refresh. */
export async function restoreTrashedFrame(frame: Frame) {
  if (frame.id.startsWith("demo-")) return;
  await restoreFrame(frame.id);
  setState((current) => ({
    trashedFrames: current.trashedFrames.filter((item) => item.id !== frame.id),
  }));
  await refreshSnapshot(true);
  libraryLoader.invalidate("trash");
  showToast(`Restored ${frame.name}`, { tone: "success" });
}

export async function saveSmartFrame(name: string, filter: FragmentFilter) {
  const state = getState();
  const saved = filterWithLibraryControls(
    filter,
    state.query,
    state.sourceFilter,
  );
  try {
    const smartFrame = await createSmartFrame(name, saved);
    setState((current) => ({
      smartFrames: [...current.smartFrames, smartFrame],
    }));
    showToast(`Smart Frame “${smartFrame.name}” saved`, { tone: "success" });
    selectSmartFrame(smartFrame);
  } catch (caught) {
    reportError(caught);
    showToast("Smart Frame could not be saved", { tone: "error" });
    throw caught;
  }
}

export async function saveSelectedSmartFrame(
  id: string,
  name: string,
  filter: FragmentFilter,
) {
  const state = getState();
  const saved = filterWithLibraryControls(
    filter,
    state.query,
    state.sourceFilter,
  );
  try {
    const updated = await updateSmartFrame(id, name, saved);
    setState((current) => ({
      smartFrames: current.smartFrames.map((item) =>
        item.id === updated.id ? updated : item,
      ),
    }));
    showToast(`Smart Frame “${updated.name}” updated`, { tone: "success" });
    selectSmartFrame(updated);
  } catch (caught) {
    reportError(caught);
    showToast("Smart Frame could not be updated", { tone: "error" });
    throw caught;
  }
}

export async function removeSmartFrame(smartFrame: SmartFrame) {
  const confirmed = await confirmAction({
    title: `Delete Smart Frame “${smartFrame.name}”?`,
    message: "No Fragments will be deleted.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await deleteSmartFrame(smartFrame.id);
    setState((current) => ({
      smartFrames: current.smartFrames.filter(
        (item) => item.id !== smartFrame.id,
      ),
    }));
    if (getState().selectedSmartFrameId === smartFrame.id) selectFrame(null);
    showToast(`Smart Frame “${smartFrame.name}” deleted`, { tone: "success" });
  } catch (caught) {
    reportError(caught);
    showToast("Smart Frame could not be deleted", { tone: "error" });
  }
}
