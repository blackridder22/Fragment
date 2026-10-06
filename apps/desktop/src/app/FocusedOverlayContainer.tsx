import type { ColorFilter } from "@fragment/shared";
import { isDemoFragment } from "../lib/demo-vault";
import { isTauriRuntime } from "../lib/tauri";
import {
  applyFragmentFilter,
  closeFocused,
  showFocusedSibling,
  toggleOverlayContextMenu,
} from "../store/library-actions";
import { resolveAssetFallback } from "../store/library-assets";
import {
  moveFragmentToFrameAction,
  openFocusedSource,
  revealFragment,
  saveFocusedNotes,
  saveFocusedTags,
  saveFocusedTitle,
} from "../store/library-fragments";
import {
  selectDisplayFrames,
  selectFocusedAssetSources,
  selectFocusedCollection,
  selectFocusedFragment,
  selectFocusedIndex,
} from "../store/library-selectors";
import { libraryStore, useLibraryStore } from "../store/library-store";
import { FocusedFrameOverlay } from "../v7/FocusedFrameOverlay";

const EMPTY_TAGS: string[] = [];

function showPrevious() {
  showFocusedSibling(-1);
}

function showNext() {
  showFocusedSibling(1);
}

function findColor(color: ColorFilter) {
  applyFragmentFilter({ ...libraryStore.getState().fragmentFilter, color });
  closeFocused();
}

export function FocusedOverlayContainer() {
  const focused = useLibraryStore(selectFocusedFragment);
  const assetSources = useLibraryStore(selectFocusedAssetSources);
  const assetRoot = useLibraryStore((state) => state.assetRoot);
  const frames = useLibraryStore(selectDisplayFrames);
  const tagsById = useLibraryStore((state) => state.fragmentTagsById);
  const tagStatusById = useLibraryStore((state) => state.fragmentTagStatusById);
  const currentIndex = useLibraryStore(selectFocusedIndex);
  const total = useLibraryStore(
    (state) => selectFocusedCollection(state).length,
  );
  const contextMenu = useLibraryStore((state) => state.contextMenu);
  const closeShortcut = useLibraryStore(
    (state) => state.settings.shortcuts.closeOverlay,
  );
  const view = useLibraryStore((state) => state.view);
  const previewMode = useLibraryStore((state) => state.previewMode);
  if (!focused) return null;

  const native = isTauriRuntime() && !isDemoFragment(focused);
  const hasSource = Boolean(focused.sourceUrl || focused.pageUrl);
  return (
    <FocusedFrameOverlay
      actionsOpen={
        contextMenu?.layer === "overlay" &&
        contextMenu.fragment.id === focused.id
      }
      assetRoot={assetRoot}
      assetSources={assetSources}
      closeShortcut={closeShortcut}
      currentIndex={currentIndex}
      fragment={focused}
      frames={frames}
      onAssetFallback={resolveAssetFallback}
      onClose={closeFocused}
      onFindColor={findColor}
      onFrameChange={
        view === "trash"
          ? undefined
          : (frameId) => moveFragmentToFrameAction(focused, frameId)
      }
      onMoreActions={(anchor) => toggleOverlayContextMenu(focused, anchor)}
      onNext={showNext}
      onNotesChange={
        native ? (notes) => saveFocusedNotes(focused, notes) : undefined
      }
      onOpenSource={hasSource ? () => openFocusedSource(focused) : undefined}
      onPrevious={showPrevious}
      onReveal={native ? () => revealFragment(focused) : undefined}
      onTagsChange={(tags) => saveFocusedTags(focused, tags)}
      onTitleChange={(title) => saveFocusedTitle(focused, title)}
      shortcutCloseDisabled={Boolean(contextMenu)}
      showPalette={native}
      tags={tagsById[focused.id] ?? EMPTY_TAGS}
      tagsLoading={!previewMode && tagStatusById[focused.id] !== "ready"}
      total={total}
    />
  );
}
