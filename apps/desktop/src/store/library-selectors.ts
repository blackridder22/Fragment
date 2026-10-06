import type { Fragment, Frame } from "@fragment/shared";
import { normalizeFragmentFilter } from "../features/filters/filter-model";
import { aggregateFrameCounts } from "../features/frames/frame-tree";
import { resolveSelectedIds } from "../features/selection/selection-model";
import { createAssetSourceCache } from "../lib/asset-sources";
import type { AssetSource } from "../lib/assets";
import { demoFrames } from "../lib/demo-vault";
import {
  FOLDER_PREVIEW_LIMIT,
  RECENT_LIMIT,
  collageFragments,
  recentFragments,
} from "../v7/vault-home";
import { createSelector } from "./create-store";
import {
  selectDemoActiveFragments,
  selectDemoCounts,
  selectDemoGalleryFragments,
  selectDemoTrashedFragments,
} from "./demo-library";
import type {
  LibraryState,
  LibraryView,
  SortMode,
  ThemeMode,
} from "./library-types";

/** A page item with its asset sources and folder name precomputed. */
export type GalleryCard = {
  fragment: Fragment;
  assetSources: AssetSource[];
  folderName: string;
};

const EMPTY_IDS: string[] = [];
const EMPTY_FRAMES: Frame[] = [];
const EMPTY_FRAGMENTS: Fragment[] = [];
const EMPTY_CARDS: GalleryCard[] = [];

export function pluralize(count: number, noun: string, plural = `${noun}s`) {
  return `${count.toLocaleString()} ${count === 1 ? noun : plural}`;
}

export function isLibraryView(view: LibraryView) {
  return view === "home" || view === "frames";
}

export const selectIsLibraryView = (state: LibraryState) =>
  isLibraryView(state.view);

export const selectShowsHomeDashboard = (state: LibraryState) =>
  state.view === "home" &&
  !state.selectedFrameId &&
  !state.selectedSmartFrameId &&
  !state.fragmentFilter.color;

export const selectThemeMode = createSelector(
  [
    (state: LibraryState) => state.theme,
    (state: LibraryState) => state.systemPrefersDark,
  ],
  (theme, systemPrefersDark): ThemeMode =>
    theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme,
);

export const selectDisplayFrames = createSelector(
  [
    (state: LibraryState) => state.frames,
    (state: LibraryState) => state.previewMode,
  ],
  (frames, previewMode) =>
    frames.length > 0 ? frames : previewMode ? demoFrames : EMPTY_FRAMES,
);

export const selectFrameById = createSelector(
  [selectDisplayFrames],
  (frames) => new Map(frames.map((frame) => [frame.id, frame])),
);

export const selectActiveFragments = createSelector(
  [
    (state: LibraryState) => state.previewMode,
    (state: LibraryState) => state.activePage.items,
    selectDemoGalleryFragments,
  ],
  (previewMode, items, demo) => (previewMode ? demo : items),
);

export const selectTrashFragments = createSelector(
  [
    (state: LibraryState) => state.previewMode,
    (state: LibraryState) => state.trashPage.items,
    selectDemoTrashedFragments,
  ],
  (previewMode, items, demo) => (previewMode ? demo : items),
);

export const selectActiveTotal = (state: LibraryState) =>
  state.previewMode
    ? selectDemoGalleryFragments(state).length
    : state.activePage.total;

export const selectTrashFragmentTotal = (state: LibraryState) =>
  state.previewMode
    ? selectDemoTrashedFragments(state).length
    : state.trashTotal;

export const selectTrashedFrames = createSelector(
  [
    (state: LibraryState) => state.previewMode,
    (state: LibraryState) => Boolean(state.fragmentFilter.color),
    (state: LibraryState) => state.trashedFrames,
    (state: LibraryState) => state.query,
  ],
  (previewMode, colorFilter, frames, query) => {
    if (previewMode || colorFilter) return EMPTY_FRAMES;
    const normalized = query.trim().toLowerCase();
    return normalized
      ? frames.filter((frame) => frame.name.toLowerCase().includes(normalized))
      : frames;
  },
);

