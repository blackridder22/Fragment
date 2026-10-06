import type { Fragment, Frame } from "@fragment/shared";
import type { MouseEvent } from "react";
import {
  EMPTY_FRAGMENT_FILTER,
  filterWithLibraryControls,
  normalizeFragmentFilter,
  type FragmentFilter,
  type SmartFrame,
} from "../features/filters/filter-model";
import {
  DEFAULT_FRAME_NAVIGATOR_PREFERENCES,
  frameBreadcrumbs,
} from "../features/frames/frame-tree";
import {
  createSelectionState,
  selectionReducer,
  type SelectionAction,
} from "../features/selection/selection-model";
import { normalizeTags } from "../features/tags/tag-editor-model";
import { isDemoFragment } from "../lib/demo-vault";
import {
  getFragmentTags,
  isTauriRuntime,
  listFragmentIds,
  nativeHostStatus as readNativeHostStatus,
} from "../lib/tauri";
import type { V7SettingsState } from "../v7/settings-state";
import { reportError, showToast } from "./library-feedback";
import {
  libraryLoader,
  pageNameForView,
  type PageName,
} from "./library-loader";
import {
  pluralize,
  selectDisplayFrames,
  selectFocusedCollection,
  selectFocusedIndex,
  selectFrameById,
  selectSelectableIds,
  selectSelectedIdSet,
  selectSelectedIds,
  selectSelectionScopeKey,
} from "./library-selectors";
import { libraryStore } from "./library-store";
import type {
  BrowsingDensity,
  BrowsingLayout,
  DeletePolicy,
  LibraryState,
  LibraryView,
  SettingsSection,
  SortMode,
  SourceFilter,
  ThemePreference,
  TrashSort,
} from "./library-types";

const { getState, setState } = libraryStore;

function resetFilters(): Partial<LibraryState> {
  return {
    fragmentFilter: EMPTY_FRAGMENT_FILTER,
    query: "",
    sourceFilter: "all",
  };
}

export function dispatchSelection(action: SelectionAction) {
  setState((state) => ({
    selection: selectionReducer(state.selection, action),
  }));
}

export function changeView(view: LibraryView) {
  const state = getState();
  const patch: Partial<LibraryState> = {
    view,
    focused: null,
    frameModal: null,
    contextMenu: null,
    selection: createSelectionState(),
    selectedFrameId: null,
  };
  if (view === "home" || view === "frames") {
    patch.selectedSmartFrameId = null;
    if (state.selectedSmartFrameId) Object.assign(patch, resetFilters());
  }
  setState(patch);
}

/** Opens the Settings page on a given section (e.g. Capture Mode setup). */
export function openSettings(section: SettingsSection) {
  setState({ settingsSection: section });
  changeView("settings");
}

export function setSettingsSection(section: SettingsSection) {
  setState({ settingsSection: section });
}

export function selectFrame(frameId: string | null) {
  const state = getState();
  const patch: Partial<LibraryState> = {
    view: "home",
    focused: null,
    contextMenu: null,
    selectedFrameId: frameId,
    selectedSmartFrameId: null,
    selection: createSelectionState(),
  };
  if (state.selectedSmartFrameId) Object.assign(patch, resetFilters());
  if (frameId) {
    patch.recentFrameId = frameId;
    const ancestorIds = frameBreadcrumbs(selectDisplayFrames(state), frameId)
      .slice(0, -1)
      .map((frame) => frame.id);
    if (ancestorIds.length > 0) {
      patch.frameNavigator = {
        ...state.frameNavigator,
        expandedIds: [
          ...new Set([...state.frameNavigator.expandedIds, ...ancestorIds]),
        ],
      };
    }
  }
  setState(patch);
}

export function navigateBack() {
  const state = getState();
  if (state.selectedFrameId) {
    selectFrame(
      selectFrameById(state).get(state.selectedFrameId)?.parentId ?? null,
    );
  } else if (state.view !== "home") {
    changeView("home");
  }
}

export function selectSmartFrame(smartFrame: SmartFrame) {
  const filter = normalizeFragmentFilter(smartFrame.filter);
  setState({
    view: "home",
    focused: null,
    contextMenu: null,
    selectedFrameId: null,
    selectedSmartFrameId: smartFrame.id,
    fragmentFilter: filter,
    query: filter.query ?? "",
    sourceFilter: filter.sourceKind ?? "all",
    selection: createSelectionState(),
  });
}

export function setQuery(query: string) {
  setState({ query });
}

export function setSortMode(sortMode: SortMode) {
  setState({ sortMode });
}

export function setSourceFilter(sourceFilter: SourceFilter) {
  setState({
    sourceFilter,
    selectedSmartFrameId: null,
    selection: createSelectionState(),
  });
}

export function applyFragmentFilter(filter: FragmentFilter) {
  setState({
    fragmentFilter: normalizeFragmentFilter(filter),
    colorResultsChanged: false,
    selectedSmartFrameId: null,
    selection: createSelectionState(),
  });
}

