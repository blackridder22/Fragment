import { resolveAssetFallback } from "../store/library-assets";
import {
  applyFragmentFilter,
  changeView,
  clearFilters,
  handleFragmentCardSelect,
  openContextMenu,
  openFragmentPreview,
  openSettings,
  refreshColorResults,
  refreshNativeHostStatus,
  resetPreferences,
  selectFrame,
  setDeletePolicy,
  setSettings,
  setSettingsSection,
  setSourceFilter,
  setTheme,
  setTrashSort,
} from "../store/library-actions";
import {
  emptyTrashAction,
  reportTrashRestoreFailure,
  restoreTrashedFragment,
} from "../store/library-fragments";
import { restoreTrashedFrame } from "../store/library-frames";
import { chooseImages } from "../store/library-import";
import { libraryLoader } from "../store/library-loader";
import {
  selectActiveCards,
  selectActiveTotal,
  selectFolderCovers,
  selectFrameById,
  selectRecentCards,
  selectRecursiveCounts,
  selectSelectedIdSet,
  selectTrashCards,
  selectTrashFragmentTotal,
  selectTrashedFrames,
  selectVaultFolders,
} from "../store/library-selectors";
import { libraryStore, useLibraryStore } from "../store/library-store";
import { revealVaultInFinder, isTauriRuntime } from "../lib/tauri";
import { FramesPage } from "../v7/FramesPage";
import { SettingsPage } from "../v7/SettingsPage";
import { TrashPage } from "../v7/TrashPage";
import { VaultPage } from "../v7/VaultPage";
import { onCanvasPointerDown } from "./InteractionLayer";

function loadMoreActive() {
  void libraryLoader.loadMore("active");
}

function loadMoreTrash() {
  void libraryLoader.loadMore("trash");
}

function browseAll() {
  changeView("frames");
}

function openImport() {
  void chooseImages();
}

function openCaptureSettings() {
  openSettings("capture");
}

function openFolder(frame: { id: string }) {
  selectFrame(frame.id);
}

function frameNameFor(frameId: string) {
  return selectFrameById(libraryStore.getState()).get(frameId)?.name ?? "Vault";
}

async function revealVault() {
  if (!isTauriRuntime()) return;
  await revealVaultInFinder();
}

export function VaultPageContainer() {
  const items = useLibraryStore(selectRecentCards);
  const folders = useLibraryStore(selectVaultFolders);
  const folderCovers = useLibraryStore(selectFolderCovers);
  const frameCounts = useLibraryStore(selectRecursiveCounts);
  const density = useLibraryStore((state) => state.browsingMode.density);
  const dropTarget = useLibraryStore((state) => state.frameDropTarget);
  const ready = useLibraryStore((state) => state.booted);
  const searchQuery = useLibraryStore((state) => state.query);
  const selectedIds = useLibraryStore(selectSelectedIdSet);
  const systemFrameId = useLibraryStore((state) => state.defaultFrameId);
  return (
    <VaultPage
      density={density}
      dropTarget={dropTarget}
      folderCovers={folderCovers}
      folders={folders}
      frameCounts={frameCounts}
      items={items}
      onAssetFallback={resolveAssetFallback}
      onBrowseAll={browseAll}
      onContextMenu={openContextMenu}
      onImport={openImport}
      onOpen={openFragmentPreview}
      onOpenFolder={openFolder}
      onOpenSettings={openCaptureSettings}
      onPointerDown={onCanvasPointerDown}
      onSelect={handleFragmentCardSelect}
      ready={ready}
      searchQuery={searchQuery}
      selectedIds={selectedIds}
      systemFrameId={systemFrameId}
    />
  );
}

