import { EMPTY_FRAGMENT_FILTER } from "../features/filters/filter-model";
import {
  DEFAULT_FRAME_NAVIGATOR_PREFERENCES,
  parseFrameNavigatorPreferences,
} from "../features/frames/frame-tree";
import { createSelectionState } from "../features/selection/selection-model";
import { createPreviewTrashState } from "../features/trash/preview-trash-state";
import { isTauriRuntime } from "../lib/tauri";
import { readV7SettingsState } from "../v7/settings-state";
import { createStore, createUseStore } from "./create-store";
import type {
  BrowsingMode,
  DeletePolicy,
  LibraryState,
  PageState,
  ThemePreference,
} from "./library-types";

export const THEME_STORAGE_KEY = "fragment-theme";
export const DELETE_POLICY_STORAGE_KEY = "fragment-delete-policy";
export const FRAME_NAVIGATOR_STORAGE_KEY = "fragment-frame-navigator-v2";
export const BROWSING_MODE_STORAGE_KEY = "fragment-browsing-mode-v1";
export const RECENT_FRAME_STORAGE_KEY = "fragment-recent-frame-id";
export const LIBRARY_PAGE_SIZE = 60;

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStorage(storage: StorageLike | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function createPageState(): PageState {
  return {
    key: null,
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    error: null,
    paletteRevision: null,
  };
}

export function parseBrowsingMode(raw: string | null): BrowsingMode {
  try {
    const value = JSON.parse(raw ?? "{}") as Partial<BrowsingMode>;
    return {
      layout: ["masonry", "grid", "list"].includes(value.layout ?? "")
        ? value.layout!
        : "masonry",
      density: ["compact", "comfortable", "large"].includes(value.density ?? "")
        ? value.density!
        : "comfortable",
    };
  } catch {
    return { layout: "masonry", density: "comfortable" };
  }
}

export function parseThemePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function parseDeletePolicy(raw: string | null): DeletePolicy {
  return raw === "forever" ||
    raw === "7" ||
    raw === "14" ||
    raw === "24" ||
    raw === "31"
    ? raw
    : "31";
}

function initialSystemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function createInitialLibraryState(
  options: {
    storage?: StorageLike | null;
    previewMode?: boolean;
    systemPrefersDark?: boolean;
  } = {},
): LibraryState {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const previewMode = options.previewMode ?? !isTauriRuntime();
  return {
    booted: false,
    previewMode,
    assetRoot: "",
    defaultFrameId: null,
    revision: "",

    frames: [],
    frameCounts: {},
    coverFragments: [],
    framePreviews: null,
    framePreviewsRevision: null,
    smartFrames: [],
    knownTags: [],
    trashTotal: 0,
    trashedFrames: [],

    activePage: createPageState(),
    trashPage: createPageState(),
    paletteIndex: null,
    colorResultsChanged: false,

    view: "home",
    selectedFrameId: null,
    selectedSmartFrameId: null,
    frameNavigator: storage
      ? parseFrameNavigatorPreferences(
          readStorage(storage, FRAME_NAVIGATOR_STORAGE_KEY),
        )
      : DEFAULT_FRAME_NAVIGATOR_PREFERENCES,
    recentFrameId: readStorage(storage, RECENT_FRAME_STORAGE_KEY),
    query: "",
    sourceFilter: "all",
    sortMode: "newest",
    fragmentFilter: EMPTY_FRAGMENT_FILTER,
    trashSort: "newest",

    selection: createSelectionState(),
    focused: null,
    fragmentTagsById: {},
    fragmentTagStatusById: {},
    contextMenu: null,
    shortcutsOpen: false,
    frameModal: null,

    theme: parseThemePreference(readStorage(storage, THEME_STORAGE_KEY)),
    systemPrefersDark: options.systemPrefersDark ?? initialSystemPrefersDark(),
    deletePolicy: parseDeletePolicy(
      readStorage(storage, DELETE_POLICY_STORAGE_KEY),
    ),
    settings: readV7SettingsState(storage),
    browsingMode: parseBrowsingMode(
      readStorage(storage, BROWSING_MODE_STORAGE_KEY),
    ),
    nativeHostStatus: previewMode
      ? {
          state: "unavailable",
          label: "Desktop app required",
          description: "Native capture is unavailable in browser preview.",
        }
      : { state: "checking", label: "Checking…" },
    settingsSection: "general",

    pendingImports: [],

    toast: null,
    confirm: null,
    error: null,
    undo: null,
    undoPending: false,

    trashDropState: "idle",
    frameDropTarget: null,

    previewTrashState: createPreviewTrashState(),
    previewFrameAssignments: {},
    previewTitleOverrides: {},
    assetDataUrls: {},
  };
}

export const libraryStore = createStore<LibraryState>(
  createInitialLibraryState(),
);

export const useLibraryStore = createUseStore(libraryStore);

export const getLibraryState = libraryStore.getState;
export const setLibraryState = libraryStore.setState;

/** Replaces the store contents; used by tests to seed a scenario. */
export function resetLibraryStore(
  state: Partial<LibraryState> = {},
  options: Parameters<typeof createInitialLibraryState>[0] = {},
) {
  libraryStore.setState({ ...createInitialLibraryState(options), ...state });
}