export const selectTrashItemTotal = (state: LibraryState) =>
  selectTrashFragmentTotal(state) + selectTrashedFrames(state).length;

export const selectDirectCounts = createSelector(
  [
    (state: LibraryState) => state.frameCounts,
    (state: LibraryState) => state.frames.length,
    (state: LibraryState) => state.previewMode,
    (state: LibraryState) => state.coverFragments,
    selectDemoCounts,
  ],
  (counts, realFrames, previewMode, coverFragments, demoCounts) => {
    if (realFrames === 0 && previewMode) return demoCounts;
    const next = new Map<string, number>(Object.entries(counts));
    if (next.size === 0) {
      for (const fragment of coverFragments) {
        next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
      }
    }
    return next;
  },
);

export const selectRecursiveCounts = createSelector(
  [selectDisplayFrames, selectDirectCounts],
  (frames, counts) => aggregateFrameCounts(frames, counts),
);

const galleryAssetSources = createAssetSourceCache("gallery");
const cardCache = new WeakMap<Fragment, GalleryCard>();

function buildCards(
  fragments: Fragment[],
  assetRoot: string,
  assetDataUrls: Record<string, string>,
  frameById: ReadonlyMap<string, Frame>,
): GalleryCard[] {
  if (fragments.length === 0) return EMPTY_CARDS;
  return fragments.map((fragment) => {
    const assetSources = galleryAssetSources(
      fragment,
      assetRoot,
      assetDataUrls,
    );
    const folderName = frameById.get(fragment.frameId)?.name ?? "Vault";
    const hit = cardCache.get(fragment);
    if (
      hit &&
      hit.assetSources === assetSources &&
      hit.folderName === folderName
    ) {
      return hit;
    }
    const card = { fragment, assetSources, folderName };
    cardCache.set(fragment, card);
    return card;
  });
}

/** Active page items as memoized cards keyed by Fragment identity and asset root. */
export const selectActiveCards = createSelector(
  [
    selectActiveFragments,
    (state: LibraryState) => state.assetRoot,
    (state: LibraryState) => state.assetDataUrls,
    selectFrameById,
  ],
  buildCards,
);

export const selectTrashCards = createSelector(
  [
    selectTrashFragments,
    (state: LibraryState) => state.assetRoot,
    (state: LibraryState) => state.assetDataUrls,
    selectFrameById,
  ],
  buildCards,
);