export function FramesPageContainer() {
  const items = useLibraryStore(selectActiveCards);
  const paletteIndex = useLibraryStore((state) => state.paletteIndex);
  const colorResultsChanged = useLibraryStore(
    (state) => state.colorResultsChanged,
  );
  const density = useLibraryStore((state) => state.browsingMode.density);
  const layout = useLibraryStore((state) => state.browsingMode.layout);
  const filter = useLibraryStore((state) => state.fragmentFilter);
  const knownTags = useLibraryStore((state) => state.knownTags);
  const previewMode = useLibraryStore((state) => state.previewMode);
  const hasMore = useLibraryStore((state) => state.activePage.hasMore);
  const loading = useLibraryStore((state) => state.activePage.loading);
  const selectedIds = useLibraryStore(selectSelectedIdSet);
  const sourceFilter = useLibraryStore((state) => state.sourceFilter);
  const total = useLibraryStore(selectActiveTotal);
  return (
    <FramesPage
      colorResultsChanged={colorResultsChanged}
      density={density}
      filter={filter}
      hasMore={!previewMode && hasMore}
      items={items}
      knownTags={knownTags}
      layout={layout === "grid" ? "grid" : "masonry"}
      loading={loading}
      onAssetFallback={resolveAssetFallback}
      onClearFilters={clearFilters}
      onContextMenu={openContextMenu}
      onFilterChange={applyFragmentFilter}
      onLoadMore={previewMode ? undefined : loadMoreActive}
      onOpen={openFragmentPreview}
      onPointerDown={onCanvasPointerDown}
      onRefreshColors={refreshColorResults}
      onSelect={handleFragmentCardSelect}
      onSourceFilterChange={setSourceFilter}
      paletteIndex={paletteIndex}
      resultCount={total}
      selectedIds={selectedIds}
      sourceFilter={sourceFilter}
    />
  );
}

function changeTrashColor(
  color: Parameters<typeof applyFragmentFilter>[0]["color"],
) {
  applyFragmentFilter({ ...libraryStore.getState().fragmentFilter, color });
}

export function TrashPageContainer() {
  const items = useLibraryStore(selectTrashCards);
  const frames = useLibraryStore(selectTrashedFrames);
  const color = useLibraryStore((state) => state.fragmentFilter.color);
  const paletteIndex = useLibraryStore((state) => state.paletteIndex);
  const colorResultsChanged = useLibraryStore(
    (state) => state.colorResultsChanged,
  );
  const previewMode = useLibraryStore((state) => state.previewMode);
  const hasMore = useLibraryStore((state) => state.trashPage.hasMore);
  const loading = useLibraryStore((state) => state.trashPage.loading);
  const deletePolicy = useLibraryStore((state) => state.deletePolicy);
  const sort = useLibraryStore((state) => state.trashSort);
  const fragmentTotal = useLibraryStore(selectTrashFragmentTotal);
  return (
    <TrashPage
      color={color}
      colorResultsChanged={colorResultsChanged}
      frameNameFor={frameNameFor}
      frames={frames}
      hasMore={!previewMode && hasMore}
      items={items}
      loading={loading}
      onAssetFallback={resolveAssetFallback}
      onColorChange={changeTrashColor}
      onEmptyTrash={emptyTrashAction}
      onLoadMore={previewMode ? undefined : loadMoreTrash}
      onRefreshColors={refreshColorResults}
      onRestoreError={reportTrashRestoreFailure}
      onRestoreFragment={restoreTrashedFragment}
      onRestoreFrame={restoreTrashedFrame}
      onSortChange={setTrashSort}
      paletteIndex={paletteIndex}
      retentionLabel={
        deletePolicy === "forever"
          ? "Deleted immediately"
          : `Permanently removed after ${deletePolicy} days`
      }
      sort={sort}
      total={fragmentTotal + frames.length}
    />
  );
}

export function SettingsPageContainer() {
  const paletteIndex = useLibraryStore((state) => state.paletteIndex);
  const deletePolicy = useLibraryStore((state) => state.deletePolicy);
  const nativeHostStatus = useLibraryStore((state) => state.nativeHostStatus);
  const settings = useLibraryStore((state) => state.settings);
  const theme = useLibraryStore((state) => state.theme);
  const assetRoot = useLibraryStore((state) => state.assetRoot);
  const section = useLibraryStore((state) => state.settingsSection);
  return (
    <SettingsPage
      deletePolicy={deletePolicy}
      section={section}
      onSectionChange={setSettingsSection}
      nativeHostStatus={nativeHostStatus}
      onDeletePolicyChange={setDeletePolicy}
      onRefreshNativeHostStatus={refreshNativeHostStatus}
      onResetToDefaults={resetPreferences}
      onRevealVault={revealVault}
      onSettingsChange={setSettings}
      onThemeChange={setTheme}
      paletteIndex={paletteIndex}
      settings={settings}
      theme={theme}
      vaultPath={assetRoot || "~/Library/Application Support/Fragment"}
    />
  );
}
