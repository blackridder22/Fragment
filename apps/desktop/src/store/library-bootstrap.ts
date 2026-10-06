import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  canReuseUnfilteredRootSnapshot,
  mergeUniqueFragments,
  readSnapshotMetadata,
} from "../features/library/library-state";
import { normalizeTags } from "../features/tags/tag-editor-model";
import { perfMarkOnce } from "../lib/perf";
import {
  getLibraryRevision,
  getPaletteIndexStatus,
  isTauriRuntime,
  listSmartFrames,
  listTags,
  loadLibrarySnapshot,
  setPalettePriority,
  startPaletteIndexing,
} from "../lib/tauri";
import { containHorizontalWheelGesture } from "../lib/viewport-gesture";
import { writeV7SettingsState } from "../v7/settings-state";
import { dispatchSelection, refreshNativeHostStatus } from "./library-actions";
import { reportError } from "./library-feedback";
import { importPaths } from "./library-import";
import {
  currentPageKey,
  libraryLoader,
  pageNameForView,
  pageOf,
} from "./library-loader";
import {
  selectSelectableIds,
  selectSelectionScopeKey,
  selectThemeMode,
} from "./library-selectors";
import {
  BROWSING_MODE_STORAGE_KEY,
  DELETE_POLICY_STORAGE_KEY,
  FRAME_NAVIGATOR_STORAGE_KEY,
  LIBRARY_PAGE_SIZE,
  RECENT_FRAME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  browserStorage,
  libraryStore,
} from "./library-store";
import type { LibraryState } from "./library-types";

const { getState, setState } = libraryStore;
let snapshotPromise: Promise<void> | null = null;
let queuedSnapshot: Promise<void> | null = null;

/**
 * Full refresh: frames, counts, Smart Frames, tags and the first page.
 *
 * Without `throwOnError` a call joins any refresh already in flight and
 * never rejects. With it, the call waits for the in-flight refresh and then
 * runs one more (shared by every forced caller that arrives meanwhile), so
 * the caller's own backend writes are reflected, and failures reject.
 */
export function refreshSnapshot(throwOnError = false): Promise<void> {
  if (!isTauriRuntime()) {
    setState({ booted: true });
    return Promise.resolve();
  }
  if (snapshotPromise) {
    if (!throwOnError) return snapshotPromise;
    if (!queuedSnapshot) {
      queuedSnapshot = snapshotPromise
        .catch(() => undefined)
        .then(() => {
          queuedSnapshot = null;
          return refreshSnapshot(true);
        });
    }
    return queuedSnapshot;
  }
  snapshotPromise = loadSnapshot(throwOnError).finally(() => {
    snapshotPromise = null;
  });
  return snapshotPromise;
}

async function loadSnapshot(throwOnError: boolean) {
  try {
    setState({ error: null });
    const [snapshot, smartFrames, tags] = await Promise.all([
      loadLibrarySnapshot(LIBRARY_PAGE_SIZE),
      listSmartFrames(),
      listTags(),
    ]);
    perfMarkOnce("first-snapshot");
    const metadata = readSnapshotMetadata(snapshot);
    setState((current) => {
      const next: LibraryState = {
        ...current,
        booted: true,
        defaultFrameId: snapshot.defaultFrame.id,
        frames: snapshot.frames,
        coverFragments: snapshot.fragments,
        frameCounts: metadata.frameCounts,
        trashTotal: metadata.trashTotal,
        assetRoot: snapshot.assetRoot,
        smartFrames,
        knownTags: normalizeTags(tags),
        revision: snapshot.revision,
        // fragmentTagsById / fragmentTagStatusById survive a refresh: nothing
        // refetches them while the focused overlay is open, and tag edits made
        // in-app already patch the cache (patchFragmentTags).
      };
      const reuse = canReuseUnfilteredRootSnapshot({
        frameId: current.selectedFrameId,
        smartFrameId: current.selectedSmartFrameId,
        query: current.query,
        sourceFilter: current.sourceFilter,
        filter: current.fragmentFilter,
        sortMode: current.sortMode,
      });
      const items = mergeUniqueFragments([], snapshot.fragments);
      next.activePage = reuse
        ? {
            key: currentPageKey(next, "active"),
            items,
            total: snapshot.fragmentTotal,
            hasMore: items.length < snapshot.fragmentTotal,
            loading: false,
            error: null,
            paletteRevision: current.activePage.paletteRevision,
          }
        : { ...current.activePage, key: null };
      if (current.trashPage.key !== null) {
        next.trashPage = { ...current.trashPage, key: null };
      }
      return next;
    });
  } catch (caught) {
    reportError(caught);
    if (throwOnError) throw caught;
  }
}

function applyDocumentState(state: LibraryState) {
  if (typeof document === "undefined") return;
  const mode = selectThemeMode(state);
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.themePreference = state.theme;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.dataset.reduceMotion = state.settings.reduceMotion
    ? "true"
    : "false";
}

function writeStorage(key: string, value: string) {
  try {
    browserStorage()?.setItem(key, value);
  } catch {
    // Preferences still apply for this session when storage is unavailable.
  }
}