function compareFrames(
  left: Frame,
  right: Frame,
  sortMode: SortMode,
  counts: ReadonlyMap<string, number>,
) {
  if (sortMode === "name") return left.name.localeCompare(right.name);
  if (sortMode === "largest") {
    return (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
  }
  const difference = left.createdAt.localeCompare(right.createdAt);
  return sortMode === "oldest" ? difference : -difference;
}

/** Top-level Frames for the home page, narrowed by the search query. */
export const selectVaultFolders = createSelector(
  [
    selectDisplayFrames,
    (state: LibraryState) => state.query,
    (state: LibraryState) => state.sortMode,
    selectRecursiveCounts,
  ],
  (frames, query, sortMode, counts) => {
    const normalized = query.trim().toLowerCase();
    return frames
      .filter(
        (frame) =>
          frame.parentId === null &&
          (!normalized || frame.name.toLowerCase().includes(normalized)),
      )
      .sort((left, right) => compareFrames(left, right, sortMode, counts));
  },
);

const EMPTY_COVERS: ReadonlyMap<string, GalleryCard[]> = new Map();

/**
 * Collage cards per top-level Frame. The backend previews (latest Fragments,
 * nested Frames included) win when loaded; a Frame without previews falls
 * back to the newest-first snapshot page and the loaded page, which covers
 * the window before the first fetch and a failed fetch.
 */
export const selectFolderCovers = createSelector(
  [
    (state: LibraryState) => state.previewMode,
    selectDisplayFrames,
    (state: LibraryState) => state.framePreviews,
    (state: LibraryState) => state.coverFragments,
    selectActiveFragments,
    selectDemoActiveFragments,
    (state: LibraryState) => state.assetRoot,
    (state: LibraryState) => state.assetDataUrls,
    selectFrameById,
  ],
  (
    previewMode,
    frames,
    previews,
    covers,
    active,
    demo,
    assetRoot,
    assetDataUrls,
    frameById,
  ) => {
    const fallback = previewMode ? demo : [...covers, ...active];
    const source = previewMode ? undefined : (previews ?? undefined);
    const byFrame = new Map<string, GalleryCard[]>();
    for (const frame of frames) {
      if (frame.parentId !== null) continue;
      const fragments = collageFragments(
        frame.id,
        source,
        fallback,
        FOLDER_PREVIEW_LIMIT,
      );
      if (fragments.length === 0) continue;
      byFrame.set(
        frame.id,
        buildCards(fragments, assetRoot, assetDataUrls, frameById),
      );
    }
    return byFrame.size === 0 ? EMPTY_COVERS : byFrame;
  },
);

/**
 * "Recently added": the newest-first snapshot page, bounded, whatever the
 * gallery sort is. While a search is typed (or in browser preview) the
 * matching page is shown instead.
 */
export const selectRecentCards = createSelector(
  [
    (state: LibraryState) => state.previewMode || state.query.trim() !== "",
    (state: LibraryState) => state.coverFragments,
    selectActiveFragments,
    (state: LibraryState) => state.assetRoot,
    (state: LibraryState) => state.assetDataUrls,
    selectFrameById,
  ],
  (usePage, covers, active, assetRoot, assetDataUrls, frameById) =>
    buildCards(
      recentFragments(usePage ? active : covers, RECENT_LIMIT),
      assetRoot,
      assetDataUrls,
      frameById,
    ),
);

export const selectSelectableIds = createSelector(
  [
    (state: LibraryState) => state.view,
    selectActiveFragments,
    selectTrashFragments,
  ],
  (view, active, trash) =>
    view === "trash"
      ? trash.map((fragment) => fragment.id)
      : isLibraryView(view)
        ? active.map((fragment) => fragment.id)
        : EMPTY_IDS,
);

export const selectSelectionScopeKey = createSelector(
  [
    (state: LibraryState) => state.view,
    (state: LibraryState) => state.selectedSmartFrameId,
    (state: LibraryState) => state.selectedFrameId,
    (state: LibraryState) => state.frameNavigator.includeDescendants,
    (state: LibraryState) => state.query,
    (state: LibraryState) => state.sourceFilter,
    (state: LibraryState) => state.fragmentFilter,
  ],
  (view, smartFrameId, frameId, includeDescendants, query, source, filter) =>
    [
      view,
      smartFrameId ?? "no-smart-frame",
      frameId ?? "all-frames",
      includeDescendants ? "with-subframes" : "direct",
      query.trim().toLowerCase(),
      source,
      JSON.stringify(normalizeFragmentFilter(filter)),
    ].join("\u0000"),
);

export const selectSelectedIds = createSelector(
  [
    (state: LibraryState) => state.selection,
    selectSelectionScopeKey,
    selectSelectableIds,
  ],
  (selection, scopeKey, selectable) =>
    resolveSelectedIds(selection, scopeKey, selectable),
);

export const selectSelectedIdSet = createSelector(
  [selectSelectedIds],
  (ids) => new Set(ids),
);

export const selectSelectedCount = (state: LibraryState) =>
  selectSelectedIds(state).length;

export const selectCurrentFragments = (state: LibraryState) =>
  state.view === "trash"
    ? selectTrashFragments(state)
    : isLibraryView(state.view)
      ? selectActiveFragments(state)
      : EMPTY_FRAGMENTS;

/** The single selected Fragment, when exactly one is selected. */
export const selectInspectedFragment = createSelector(
  [selectSelectedIds, selectCurrentFragments],
  (ids, fragments) =>
    ids.length === 1
      ? (fragments.find((fragment) => fragment.id === ids[0]) ?? null)
      : null,
);

export const selectSelectedFragments = createSelector(
  [selectSelectedIds, selectCurrentFragments],
  (ids, fragments) => {
    const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
    return ids
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
  },
);

export const selectCanSelectAll = (state: LibraryState) =>
  state.previewMode
    ? selectSelectableIds(state).length > 0
    : state.view === "trash"
      ? state.trashTotal > 0
      : isLibraryView(state.view) && state.activePage.total > 0;

/** The focused Fragment with the latest page copy and any demo title override. */
export const selectFocusedFragment = createSelector(
  [
    (state: LibraryState) => state.focused,
    (state: LibraryState) => state.previewTitleOverrides,
    selectActiveFragments,
    selectTrashFragments,
  ],
  (focused, titles, active, trash) => {
    if (!focused) return null;
    const id = focused.fragment.id;
    const latest =
      active.find((fragment) => fragment.id === id) ??
      trash.find((fragment) => fragment.id === id) ??
      focused.fragment;
    const title = titles[id];
    return title !== undefined && title !== latest.title
      ? { ...latest, title }
      : latest;
  },
);

export const selectFocusedCollection = createSelector(
  [selectCurrentFragments, selectSelectedIds, selectFocusedFragment],
  (fragments, selectedIds, focused) => {
    if (
      !focused ||
      selectedIds.length <= 1 ||
      !selectedIds.includes(focused.id)
    ) {
      return fragments;
    }
    const byId = new Map(fragments.map((fragment) => [fragment.id, fragment]));
    const selected = selectedIds
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
    return selected.length > 1 ? selected : fragments;
  },
);

export const selectFocusedIndex = (state: LibraryState) => {
  const focused = selectFocusedFragment(state);
  if (!focused) return 0;
  return Math.max(
    0,
    selectFocusedCollection(state).findIndex(
      (fragment) => fragment.id === focused.id,
    ),
  );
};

export const selectFocusedAssetSources = (() => {
  const detailSources = createAssetSourceCache("detail");
  return createSelector(
    [
      selectFocusedFragment,
      (state: LibraryState) => state.assetRoot,
      (state: LibraryState) => state.assetDataUrls,
    ],
    (focused, assetRoot, assetDataUrls) =>
      focused ? detailSources(focused, assetRoot, assetDataUrls) : [],
  );
})();

export type ShellTitles = { title: string; subtitle: string };

export const selectShellTitles = createSelector(
  [
    (state: LibraryState) => state.view,
    (state: LibraryState) => state.selectedFrameId,
    (state: LibraryState) => state.selectedSmartFrameId,
    selectFrameById,
    (state: LibraryState) => state.smartFrames,
    selectSelectedCount,
    selectActiveTotal,
    (state: LibraryState) => selectDisplayFrames(state).length,
  ],
  (
    view,
    frameId,
    smartFrameId,
    frameById,
    smartFrames,
    selectedCount,
    fragmentTotal,
    frameTotal,
  ): ShellTitles => {
    const selectedFrame = frameId ? frameById.get(frameId) : null;
    const smartFrame = smartFrameId
      ? smartFrames.find((item) => item.id === smartFrameId)
      : null;
    const title =
      view === "frames"
        ? "All Fragments"
        : (selectedFrame?.name ?? smartFrame?.name ?? "Your Vault");
    const subtitle =
      selectedCount > 0
        ? `${pluralize(selectedCount, "Fragment")} selected`
        : view === "frames"
          ? `${pluralize(fragmentTotal, "Fragment")} across ${pluralize(frameTotal, "Frame")}`
          : frameId || smartFrameId
            ? pluralize(fragmentTotal, "Fragment")
            : `${pluralize(frameTotal, "Frame")} · ${pluralize(fragmentTotal, "Fragment")}`;
    return { title, subtitle };
  },
);

export const selectDeleteRetentionDays = (state: LibraryState) =>
  state.deletePolicy === "forever" ? null : Number(state.deletePolicy);

export function isProtectedFrame(state: LibraryState, frame: Frame) {
  return (
    frame.id === state.defaultFrameId ||
    (frame.name === "Inbox" && frame.parentId === null)
  );
}

/** Fragments in the whole Vault (direct counts summed), for the sidebar. */
export const selectVaultFragmentTotal = createSelector(
  [selectDirectCounts],
  (counts) => {
    let total = 0;
    for (const count of counts.values()) total += count;
    return total;
  },
);