export function clearFilters() {
  setState({
    sourceFilter: "all",
    fragmentFilter: normalizeFragmentFilter(EMPTY_FRAGMENT_FILTER),
    colorResultsChanged: false,
    selectedSmartFrameId: null,
    selection: createSelectionState(),
  });
}

export function setTrashSort(trashSort: TrashSort) {
  setState({ trashSort });
}

/** Reloads the visible page after the palette index changed its results. */
export function refreshColorResults() {
  setState({ selection: createSelectionState(), colorResultsChanged: false });
  const page = pageNameForView(getState().view);
  if (page) void libraryLoader.reload(page);
}

/** Re-requests a page whose last request failed; defaults to the visible page. */
export function retryPage(
  page: PageName | null = pageNameForView(getState().view),
): Promise<void> {
  return page ? libraryLoader.retry(page) : Promise.resolve();
}

export function setIncludeDescendants(includeDescendants: boolean) {
  setState((state) => ({
    frameNavigator: { ...state.frameNavigator, includeDescendants },
    selection: createSelectionState(),
  }));
}

export function toggleFrameExpanded(frameId: string) {
  setState((state) => {
    const expanded = new Set(state.frameNavigator.expandedIds);
    if (expanded.has(frameId)) expanded.delete(frameId);
    else expanded.add(frameId);
    return {
      frameNavigator: { ...state.frameNavigator, expandedIds: [...expanded] },
    };
  });
}

export function expandFrame(frameId: string) {
  setState((state) =>
    state.frameNavigator.expandedIds.includes(frameId)
      ? {}
      : {
          frameNavigator: {
            ...state.frameNavigator,
            expandedIds: [...state.frameNavigator.expandedIds, frameId],
          },
        },
  );
}

export function setBrowsingLayout(layout: BrowsingLayout) {
  setState((state) => ({ browsingMode: { ...state.browsingMode, layout } }));
}

export function setBrowsingDensity(density: BrowsingDensity) {
  setState((state) => ({ browsingMode: { ...state.browsingMode, density } }));
}

export function setTheme(theme: ThemePreference) {
  setState({ theme });
}

export function setDeletePolicy(deletePolicy: DeletePolicy) {
  setState({ deletePolicy });
}

export function setSettings(settings: V7SettingsState) {
  setState({ settings });
}

export function resetPreferences() {
  setState({
    browsingMode: { density: "comfortable", layout: "masonry" },
    frameNavigator: DEFAULT_FRAME_NAVIGATOR_PREFERENCES,
  });
}

export function setShortcutsOpen(shortcutsOpen: boolean) {
  setState({ shortcutsOpen });
}

export function openCreateFrame(parentId: string | null) {
  setState({ frameModal: { mode: "create", parentId } });
}

export function openRenameFrame(frame: Frame) {
  setState({ frameModal: { mode: "rename", frame } });
}

export function closeFrameModal() {
  setState({ frameModal: null });
}

export function toggleFragmentSelection(fragmentId: string) {
  const state = getState();
  dispatchSelection({
    type: "toggle",
    scopeKey: selectSelectionScopeKey(state),
    matchingIds: selectSelectableIds(state),
    id: fragmentId,
  });
}

export function replaceSelection(ids: string[], visualOrder: string[]) {
  dispatchSelection({
    type: "replace-many",
    scopeKey: selectSelectionScopeKey(getState()),
    matchingIds: visualOrder,
    ids,
  });
}

export function deselectAll() {
  dispatchSelection({
    type: "clear",
    scopeKey: selectSelectionScopeKey(getState()),
  });
}

export function handleFragmentCardSelect(
  fragment: Fragment,
  event: MouseEvent<HTMLButtonElement>,
) {
  if (!event.shiftKey) return;
  event.preventDefault();
  toggleFragmentSelection(fragment.id);
}

export async function selectAllMatching() {
  const state = getState();
  const scopeKey = selectSelectionScopeKey(state);
  if (state.previewMode) {
    dispatchSelection({
      type: "select-all",
      scopeKey,
      matchingIds: selectSelectableIds(state),
    });
    return;
  }
  const inTrash = state.view === "trash";
  const page = inTrash ? state.trashPage : state.activePage;
  try {
    const matchingIds = await listFragmentIds({
      expectedPaletteRevision: state.fragmentFilter.color
        ? page.paletteRevision
        : null,
      frameId: state.view === "home" ? state.selectedFrameId : null,
      includeDescendants:
        state.view === "home" && Boolean(state.selectedFrameId)
          ? state.frameNavigator.includeDescendants
          : false,
      trashed: inTrash,
      query: state.query,
      sourceFilter: state.sourceFilter,
      filter: filterWithLibraryControls(
        state.fragmentFilter,
        state.query,
        state.sourceFilter,
      ),
      sortMode: state.sortMode,
    });
    dispatchSelection({ type: "select-all", scopeKey, matchingIds });
    showToast(`Selected ${pluralize(matchingIds.length, "Fragment")}`);
  } catch (caught) {
    reportError(caught);
    showToast("Selection failed", { tone: "error" });
  }
}