/** Persists preferences, mirrors theme to the document, reconciles selection. */
export function subscribeLibrarySideEffects() {
  let previous = getState();
  let lastScopeKey = selectSelectionScopeKey(previous);
  let lastSelectable = selectSelectableIds(previous);
  let lastFocusedId: string | null = null;
  let lastFrameId: string | null = null;
  applyDocumentState(previous);
  return libraryStore.subscribe(() => {
    const next = getState();
    const before = previous;
    previous = next;

    if (next.theme !== before.theme)
      writeStorage(THEME_STORAGE_KEY, next.theme);
    if (next.deletePolicy !== before.deletePolicy) {
      writeStorage(DELETE_POLICY_STORAGE_KEY, next.deletePolicy);
    }
    if (next.frameNavigator !== before.frameNavigator) {
      writeStorage(
        FRAME_NAVIGATOR_STORAGE_KEY,
        JSON.stringify(next.frameNavigator),
      );
    }
    if (next.browsingMode !== before.browsingMode) {
      writeStorage(
        BROWSING_MODE_STORAGE_KEY,
        JSON.stringify(next.browsingMode),
      );
    }
    if (next.recentFrameId !== before.recentFrameId && next.recentFrameId) {
      writeStorage(RECENT_FRAME_STORAGE_KEY, next.recentFrameId);
    }
    if (next.settings !== before.settings) writeV7SettingsState(next.settings);
    if (
      next.theme !== before.theme ||
      next.systemPrefersDark !== before.systemPrefersDark ||
      next.settings.reduceMotion !== before.settings.reduceMotion
    ) {
      applyDocumentState(next);
    }

    const scopeKey = selectSelectionScopeKey(next);
    const selectable = selectSelectableIds(next);
    if (scopeKey !== lastScopeKey || selectable !== lastSelectable) {
      lastScopeKey = scopeKey;
      lastSelectable = selectable;
      dispatchSelection({
        type: "reconcile",
        scopeKey,
        matchingIds: selectable,
      });
    }

    const focusedId = next.focused?.fragment.id ?? null;
    if (
      (focusedId !== lastFocusedId || next.selectedFrameId !== lastFrameId) &&
      !next.previewMode &&
      next.assetRoot &&
      (focusedId || next.selectedFrameId) &&
      (next.paletteIndex?.pending ?? 0) > 0
    ) {
      lastFocusedId = focusedId;
      lastFrameId = next.selectedFrameId;
      void setPalettePriority(focusedId, next.selectedFrameId).catch(
        () => undefined,
      );
    }

    if (
      next.paletteIndex?.revision !== before.paletteIndex?.revision &&
      next.fragmentFilter.color
    ) {
      const page = pageNameForView(next.view);
      const revision = page ? pageOf(next, page).paletteRevision : null;
      if (
        revision &&
        next.paletteIndex?.revision &&
        revision !== next.paletteIndex.revision
      ) {
        setState({ colorResultsChanged: true });
      }
    }
  });
}

function startPaletteIndex() {
  let disposed = false;
  const refresh = async () => {
    try {
      const paletteIndex = await getPaletteIndexStatus();
      if (!disposed) setState({ paletteIndex });
    } catch {
      // Focus or the next completion reconciles a transient read failure.
    }
  };
  const subscription = listen("palette-changed", () => void refresh());
  void startPaletteIndexing()
    .then(refresh)
    .catch(() => undefined);
  window.addEventListener("focus", refresh);
  return () => {
    disposed = true;
    window.removeEventListener("focus", refresh);
    void subscription.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

/** Boots the library: snapshot, loader, listeners. Returns a disposer. */
export function startLibrary(): () => void {
  const disposers: Array<() => void> = [subscribeLibrarySideEffects()];

  if (typeof window !== "undefined") {
    const wheel = (event: WheelEvent) => containHorizontalWheelGesture(event);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    disposers.push(() =>
      window.removeEventListener("wheel", wheel, { capture: true }),
    );
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const update = () => setState({ systemPrefersDark: mediaQuery.matches });
      update();
      mediaQuery.addEventListener("change", update);
      disposers.push(() => mediaQuery.removeEventListener("change", update));
    }
  }

  if (!isTauriRuntime()) {
    setState({ booted: true });
    return () => disposers.forEach((dispose) => dispose());
  }

  let disposed = false;
  disposers.push(() => {
    disposed = true;
  });
  disposers.push(libraryLoader.start());
  void refreshSnapshot().then(() => {
    if (!disposed) disposers.push(startPaletteIndex());
  });
  void refreshNativeHostStatus();

  const onFocus = () => {
    if (!getState().settings.refreshOnFocus || snapshotPromise) return;
    void getLibraryRevision()
      .then((revision) => {
        if (revision !== getState().revision) return refreshSnapshot();
        return undefined;
      })
      .catch((caught) => reportError(caught));
  };
  window.addEventListener("focus", onFocus);
  disposers.push(() => window.removeEventListener("focus", onFocus));

  let unlistenDrop: (() => void) | undefined;
  try {
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          void importPaths(event.payload.paths);
        }
      })
      .then((unlisten) => {
        unlistenDrop = unlisten;
      })
      .catch(() => undefined);
  } catch {
    // Drag and drop is unavailable outside the webview.
  }
  disposers.push(() => unlistenDrop?.());

  return () => disposers.forEach((dispose) => dispose());
}
