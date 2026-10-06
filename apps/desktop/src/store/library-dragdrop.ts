import type { PointerDragPayload } from "../features/dragdrop/usePointerDragSession";
import type { FrameDropTarget } from "../features/frames/frame-tree";
import { reportError, setLibraryError, showToast } from "./library-feedback";
import {
  linkFragmentsToFrame,
  moveFragmentsToTrash,
} from "./library-fragments";
import { moveFrameAction, moveFrameToTrash } from "./library-frames";
import {
  isLibraryView,
  isProtectedFrame,
  pluralize,
  selectActiveCards,
  selectFolderCovers,
  selectSelectedIdSet,
  selectSelectedIds,
} from "./library-selectors";
import { libraryStore } from "./library-store";

const { getState, setState } = libraryStore;

export function pointerDragPayloadFor(
  target: Element,
): PointerDragPayload | null {
  const state = getState();
  const fragmentCard = target.closest<HTMLElement>(
    ".fragment-card[data-fragment-id]",
  );
  if (fragmentCard && isLibraryView(state.view)) {
    const fragmentId = fragmentCard.dataset.fragmentId;
    if (!fragmentId) return null;
    const selectedIds = selectSelectedIds(state);
    const ids =
      selectSelectedIdSet(state).has(fragmentId) && selectedIds.length > 0
        ? selectedIds
        : [fragmentId];
    const cards = new Map(
      selectActiveCards(state).map((card) => [card.fragment.id, card]),
    );
    const imageUrls = ids
      .map((id) => cards.get(id)?.assetSources[0]?.url ?? "")
      .filter(Boolean)
      .slice(0, 3);
    return {
      kind: "fragments",
      ids,
      imageUrls,
      label: pluralize(ids.length, "Fragment"),
    };
  }
  const frameCard = target.closest<HTMLElement>("[data-frame-drag-id]");
  if (!frameCard || target.closest("[data-no-frame-drag], input")) {
    return null;
  }
  const frameId = frameCard.dataset.frameDragId;
  const frame = state.frames.find((item) => item.id === frameId);
  if (!frame || isProtectedFrame(state, frame)) return null;
  const imageUrls = (selectFolderCovers(state).get(frame.id) ?? [])
    .map((card) => card.assetSources[0]?.url ?? "")
    .filter(Boolean);
  return { kind: "frame", id: frame.id, imageUrls, label: frame.name };
}

export function setPointerDropTarget(target: string | null) {
  setState((state) => ({
    trashDropState:
      target === "trash"
        ? "armed"
        : state.trashDropState === "success"
          ? state.trashDropState
          : "idle",
    frameDropTarget: target,
  }));
}

export function flashTrashSuccess() {
  setState({ trashDropState: "success" });
  window.setTimeout(() => setState({ trashDropState: "idle" }), 620);
}

export function parseFrameDropTarget(target: string): FrameDropTarget | null {
  if (target === "frame-root") return { kind: "root" };
  const [prefix, frameId] = target.split(":", 2);
  if (!frameId) return null;
  if (prefix === "frame-tree") return { kind: "inside", frameId };
  if (prefix === "frame-before") return { kind: "before", frameId };
  if (prefix === "frame-after") return { kind: "after", frameId };
  return null;
}

export async function handlePointerDrop(
  payload: PointerDragPayload,
  target: string,
) {
  try {
    setLibraryError(null);
    if (target === "trash") {
      const changed =
        payload.kind === "frame"
          ? await moveFrameToTrash(payload.id)
          : await moveFragmentsToTrash(payload.ids);
      if (changed) flashTrashSuccess();
      return;
    }
    if (
      payload.kind === "fragments" &&
      /^frame-(tree|before|after|chip):/.test(target)
    ) {
      await linkFragmentsToFrame(
        payload.ids,
        target.slice(target.indexOf(":") + 1),
      );
      return;
    }
    if (payload.kind === "frame") {
      const parsed = parseFrameDropTarget(target);
      if (!parsed) return;
      await moveFrameAction(payload.id, parsed);
    }
  } catch (caught) {
    reportError(caught);
    showToast("Drop failed", { tone: "error" });
    setState({ trashDropState: "idle", frameDropTarget: null });
  }
}
