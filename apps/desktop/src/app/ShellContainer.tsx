import { useMemo, type ReactNode } from "react";
import { formatShortcutBinding } from "../features/shortcuts/shortcut-model";
import {
  changeView,
  navigateBack,
  openCreateFrame,
  selectFrame,
  setBrowsingDensity,
  setBrowsingLayout,
  setSortMode,
  setQuery,
  toggleFrameExpanded,
} from "../store/library-actions";
import { chooseImages } from "../store/library-import";
import {
  isLibraryView,
  selectDisplayFrames,
  selectRecursiveCounts,
  selectShellTitles,
  selectTrashItemTotal,
  selectVaultFragmentTotal,
} from "../store/library-selectors";
import { useLibraryStore } from "../store/library-store";
import { DesktopShell, LibraryToolbar } from "../v7/DesktopShell";
import { onShellPointerDown } from "./InteractionLayer";

const EMPTY_SET: ReadonlySet<string> = new Set();

function openImport() {
  void chooseImages();
}

/** Binds the desktop shell to the store; the page is passed through unchanged. */
export function ShellContainer({ children }: { children: ReactNode }) {
  const view = useLibraryStore((state) => state.view);
  const frames = useLibraryStore(selectDisplayFrames);
  const frameCounts = useLibraryStore(selectRecursiveCounts);
  const expandedIds = useLibraryStore(
    (state) => state.frameNavigator.expandedIds,
  );
  const expandedSet = useMemo(
    () => (expandedIds.length ? new Set(expandedIds) : EMPTY_SET),
    [expandedIds],
  );
  const selectedFrameId = useLibraryStore((state) => state.selectedFrameId);
  const query = useLibraryStore((state) => state.query);
  const titles = useLibraryStore(selectShellTitles);
  const dropTarget = useLibraryStore((state) => state.frameDropTarget);
  const trashDropState = useLibraryStore((state) => state.trashDropState);
  const trashTotal = useLibraryStore(selectTrashItemTotal);
  const fragmentTotal = useLibraryStore(selectVaultFragmentTotal);
  const previewMode = useLibraryStore((state) => state.previewMode);
  const searchShortcut = useLibraryStore((state) =>
    formatShortcutBinding(state.settings.shortcuts.search),
  );
  const browsingMode = useLibraryStore((state) => state.browsingMode);
  const sortMode = useLibraryStore((state) => state.sortMode);
  const libraryView = isLibraryView(view);

  return (
    <DesktopShell
      activeView={view}
      dropTarget={dropTarget}
      expandedIds={expandedSet}
      frameCounts={frameCounts}
      frames={frames}
      fragmentTotal={fragmentTotal}
      onBack={navigateBack}
      onCreateFrame={openCreateFrame}
      onImportFragments={openImport}
      onPointerDown={onShellPointerDown}
      onQueryChange={setQuery}
      onSelectFrame={selectFrame}
      onToggleExpanded={toggleFrameExpanded}
      onViewChange={changeView}
      pageActions={
        libraryView ? (
          <LibraryToolbar
            density={browsingMode.density}
            layout={browsingMode.layout === "grid" ? "grid" : "masonry"}
            onDensityChange={setBrowsingDensity}
            onLayoutChange={setBrowsingLayout}
            onSortChange={setSortMode}
            sortMode={sortMode}
          />
        ) : undefined
      }
      pageSubtitle={titles.subtitle}
      pageTitle={titles.title}
      query={query}
      searchShortcutLabel={searchShortcut}
      selectedFrameId={selectedFrameId}
      showFrameTree={libraryView}
      showMockWindowControls={previewMode}
      showPageBar={libraryView}
      trashDropState={trashDropState}
      trashTotal={trashTotal}
    >
      {children}
    </DesktopShell>
  );
}