/** Moves a single selection left or right; returns the newly selected id. */
export function selectAdjacent(direction: -1 | 1): string | null {
  const state = getState();
  const selected = selectSelectedIds(state);
  if (selected.length !== 1) return null;
  const selectable = selectSelectableIds(state);
  const nextId = selectable[selectable.indexOf(selected[0]!) + direction];
  if (!nextId) return null;
  dispatchSelection({
    type: "replace-many",
    scopeKey: selectSelectionScopeKey(state),
    matchingIds: selectable,
    ids: [nextId],
  });
  return nextId;
}

export function openFragmentPreview(fragment: Fragment) {
  setState({ focused: { fragment, mode: "preview" } });
  void ensureFragmentTags(fragment);
}

export function openQuickPreview(fragment: Fragment) {
  setState({ focused: { fragment, mode: "quick" } });
  void ensureFragmentTags(fragment);
}

export function closeFocused() {
  setState({ focused: null, contextMenu: null });
}

export function closeQuickPreview() {
  setState((state) =>
    state.focused?.mode === "quick" ? { focused: null } : {},
  );
}

export function showFocusedSibling(direction: -1 | 1) {
  const state = getState();
  if (!state.focused) return;
  const next =
    selectFocusedCollection(state)[selectFocusedIndex(state) + direction];
  if (!next) return;
  setState({ focused: { fragment: next, mode: state.focused.mode } });
  void ensureFragmentTags(next);
}

export function openContextMenu(
  fragment: Fragment,
  event: MouseEvent<HTMLElement>,
) {
  event.preventDefault();
  const state = getState();
  const ids = selectSelectedIdSet(state).has(fragment.id)
    ? selectSelectedIds(state)
    : [fragment.id];
  setState({
    contextMenu: {
      fragment,
      fragmentIds: ids,
      x: event.clientX,
      y: event.clientY,
    },
  });
}

export function toggleOverlayContextMenu(
  fragment: Fragment,
  anchor: { x: number; y: number },
) {
  setState((state) => ({
    contextMenu:
      state.contextMenu?.layer === "overlay" &&
      state.contextMenu.fragment.id === fragment.id
        ? null
        : {
            fragment,
            fragmentIds: [fragment.id],
            layer: "overlay",
            x: anchor.x,
            y: anchor.y,
          },
  }));
}

export function closeContextMenu() {
  setState({ contextMenu: null });
}

/** Loads a Fragment's tags once; later calls reuse the cached result. */
export async function ensureFragmentTags(fragment: Fragment) {
  const state = getState();
  const id = fragment.id;
  if (state.previewMode || isDemoFragment(fragment)) {
    if (state.fragmentTagStatusById[id] !== "ready") {
      setState((current) => ({
        fragmentTagsById: Object.prototype.hasOwnProperty.call(
          current.fragmentTagsById,
          id,
        )
          ? current.fragmentTagsById
          : { ...current.fragmentTagsById, [id]: [] },
        fragmentTagStatusById: {
          ...current.fragmentTagStatusById,
          [id]: "ready",
        },
      }));
    }
    return;
  }
  const status = state.fragmentTagStatusById[id];
  if (status === "loading" || status === "ready") return;
  setState((current) => ({
    fragmentTagStatusById: {
      ...current.fragmentTagStatusById,
      [id]: "loading",
    },
  }));
  try {
    const tags = normalizeTags(await getFragmentTags(id));
    setState((current) => ({
      fragmentTagsById: { ...current.fragmentTagsById, [id]: tags },
      fragmentTagStatusById: {
        ...current.fragmentTagStatusById,
        [id]: "ready",
      },
    }));
  } catch (caught) {
    setState((current) => ({
      fragmentTagStatusById: {
        ...current.fragmentTagStatusById,
        [id]: "error",
      },
    }));
    reportError(caught);
  }
}

export function patchFragmentTags(id: string, tags: string[]) {
  setState((current) => ({
    fragmentTagsById: { ...current.fragmentTagsById, [id]: tags },
    fragmentTagStatusById: { ...current.fragmentTagStatusById, [id]: "ready" },
  }));
}

export async function refreshNativeHostStatus() {
  if (!isTauriRuntime()) {
    setState({
      nativeHostStatus: {
        state: "unavailable",
        label: "Desktop app required",
        description: "Native capture is unavailable in browser preview.",
      },
    });
    return;
  }
  setState({ nativeHostStatus: { state: "checking", label: "Checking…" } });
  try {
    const status = await readNativeHostStatus();
    setState({
      nativeHostStatus: {
        state: status.ready ? "ready" : "unavailable",
        label: status.label,
        description:
          status.description ??
          "Chrome can save selected images into Fragment.",
      },
    });
  } catch (caught) {
    setState({
      nativeHostStatus: {
        state: "error",
        label: "Needs attention",
        description: caught instanceof Error ? caught.message : String(caught),
      },
    });
  }
}
