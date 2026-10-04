import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Fragment, Frame } from "@fragment/shared";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { LoaderCircle, Trash2, Undo2, X } from "lucide-react";
import type { SortMode, SourceFilter } from "./components/TopCommandBar";
import { CreateFrameModal } from "./features/frames/CreateFrameModal";
import {
  DEFAULT_FRAME_NAVIGATOR_PREFERENCES,
  aggregateFrameCounts,
  descendantFrameIds,
  frameBreadcrumbs,
  parseFrameNavigatorPreferences,
  resolveFrameDrop,
  type FrameDropTarget,
  type FrameNavigatorPreferences,
} from "./features/frames/frame-tree";
import { DragGhost } from "./features/dragdrop/DragGhost";
import {
  usePointerDragSession,
  type PointerDragPayload,
} from "./features/dragdrop/usePointerDragSession";
import {
  FragmentContextMenu,
  type FragmentContextMenuState,
} from "./features/fragments/FragmentContextMenu";
import {
  EMPTY_FRAGMENT_FILTER,
  filterWithLibraryControls,
  normalizeFragmentFilter,
  type FragmentFilter,
  type SmartFrame,
} from "./features/filters/filter-model";
import {
  importQueueReducer,
  summarizeImportResults,
  type ImportQueueItem,
} from "./features/import/import-state";
import { PendingImportStatus } from "./features/import/PendingImports";
import {
  canReuseUnfilteredRootSnapshot,
  mergeUniqueFragments,
  readSnapshotMetadata,
} from "./features/library/library-state";
import type {
  BrowsingDensity,
  BrowsingLayout,
} from "./features/library/BrowsingModeControl";
import { KeyboardShortcutsHelp } from "./features/library/KeyboardShortcutsHelp";
import { MarqueeOverlay } from "./features/selection/MarqueeOverlay";
import {
  createSelectionState,
  resolveSelectedIds,
  selectionKeyboardIntent,
  selectionReducer,
} from "./features/selection/selection-model";
import { useMarqueeSelection } from "./features/selection/useMarqueeSelection";
import type { AssetSource } from "./lib/assets";
import { usePaletteIndex } from "./features/colors/useFragmentPalette";
import {
  addExistingFragmentToFrame,
  assetUrl,
  cancelImportJob,
  copyFragmentImage,
  createFrame,
  createSmartFrame,
  deleteFragment,
  deleteFragmentEverywhere,
  deleteFragments,
  deleteFrame,
  deleteSmartFrame,
  emptyTrash as emptyNativeTrash,
  ensureSvgPreview,
  fragmentMembershipCount,
  getFragmentTags,
  getLibraryRevision,
  importImageBatch,
  isTauriRuntime,
  setPalettePriority,
  listFragmentIds,
  listFragmentPage,
  listFramePreviews,
  listSmartFrames,
  listTags,
  listTrashedFrames,
  loadLibrarySnapshot,
  loadAssetDataUrl,
  moveFrame,
  moveFragmentToFrame,
  nativeHostStatus as readNativeHostStatus,
  openFragmentSource,
  renameFrame,
  revealFragmentInFinder,
  revealVaultInFinder,
  restoreFragments,
  restoreFrame,
  setFragmentTags,
  updateFragment,
  updateSmartFrame,
  type FramePreview,
  type ImportBatchEvent,
} from "./lib/tauri";
import { demoFrames, demoFragments, isDemoFragment } from "./lib/demo-vault";
import { containHorizontalWheelGesture } from "./lib/viewport-gesture";
import {
  createPreviewTrashState,
  movePreviewItemsToTrash,
  previewIdsAtLocation,
  purgePreviewTrash,
  restorePreviewItems,
} from "./features/trash/preview-trash-state";
import { DesktopShell, LibraryToolbar, type V7View } from "./v7/DesktopShell";
import { FramesPage } from "./v7/FramesPage";
import { VaultPage } from "./v7/VaultPage";
import { FOLDER_PREVIEW_LIMIT } from "./v7/vault-home";
import {
  runRecoverableTrashAction,
  TrashPage as V7TrashPage,
  type TrashSort,
} from "./v7/TrashPage";
import {
  SettingsPage as V7SettingsPage,
  type DeletePolicy,
  type NativeHostStatus,
  type ThemePreference,
} from "./v7/SettingsPage";
import { SelectionActionBar } from "./v7/SelectionActionBar";
import { FocusedFrameOverlay } from "./v7/FocusedFrameOverlay";
import { readV7SettingsState, writeV7SettingsState } from "./v7/settings-state";
import {
  formatShortcutBinding,
  matchesShortcut,
} from "./features/shortcuts/shortcut-model";
import { addTag, normalizeTags } from "./features/tags/tag-editor-model";
import { normalizeFragmentTitle } from "./features/fragments/fragment-title-policy";

type FrameModalState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; frame: Frame }
  | null;

type ThemeMode = Exclude<ThemePreference, "system">;
type TagLoadStatus = "loading" | "ready" | "error";
type TrashDropState = "idle" | "armed" | "success";
type TrashUndoState =
  | { kind: "fragments"; ids: string[]; label: string }
  | { kind: "frame"; frameId: string; label: string }
  | { kind: "import-summary"; ids: string[]; label: string }
  | null;

const THEME_STORAGE_KEY = "fragment-theme";
const DELETE_POLICY_STORAGE_KEY = "fragment-delete-policy";
const FRAME_NAVIGATOR_STORAGE_KEY = "fragment-frame-navigator-v2";
const LIBRARY_PAGE_SIZE = 60;
const BROWSING_MODE_STORAGE_KEY = "fragment-browsing-mode-v1";
const RECENT_FRAME_STORAGE_KEY = "fragment-recent-frame-id";
const EMPTY_FRAGMENT_IDS: string[] = [];

function initialRecentFrameId(): string | null {
  try {
    return window.localStorage.getItem(RECENT_FRAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function initialBrowsingMode(): {
  layout: BrowsingLayout;
  density: BrowsingDensity;
} {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(BROWSING_MODE_STORAGE_KEY) ?? "{}",
    ) as { layout?: BrowsingLayout; density?: BrowsingDensity };
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

function initialTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : "system";
  } catch {
    return "system";
  }
}

function initialSystemPrefersDark() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function initialDeletePolicy(): DeletePolicy {
  if (typeof window === "undefined") {
    return "31";
  }
  const stored = window.localStorage.getItem(DELETE_POLICY_STORAGE_KEY);
  return stored === "forever" ||
    stored === "7" ||
    stored === "14" ||
    stored === "24" ||
    stored === "31"
    ? stored
    : "31";
}

function initialFrameNavigatorPreferences(): FrameNavigatorPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_FRAME_NAVIGATOR_PREFERENCES;
  }
  return parseFrameNavigatorPreferences(
    window.localStorage.getItem(FRAME_NAVIGATOR_STORAGE_KEY),
  );
}

function resolvedThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeMode {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

function isTransparentAsset(fragment: Fragment) {
  const mimeType = fragment.mimeType?.toLowerCase() ?? "";
  const originalPath = fragment.originalPath.toLowerCase();
  return (
    mimeType.includes("png") ||
    (!fragment.id.startsWith("demo-") && originalPath.endsWith(".png"))
  );
}

function matchesSourceFilter(fragment: Fragment, filter: SourceFilter) {
  const hasSource = Boolean(fragment.sourceUrl || fragment.pageUrl);
  if (filter === "source") {
    return hasSource;
  }
  if (filter === "local") {
    return !hasSource;
  }
  if (filter === "png") {
    return isTransparentAsset(fragment);
  }
  return true;
}

function compareFragments(left: Fragment, right: Fragment, sortMode: SortMode) {
  if (sortMode === "name") {
    return (left.title ?? "").localeCompare(right.title ?? "");
  }
  if (sortMode === "largest") {
    return (right.fileSize ?? 0) - (left.fileSize ?? 0);
  }
  const leftTime = Date.parse(left.capturedAt || left.createdAt);
  const rightTime = Date.parse(right.capturedAt || right.createdAt);
  return sortMode === "oldest" ? leftTime - rightTime : rightTime - leftTime;
}

function compareFrames(
  left: Frame,
  right: Frame,
  sortMode: SortMode,
  counts: Map<string, number>,
) {
  if (sortMode === "name") {
    return left.name.localeCompare(right.name);
  }
  if (sortMode === "largest") {
    return (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
  }
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  return sortMode === "oldest" ? leftTime - rightTime : rightTime - leftTime;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.filter((value): value is string => Boolean(value && value.trim())),
    ),
  );
}

function operationId(prefix: string) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36);
  return `${prefix}-${suffix}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<V7View>("home");
  const [assetRoot, setAssetRoot] = useState("");
  const paletteIndex = usePaletteIndex(Boolean(assetRoot));
  const activePaletteRevision = useRef<string | null>(null);
  const trashPaletteRevision = useRef<string | null>(null);
  const [colorResultsChanged, setColorResultsChanged] = useState(false);
  const [defaultFrameId, setDefaultFrameId] = useState<string | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [framePreviewFragments, setFramePreviewFragments] = useState<
    Fragment[]
  >([]);
  const [frameFragmentCounts, setFrameFragmentCounts] = useState<
    Record<string, number>
  >({});
  const [libraryRevision, setLibraryRevision] = useState("");
  const [framePreviews, setFramePreviews] = useState<FramePreview[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [activePageLoading, setActivePageLoading] = useState(false);
  const [trashedFragments, setTrashedFragments] = useState<Fragment[]>([]);
  const [trashedFrames, setTrashedFrames] = useState<Frame[]>([]);
  const [trashTotal, setTrashTotal] = useState(0);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashSort, setTrashSort] = useState<TrashSort>("newest");
  const [previewTrashState, setPreviewTrashState] = useState(
    createPreviewTrashState,
  );
  const [previewFrameAssignments, setPreviewFrameAssignments] = useState<
    Record<string, string>
  >({});
  const [previewTitleOverrides, setPreviewTitleOverrides] = useState<
    Record<string, string>
  >({});
  const [pendingImports, dispatchImportQueue] = useReducer(
    importQueueReducer,
    [],
  );
  const [assetDataUrls, setAssetDataUrls] = useState<Record<string, string>>(
    {},
  );
  const assetFallbackRequests = useRef<
    Partial<Record<string, Promise<string | null>>>
  >({});
  const svgRepairs = useRef(new Map<string, Promise<void>>());
  const revisionRef = useRef("");
  const activeTotalRef = useRef(0);
  const activeNextOffsetRef = useRef(0);
  const selectedFrameIdRef = useRef<string | null>(null);
  const recentFrameIdRef = useRef<string | null>(initialRecentFrameId());
  const selectedSmartFrameIdRef = useRef<string | null>(null);
  const activePageFrameIdRef = useRef<string | null>(null);
  const includeDescendantsRef = useRef(false);
  const fragmentsRef = useRef<Fragment[]>([]);
  const trashedFragmentsRef = useRef<Fragment[]>([]);
  const trashLoadedRef = useRef(false);
  const trashLoadAttemptedRef = useRef(false);
  const snapshotLoadingRef = useRef(false);
  const activePageRequestRef = useRef(0);
  const trashPageRequestRef = useRef(0);
  const activePageLoadingRef = useRef(false);
  const trashPageLoadingRef = useRef(false);
  const activeHasMoreRef = useRef(false);
  const trashHasMoreRef = useRef(false);
  const trashNextOffsetRef = useRef(0);
  const trashSortRef = useRef<TrashSort>("newest");
  const completedImportRequests = useRef(new Set<string>());
  const importPathsRef = useRef<(paths: string[]) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<Fragment | null>(
    null,
  );
  const [selectedFragmentReferenceCount, setSelectedFragmentReferenceCount] =
    useState(1);
  const [inspectorTags, setInspectorTags] = useState<string[]>([]);
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    createSelectionState(),
  );
  const [frameModal, setFrameModal] = useState<FrameModalState>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [fragmentFilter, setFragmentFilter] = useState<FragmentFilter>(
    EMPTY_FRAGMENT_FILTER,
  );
  const [smartFrames, setSmartFrames] = useState<SmartFrame[]>([]);
  const [selectedSmartFrameId, setSelectedSmartFrameId] = useState<
    string | null
  >(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [browsingMode, setBrowsingMode] = useState(initialBrowsingMode);
  const [quickPreviewFragment, setQuickPreviewFragment] =
    useState<Fragment | null>(null);
  const focusedFragmentSource = selectedFragment ?? quickPreviewFragment;
  const focusedFragment = focusedFragmentSource
    ? {
        ...focusedFragmentSource,
        title:
          previewTitleOverrides[focusedFragmentSource.id] ??
          focusedFragmentSource.title,
      }
    : null;
  const focusedFragmentId = focusedFragment?.id ?? null;
  useEffect(() => {
    if (isTauriRuntime() && assetRoot) {
      void setPalettePriority(focusedFragmentId, selectedFrameId).catch(
        () => undefined,
      );
    }
  }, [assetRoot, focusedFragmentId, selectedFrameId]);
  const focusedFragmentIsDemo = focusedFragment
    ? isDemoFragment(focusedFragment)
    : false;
  const [fragmentTagsById, setFragmentTagsById] = useState<
    Record<string, string[]>
  >({});
  const [fragmentTagStatusById, setFragmentTagStatusById] = useState<
    Record<string, TagLoadStatus>
  >({});
  const [fragmentContextMenu, setFragmentContextMenu] =
    useState<FragmentContextMenuState | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [deletePolicy, setDeletePolicy] =
    useState<DeletePolicy>(initialDeletePolicy);
  const [v7Settings, setV7Settings] = useState(readV7SettingsState);
  const [nativeHostStatus, setNativeHostStatus] = useState<NativeHostStatus>(
    () =>
      isTauriRuntime()
        ? { state: "checking", label: "Checking…" }
        : {
            state: "unavailable",
            label: "Desktop app required",
            description: "Native capture is unavailable in browser preview.",
          },
  );
  const [frameNavigator, setFrameNavigator] = useState(
    initialFrameNavigatorPreferences,
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    initialSystemPrefersDark,
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [dragActive, setDragActive] = useState(false);
  const [trashDropState, setTrashDropState] = useState<TrashDropState>("idle");
  const [frameDropTarget, setFrameDropTarget] = useState<string | null>(null);
  const [trashUndo, setTrashUndo] = useState<TrashUndoState>(null);
  const [trashUndoPending, setTrashUndoPending] = useState(false);
  const trashUndoTimer = useRef<number | null>(null);
  const trashUndoPendingRef = useRef(false);
  const fragmentFilterRef = useRef<FragmentFilter>(EMPTY_FRAGMENT_FILTER);
  const queryRef = useRef("");
  const sourceFilterRef = useRef<SourceFilter>("all");
  const sortModeRef = useRef<SortMode>("newest");
  const previewMode = !isTauriRuntime();

  useEffect(() => {
    const containHorizontalTrackpadGesture = (event: WheelEvent) => {
      containHorizontalWheelGesture(event);
    };

    window.addEventListener("wheel", containHorizontalTrackpadGesture, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener("wheel", containHorizontalTrackpadGesture, {
        capture: true,
      });
    };
  }, []);

  const rememberRevision = useCallback((revision: string) => {
    revisionRef.current = revision;
    setLibraryRevision(revision);
  }, []);

  const refreshNativeHostStatus = useCallback(async () => {
    if (!isTauriRuntime()) {
      setNativeHostStatus({
        state: "unavailable",
        label: "Desktop app required",
        description: "Native capture is unavailable in browser preview.",
      });
      return;
    }
    setNativeHostStatus({ state: "checking", label: "Checking…" });
    try {
      const hostStatus = await readNativeHostStatus();
      setNativeHostStatus({
        state: hostStatus.ready ? "ready" : "unavailable",
        label: hostStatus.label,
        description:
          hostStatus.description ??
          "Chrome can save selected images into Fragment.",
      });
    } catch (caught) {
      setNativeHostStatus({
        state: "error",
        label: "Needs attention",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }, []);

  const loadActivePage = useCallback(
    async (
      frameId: string | null,
      reset: boolean,
      includeDescendants = includeDescendantsRef.current,
      throwOnError = false,
    ) => {
      if (
        !isTauriRuntime() ||
        (!reset && (!activeHasMoreRef.current || activePageLoadingRef.current))
      ) {
        return;
      }
      activePageLoadingRef.current = true;
      const requestId = ++activePageRequestRef.current;
      const offset = reset ? 0 : activeNextOffsetRef.current;
      setActivePageLoading(true);
      try {
        const page = await listFragmentPage({
          frameId,
          includeDescendants: Boolean(frameId && includeDescendants),
          offset,
          limit: LIBRARY_PAGE_SIZE,
          filter: filterWithLibraryControls(
            fragmentFilterRef.current,
            queryRef.current,
            sourceFilterRef.current,
          ),
          sortMode: sortModeRef.current,
        });
        if (
          requestId !== activePageRequestRef.current ||
          selectedFrameIdRef.current !== frameId ||
          includeDescendantsRef.current !== includeDescendants
        ) {
          return;
        }
        const nextFragments = reset
          ? mergeUniqueFragments([], page.items)
          : mergeUniqueFragments(fragmentsRef.current, page.items);
        if (
          fragmentFilterRef.current.color &&
          !reset &&
          activePaletteRevision.current !== page.paletteRevision
        ) {
          setColorResultsChanged(true);
          return;
        }
        activePaletteRevision.current = page.paletteRevision ?? null;
        if (reset) setColorResultsChanged(false);
        fragmentsRef.current = nextFragments;
        setFragments(nextFragments);
        activePageFrameIdRef.current = frameId;
        activeNextOffsetRef.current = page.offset + page.items.length;
        activeTotalRef.current = page.total;
        setActiveTotal(page.total);
        activeHasMoreRef.current = page.hasMore;
        setActiveHasMore(page.hasMore);
        rememberRevision(page.revision);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("Library page failed");
        if (throwOnError) {
          throw caught;
        }
      } finally {
        if (requestId === activePageRequestRef.current) {
          activePageLoadingRef.current = false;
          setActivePageLoading(false);
        }
      }
    },
    [rememberRevision],
  );

  const loadTrashPage = useCallback(
    async (
      reset: boolean,
      throwOnError = false,
      requestedSort = trashSortRef.current,
    ) => {
      if (
        !isTauriRuntime() ||
        (!reset && (!trashHasMoreRef.current || trashPageLoadingRef.current))
      ) {
        return;
      }
      trashPageLoadingRef.current = true;
      const requestId = ++trashPageRequestRef.current;
      const offset = reset ? 0 : trashNextOffsetRef.current;
      setTrashLoading(true);
      try {
        const [page, deletedFrames] = await Promise.all([
          listFragmentPage({
            trashed: true,
            offset,
            limit: LIBRARY_PAGE_SIZE,
            filter: filterWithLibraryControls(
              fragmentFilterRef.current,
              queryRef.current,
              sourceFilterRef.current,
            ),
            sortMode: requestedSort === "oldest" ? "deleted-oldest" : "deleted",
          }),
          reset ? listTrashedFrames() : Promise.resolve(null),
        ]);
        if (requestId !== trashPageRequestRef.current) {
          return;
        }
        if (
          fragmentFilterRef.current.color &&
          !reset &&
          trashPaletteRevision.current !== page.paletteRevision
        ) {
          setColorResultsChanged(true);
          return;
        }
        trashPaletteRevision.current = page.paletteRevision ?? null;
        if (reset) setColorResultsChanged(false);
        const nextFragments = reset
          ? mergeUniqueFragments([], page.items)
          : mergeUniqueFragments(trashedFragmentsRef.current, page.items);
        trashedFragmentsRef.current = nextFragments;
        setTrashedFragments(nextFragments);
        trashNextOffsetRef.current = page.offset + page.items.length;
        setTrashTotal(page.total);
        trashHasMoreRef.current = page.hasMore;
        setTrashHasMore(page.hasMore);
        if (deletedFrames) {
          setTrashedFrames(deletedFrames);
        }
        trashLoadedRef.current = true;
        setTrashLoaded(true);
        rememberRevision(page.revision);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("Trash failed to load");
        if (throwOnError) {
          throw caught;
        }
      } finally {
        if (requestId === trashPageRequestRef.current) {
          trashPageLoadingRef.current = false;
          setTrashLoading(false);
        }
      }
    },
    [rememberRevision],
  );

  const loadNextActivePage = useCallback(() => {
    void loadActivePage(selectedFrameIdRef.current, false);
  }, [loadActivePage]);

  const loadNextTrashPage = useCallback(() => {
    void loadTrashPage(false);
  }, [loadTrashPage]);

  const refreshSnapshot = useCallback(
    async (throwOnError = false) => {
      if (!isTauriRuntime()) {
        setFrames([]);
        setFragments([]);
        fragmentsRef.current = [];
        activeNextOffsetRef.current = 0;
        setFramePreviewFragments([]);
        setFrameFragmentCounts({});
        setTrashedFragments([]);
        setTrashedFrames([]);
        trashedFragmentsRef.current = [];
        trashNextOffsetRef.current = 0;
        setTrashLoaded(false);
        trashLoadedRef.current = false;
        trashLoadAttemptedRef.current = false;
        setAssetRoot("");
        setDefaultFrameId(null);
        activeTotalRef.current = 0;
        setActiveTotal(0);
        activeHasMoreRef.current = false;
        setActiveHasMore(false);
        trashHasMoreRef.current = false;
        setTrashHasMore(false);
        setError(null);
        setStatus("Browser preview");
        return;
      }
      if (snapshotLoadingRef.current) {
        if (throwOnError) {
          throw new Error("The library is already refreshing. Try again.");
        }
        return;
      }

      snapshotLoadingRef.current = true;
      try {
        setError(null);
        const [snapshot, nextSmartFrames, nextTags] = await Promise.all([
          loadLibrarySnapshot(LIBRARY_PAGE_SIZE),
          listSmartFrames(),
          listTags(),
        ]);
        const metadata = readSnapshotMetadata(snapshot);
        setDefaultFrameId(snapshot.defaultFrame.id);
        setFrames(snapshot.frames);
        setFramePreviewFragments(snapshot.fragments);
        setFrameFragmentCounts(metadata.frameCounts);
        setTrashTotal(metadata.trashTotal);
        setAssetRoot(snapshot.assetRoot);
        setSmartFrames(nextSmartFrames);
        setKnownTags(nextTags);
        rememberRevision(snapshot.revision);

        const activeFrameId = selectedFrameIdRef.current;
        if (
          canReuseUnfilteredRootSnapshot({
            frameId: activeFrameId,
            smartFrameId: selectedSmartFrameIdRef.current,
            query: queryRef.current,
            sourceFilter: sourceFilterRef.current,
            filter: fragmentFilterRef.current,
            sortMode: sortModeRef.current,
          })
        ) {
          const nextFragments = mergeUniqueFragments([], snapshot.fragments);
          fragmentsRef.current = nextFragments;
          setFragments(nextFragments);
          activePageFrameIdRef.current = null;
          activeNextOffsetRef.current = snapshot.fragments.length;
          activeTotalRef.current = snapshot.fragmentTotal;
          setActiveTotal(snapshot.fragmentTotal);
          const hasMore = snapshot.fragments.length < snapshot.fragmentTotal;
          activeHasMoreRef.current = hasMore;
          setActiveHasMore(hasMore);
        } else {
          await loadActivePage(
            activeFrameId,
            true,
            includeDescendantsRef.current,
            throwOnError,
          );
        }
        if (trashLoadedRef.current) {
          await loadTrashPage(true, throwOnError);
        }
        setStatus("Native host ready");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("Needs setup");
        if (throwOnError) {
          throw caught;
        }
      } finally {
        snapshotLoadingRef.current = false;
      }
    },
    [loadActivePage, loadTrashPage, rememberRevision],
  );

  const resolvedTheme = resolvedThemePreference(theme, systemPrefersDark);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemPrefersDark(mediaQuery.matches);
    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = theme;
    document.documentElement.style.colorScheme = resolvedTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Appearance should still work when storage is unavailable.
    }
  }, [resolvedTheme, theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DELETE_POLICY_STORAGE_KEY, deletePolicy);
    } catch {
      // Delete still works when storage is unavailable.
    }
  }, [deletePolicy]);

  useEffect(() => {
    writeV7SettingsState(v7Settings);
    document.documentElement.dataset.reduceMotion = v7Settings.reduceMotion
      ? "true"
      : "false";
  }, [v7Settings]);

  useEffect(() => {
    includeDescendantsRef.current = frameNavigator.includeDescendants;
    try {
      window.localStorage.setItem(
        FRAME_NAVIGATOR_STORAGE_KEY,
        JSON.stringify(frameNavigator),
      );
    } catch {
      // Navigation remains usable when storage is unavailable.
    }
  }, [frameNavigator]);

  useEffect(() => {
    revisionRef.current = libraryRevision;
  }, [libraryRevision]);

  const showVaultHome =
    activeView === "home" &&
    !selectedFrameId &&
    !selectedSmartFrameId &&
    !fragmentFilter.color;

  useEffect(() => {
    // One read-only call per library revision while the home page is visible.
    if (!showVaultHome || !libraryRevision || !isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    void listFramePreviews(FOLDER_PREVIEW_LIMIT)
      .then((previews) => {
        if (!cancelled) setFramePreviews(previews);
      })
      .catch(() => {
        // Folder collages fall back to the loaded page when previews are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [libraryRevision, showVaultHome]);

  const framePreviewMap = useMemo(
    () =>
      new Map(
        framePreviews.map((preview) => [preview.frameId, preview.fragments]),
      ),
    [framePreviews],
  );

  useEffect(() => {
    selectedFrameIdRef.current = selectedFrameId;
    if (selectedFrameId) {
      recentFrameIdRef.current = selectedFrameId;
      try {
        window.localStorage.setItem(RECENT_FRAME_STORAGE_KEY, selectedFrameId);
      } catch {
        // The current session still remembers the recent destination.
      }
    }
  }, [selectedFrameId]);

  useEffect(() => {
    selectedSmartFrameIdRef.current = selectedSmartFrameId;
  }, [selectedSmartFrameId]);

  useEffect(() => {
    fragmentFilterRef.current = fragmentFilter;
    queryRef.current = query;
    sourceFilterRef.current = sourceFilter;
    sortModeRef.current = sortMode;
  }, [fragmentFilter, query, sortMode, sourceFilter]);

  useEffect(() => {
    const revision =
      activeView === "trash"
        ? trashPaletteRevision.current
        : activePaletteRevision.current;
    if (
      fragmentFilter.color &&
      revision &&
      paletteIndex?.revision &&
      revision !== paletteIndex.revision
    )
      setColorResultsChanged(true);
  }, [activeView, fragmentFilter.color, paletteIndex?.revision]);

  useEffect(() => {
    trashSortRef.current = trashSort;
  }, [trashSort]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        BROWSING_MODE_STORAGE_KEY,
        JSON.stringify(browsingMode),
      );
    } catch {
      // Browsing controls still work when storage is unavailable.
    }
  }, [browsingMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      if (activeView === "home" || activeView === "frames") {
        void loadActivePage(selectedFrameIdRef.current, true);
      } else if (activeView === "trash" && trashLoadedRef.current) {
        void loadTrashPage(true);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    activeView,
    fragmentFilter,
    loadActivePage,
    loadTrashPage,
    query,
    sortMode,
    sourceFilter,
  ]);

  useEffect(() => {
    const fragment = selectedFragment;
    if (!fragment || isDemoFragment(fragment) || !isTauriRuntime()) {
      setSelectedFragmentReferenceCount(1);
      return;
    }
    let cancelled = false;
    void fragmentMembershipCount(fragment.id)
      .then((count) => {
        if (!cancelled) {
          setSelectedFragmentReferenceCount(Math.max(1, count));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedFragmentReferenceCount(1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFragment]);

  useEffect(() => {
    fragmentsRef.current = fragments;
  }, [fragments]);

  useEffect(() => {
    activeTotalRef.current = activeTotal;
  }, [activeTotal]);

  useEffect(() => {
    trashedFragmentsRef.current = trashedFragments;
  }, [trashedFragments]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    void refreshNativeHostStatus();
  }, [refreshNativeHostStatus]);

  useEffect(
    () => () => {
      if (trashUndoTimer.current !== null) {
        window.clearTimeout(trashUndoTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onFocus = () => {
      if (
        !v7Settings.refreshOnFocus ||
        !isTauriRuntime() ||
        snapshotLoadingRef.current
      ) {
        return;
      }
      void getLibraryRevision()
        .then((revision) => {
          if (revision !== revisionRef.current) {
            return refreshSnapshot();
          }
          return undefined;
        })
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : String(caught));
          setStatus("Revision check failed");
        });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSnapshot, v7Settings.refreshOnFocus]);

  useEffect(() => {
    if (
      activeView === "trash" &&
      !trashLoaded &&
      !trashLoading &&
      !trashLoadAttemptedRef.current
    ) {
      trashLoadAttemptedRef.current = true;
      void loadTrashPage(true);
    }
  }, [activeView, loadTrashPage, trashLoaded, trashLoading]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let dispose: (() => void) | undefined;
    try {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDragActive(true);
          }
          if (event.payload.type === "leave") {
            setDragActive(false);
          }
          if (event.payload.type === "drop") {
            setDragActive(false);
            void importPathsRef.current(event.payload.paths);
          }
        })
        .then((unlisten) => {
          dispose = unlisten;
        })
        .catch(() => {
          setDragActive(false);
        });
    } catch {
      setDragActive(false);
    }
    return () => dispose?.();
  }, []);

  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );

  const cachedFragments = useMemo(
    () => mergeUniqueFragments(framePreviewFragments, fragments),
    [framePreviewFragments, fragments],
  );

  const counts = useMemo(() => {
    const next = new Map<string, number>(
      Object.entries(frameFragmentCounts).map(([frameId, count]) => [
        frameId,
        count,
      ]),
    );
    if (next.size === 0) {
      for (const fragment of cachedFragments) {
        next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
      }
    }
    return next;
  }, [cachedFragments, frameFragmentCounts]);

  const demoFragmentIds = useMemo(
    () => demoFragments.map((fragment) => fragment.id),
    [],
  );

  const activeDemoFragmentIdSet = useMemo(
    () =>
      new Set(
        previewIdsAtLocation(demoFragmentIds, previewTrashState, "active"),
      ),
    [demoFragmentIds, previewTrashState],
  );

  const activeDemoFragments = useMemo(
    () =>
      demoFragments
        .filter((fragment) => activeDemoFragmentIdSet.has(fragment.id))
        .map((fragment) => {
          const frameId = previewFrameAssignments[fragment.id];
          const title = previewTitleOverrides[fragment.id];
          return frameId || title !== undefined
            ? {
                ...fragment,
                frameId: frameId ?? fragment.frameId,
                title: title ?? fragment.title,
              }
            : fragment;
        }),
    [activeDemoFragmentIdSet, previewFrameAssignments, previewTitleOverrides],
  );

  const previewTrashedDemoFragments = useMemo(() => {
    const byId = new Map(
      demoFragments.map((fragment) => {
        const frameId = previewFrameAssignments[fragment.id];
        const title = previewTitleOverrides[fragment.id];
        return [
          fragment.id,
          frameId || title !== undefined
            ? {
                ...fragment,
                frameId: frameId ?? fragment.frameId,
                title: title ?? fragment.title,
              }
            : fragment,
        ];
      }),
    );
    return previewIdsAtLocation(demoFragmentIds, previewTrashState, "trashed")
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
  }, [
    demoFragmentIds,
    previewFrameAssignments,
    previewTitleOverrides,
    previewTrashState,
  ]);

  const demoCounts = useMemo(() => {
    const next = new Map<string, number>();
    for (const fragment of activeDemoFragments) {
      next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
    }
    return next;
  }, [activeDemoFragments]);

  const activeFrameUniverse =
    frames.length > 0 ? frames : previewMode ? demoFrames : [];
  const selectedFrameScopeIds = useMemo(() => {
    if (!selectedFrameId) return null;
    return new Set(
      frameNavigator.includeDescendants
        ? descendantFrameIds(activeFrameUniverse, selectedFrameId)
        : [selectedFrameId],
    );
  }, [activeFrameUniverse, frameNavigator.includeDescendants, selectedFrameId]);

  const filteredFragments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return fragments
      .filter((fragment) => {
        if (
          selectedFrameScopeIds &&
          !selectedFrameScopeIds.has(fragment.frameId)
        ) {
          return false;
        }
        if (!matchesSourceFilter(fragment, sourceFilter)) {
          return false;
        }
        if (!normalized) {
          return true;
        }
        return [
          fragment.title,
          fragment.description,
          fragment.note,
          fragment.sourceUrl,
          fragment.pageUrl,
          frameById.get(fragment.frameId)?.name,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalized));
      })
      .sort((left, right) => compareFragments(left, right, sortMode));
  }, [
    fragments,
    frameById,
    query,
    selectedFrameScopeIds,
    sortMode,
    sourceFilter,
  ]);

  const demoFrameById = useMemo(
    () => new Map(demoFrames.map((frame) => [frame.id, frame])),
    [],
  );

  const showDemoGallery = previewMode && filteredFragments.length === 0;
  const galleryFragments = useMemo(
    () =>
      showDemoGallery
        ? activeDemoFragments
            .filter((fragment) => {
              const normalized = query.trim().toLowerCase();
              if (
                selectedFrameScopeIds &&
                !selectedFrameScopeIds.has(fragment.frameId)
              ) {
                return false;
              }
              if (!normalized) {
                return matchesSourceFilter(fragment, sourceFilter);
              }
              if (!matchesSourceFilter(fragment, sourceFilter)) {
                return false;
              }
              return [
                fragment.title,
                demoFrameById.get(fragment.frameId)?.name,
                fragment.siteName,
              ]
                .filter(Boolean)
                .some((value) => value!.toLowerCase().includes(normalized));
            })
            .sort((left, right) => compareFragments(left, right, sortMode))
        : filteredFragments,
    [
      activeDemoFragments,
      demoFrameById,
      filteredFragments,
      query,
      selectedFrameScopeIds,
      showDemoGallery,
      sortMode,
      sourceFilter,
    ],
  );
  const galleryTotal = showDemoGallery ? galleryFragments.length : activeTotal;
  // "Recently added" always reads the newest-first snapshot page, whatever the gallery sort is.
  const vaultRecentFragments =
    query.trim() || previewMode ? galleryFragments : framePreviewFragments;

  const selectedDisplayFrame = selectedFrameId
    ? (frameById.get(selectedFrameId) ??
      (previewMode ? demoFrameById.get(selectedFrameId) : undefined) ??
      null)
    : null;
  const displayFrames = activeFrameUniverse;
  const displayCounts =
    frames.length > 0 ? counts : previewMode ? demoCounts : new Map();
  const recursiveDisplayCounts = useMemo(
    () => aggregateFrameCounts(displayFrames, displayCounts),
    [displayCounts, displayFrames],
  );
  const visibleFrames = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sourceFragments =
      frames.length > 0 ? cachedFragments : activeDemoFragments;
    const matchingFrameIds =
      sourceFilter === "all"
        ? null
        : new Set(
            sourceFragments
              .filter((fragment) => matchesSourceFilter(fragment, sourceFilter))
              .map((fragment) => fragment.frameId),
          );

    return displayFrames
      .filter((frame) => {
        if (matchingFrameIds && !matchingFrameIds.has(frame.id)) {
          return false;
        }
        if (!normalized) {
          return true;
        }
        if (frame.name.toLowerCase().includes(normalized)) {
          return true;
        }
        return sourceFragments.some(
          (fragment) =>
            fragment.frameId === frame.id &&
            [
              fragment.title,
              fragment.description,
              fragment.note,
              fragment.sourceUrl,
              fragment.pageUrl,
            ]
              .filter(Boolean)
              .some((value) => value!.toLowerCase().includes(normalized)),
        );
      })
      .sort((left, right) =>
        compareFrames(left, right, sortMode, displayCounts),
      );
  }, [
    counts,
    demoCounts,
    displayCounts,
    displayFrames,
    cachedFragments,
    activeDemoFragments,
    frames.length,
    query,
    sortMode,
    sourceFilter,
  ]);
  const mainTitle = selectedDisplayFrame
    ? selectedDisplayFrame.name
    : (smartFrames.find((item) => item.id === selectedSmartFrameId)?.name ??
      "Your Vault");
  const mainSubtitle = showDemoGallery
    ? previewMode
      ? "Sample wall"
      : "No Frames yet"
    : `${activeTotal} ${activeTotal === 1 ? "Frame" : "Frames"}`;
  const commandTitle =
    activeView === "settings"
      ? "Settings"
      : activeView === "trash"
        ? "Trash"
        : activeView === "frames"
          ? "Frames"
          : mainTitle;
  const commandSubtitle =
    activeView === "settings"
      ? "Vault and native bridge"
      : activeView === "trash"
        ? trashLoading && !trashLoaded
          ? "Loading Trash"
          : `${trashTotal + trashedFrames.length} ${trashTotal + trashedFrames.length === 1 ? "item" : "items"}`
        : activeView === "frames"
          ? `${galleryTotal} ${galleryTotal === 1 ? "Frame" : "Frames"}`
          : mainSubtitle;
  const showEmptyState =
    !showDemoGallery &&
    galleryFragments.length === 0 &&
    pendingImports.length === 0 &&
    !activePageLoading &&
    !activeHasMore;
  const failedImportCount = pendingImports.filter(
    (item) => item.status === "failed",
  ).length;
  const activeImportCount = pendingImports.length - failedImportCount;
  const visibleFragmentIds = useMemo(
    () => galleryFragments.map((fragment) => fragment.id),
    [galleryFragments],
  );
  const visibleTrashedFragments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return trashedFragments
      .filter((fragment) => {
        if (!matchesSourceFilter(fragment, sourceFilter)) {
          return false;
        }
        if (!normalized) {
          return true;
        }
        return [
          fragment.title,
          fragment.description,
          fragment.note,
          fragment.sourceUrl,
          fragment.pageUrl,
          frameById.get(fragment.frameId)?.name,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalized));
      })
      .sort((left, right) => compareFragments(left, right, sortMode));
  }, [frameById, query, sortMode, sourceFilter, trashedFragments]);
  const visibleTrashedFragmentIds = useMemo(
    () => visibleTrashedFragments.map((fragment) => fragment.id),
    [visibleTrashedFragments],
  );
  const visibleTrashedFrames = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return trashedFrames
      .filter(
        (frame) => !normalized || frame.name.toLowerCase().includes(normalized),
      )
      .sort((left, right) => compareFrames(left, right, sortMode, new Map()));
  }, [query, sortMode, trashedFrames]);
  const selectableFragmentIds =
    activeView === "trash"
      ? visibleTrashedFragmentIds
      : activeView === "home" || activeView === "frames"
        ? visibleFragmentIds
        : EMPTY_FRAGMENT_IDS;
  const selectionScopeKey = useMemo(
    () =>
      [
        activeView,
        selectedSmartFrameId ?? "no-smart-frame",
        selectedFrameId ?? "all-frames",
        frameNavigator.includeDescendants ? "with-subframes" : "direct",
        query.trim().toLowerCase(),
        sourceFilter,
        JSON.stringify(normalizeFragmentFilter(fragmentFilter)),
      ].join("\u0000"),
    [
      activeView,
      frameNavigator.includeDescendants,
      fragmentFilter,
      query,
      selectedFrameId,
      selectedSmartFrameId,
      sourceFilter,
    ],
  );
  const selectedFragmentIds = useMemo(
    () =>
      resolveSelectedIds(selection, selectionScopeKey, selectableFragmentIds),
    [selectableFragmentIds, selection, selectionScopeKey],
  );
  const selectedFragmentIdSet = useMemo(
    () => new Set(selectedFragmentIds),
    [selectedFragmentIds],
  );
  const inspectedFragment = useMemo(() => {
    if (selectedFragmentIds.length !== 1) {
      return null;
    }
    const id = selectedFragmentIds[0];
    return (
      (activeView === "trash"
        ? visibleTrashedFragments
        : galleryFragments
      ).find((fragment) => fragment.id === id) ?? null
    );
  }, [
    activeView,
    galleryFragments,
    selectedFragmentIds,
    visibleTrashedFragments,
  ]);
  const selectedFragments = useMemo(() => {
    const collection =
      activeView === "trash" ? visibleTrashedFragments : galleryFragments;
    const byId = new Map(collection.map((fragment) => [fragment.id, fragment]));
    return selectedFragmentIds
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
  }, [
    activeView,
    galleryFragments,
    selectedFragmentIds,
    visibleTrashedFragments,
  ]);
  const primarySelectedFragment = selectedFragments[0] ?? null;
  const selectedVisibleCount = selectedFragmentIds.length;
  const selectedAllMatching =
    selection.mode === "all-matching" &&
    selection.scopeKey === selectionScopeKey;
  const matchingSelectionTotal = selectedAllMatching
    ? selection.matchingIds.length
    : activeView === "trash"
      ? trashTotal
      : activeView === "home" || activeView === "frames"
        ? activeTotal
        : selectableFragmentIds.length;
  const canSelectAll = previewMode
    ? selectableFragmentIds.length > 0
    : activeView === "trash"
      ? trashTotal > 0
      : (activeView === "home" || activeView === "frames") && activeTotal > 0;
  const pointerDrag = usePointerDragSession({
    getPayload: pointerDragPayloadFor,
    onDrop: handlePointerDrop,
    onTargetChange: handlePointerDropTargetChange,
  });
  const marquee = useMarqueeSelection({
    matchingIds: selectableFragmentIds,
    selectedIds: selectedFragmentIds,
    onReplace: (ids, visualOrder) => {
      dispatchSelection({
        type: "replace-many",
        scopeKey: selectionScopeKey,
        matchingIds: visualOrder,
        ids,
      });
    },
  });

  useEffect(() => {
    dispatchSelection({
      type: "reconcile",
      scopeKey: selectionScopeKey,
      matchingIds: selectableFragmentIds,
    });
  }, [selectableFragmentIds, selectionScopeKey]);

  useEffect(() => {
    if (!inspectedFragment || isDemoFragment(inspectedFragment)) {
      setInspectorTags([]);
      return;
    }
    let cancelled = false;
    void getFragmentTags(inspectedFragment.id)
      .then((tags) => {
        if (!cancelled) setInspectorTags(tags);
      })
      .catch((caught) => {
        if (!cancelled) {
          setInspectorTags([]);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inspectedFragment]);

  useEffect(() => {
    if (!focusedFragmentId) return;

    if (previewMode || focusedFragmentIsDemo) {
      setFragmentTagsById((current) =>
        Object.prototype.hasOwnProperty.call(current, focusedFragmentId)
          ? current
          : { ...current, [focusedFragmentId]: [] },
      );
      setFragmentTagStatusById((current) => ({
        ...current,
        [focusedFragmentId]: "ready",
      }));
      return;
    }

    let cancelled = false;
    setFragmentTagStatusById((current) => ({
      ...current,
      [focusedFragmentId]: "loading",
    }));
    void getFragmentTags(focusedFragmentId)
      .then((tags) => {
        if (cancelled) return;
        setFragmentTagsById((current) => ({
          ...current,
          [focusedFragmentId]: normalizeTags(tags),
        }));
        setFragmentTagStatusById((current) => ({
          ...current,
          [focusedFragmentId]: "ready",
        }));
      })
      .catch((caught) => {
        if (cancelled) return;
        setFragmentTagStatusById((current) => ({
          ...current,
          [focusedFragmentId]: "error",
        }));
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [focusedFragmentId, focusedFragmentIsDemo, previewMode]);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (
        matchesShortcut(event, v7Settings.shortcuts.quickPreview) &&
        !event.repeat
      ) {
        if (
          !inspectedFragment ||
          selectedFragment ||
          frameModal ||
          isEditableTarget(event.target)
        ) {
          return;
        }
        event.preventDefault();
        setQuickPreviewFragment(inspectedFragment);
      } else if (event.key === "Enter" && quickPreviewFragment) {
        event.preventDefault();
        setQuickPreviewFragment(null);
        openFragmentPreview(quickPreviewFragment);
      } else if (
        matchesShortcut(event, v7Settings.shortcuts.closeOverlay) &&
        quickPreviewFragment
      ) {
        event.preventDefault();
        setQuickPreviewFragment(null);
      }
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === v7Settings.shortcuts.quickPreview.code) {
        setQuickPreviewFragment(null);
      }
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [
    frameModal,
    inspectedFragment,
    quickPreviewFragment,
    selectedFragment,
    v7Settings.shortcuts,
  ]);

  useEffect(() => {
    function handleSelectionKeyDown(event: KeyboardEvent) {
      if (
        (activeView !== "home" &&
          activeView !== "frames" &&
          activeView !== "trash") ||
        selectedFragment ||
        quickPreviewFragment ||
        fragmentContextMenu ||
        shortcutsOpen ||
        frameModal ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const intent = selectionKeyboardIntent(event.key, {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      if (!intent) {
        return;
      }
      if (intent === "clear" && selectedFragmentIds.length === 0) {
        return;
      }
      if (
        intent === "select-all" &&
        (previewMode
          ? selectableFragmentIds.length === 0
          : activeView === "trash"
            ? trashTotal === 0
            : activeTotal === 0)
      ) {
        return;
      }
      if (
        intent === "delete-selection" &&
        ((activeView !== "home" && activeView !== "frames") ||
          selectedFragmentIds.length === 0)
      ) {
        return;
      }

      event.preventDefault();
      if (intent === "select-all") {
        void selectAllMatchingFragments();
      } else if (intent === "clear") {
        dispatchSelection({ type: "clear", scopeKey: selectionScopeKey });
      } else if (intent === "delete-selection") {
        void moveFragmentsToTrash(selectedFragmentIds);
      }
    }

    window.addEventListener("keydown", handleSelectionKeyDown);
    return () => window.removeEventListener("keydown", handleSelectionKeyDown);
  }, [
    activeView,
    frameModal,
    fragmentContextMenu,
    quickPreviewFragment,
    selectableFragmentIds,
    selectedFragment,
    selectedFragmentIds,
    selectionScopeKey,
    shortcutsOpen,
    activeTotal,
    previewMode,
    trashTotal,
  ]);

  useEffect(() => {
    function handleCommandKeyDown(event: KeyboardEvent) {
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (matchesShortcut(event, v7Settings.shortcuts.search)) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(".v7-global-search input")
          ?.focus();
        return;
      }
      if (matchesShortcut(event, v7Settings.shortcuts.importFrames)) {
        event.preventDefault();
        void chooseImages();
        return;
      }
      if (matchesShortcut(event, v7Settings.shortcuts.closeOverlay)) {
        if (fragmentContextMenu) {
          event.preventDefault();
          setFragmentContextMenu(null);
          return;
        }
        if (shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen(false);
          return;
        }
        if (frameModal) {
          event.preventDefault();
          setFrameModal(null);
          return;
        }
        if (selectedFragment || quickPreviewFragment) {
          event.preventDefault();
          setSelectedFragment(null);
          setQuickPreviewFragment(null);
          return;
        }
      }
      if (isEditableTarget(event.target) || selectedFragment || frameModal)
        return;

      if ((event.key === "?" && !command) || (command && key === "/")) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (command && event.shiftKey && key === "f") {
        event.preventDefault();
        changeView("frames");
        window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-v7-filter="fragment"]')
            ?.click();
        }, 0);
      } else if (command && !event.shiftKey && key === "n") {
        event.preventDefault();
        openCreateFrame(selectedFrameId);
      } else if (command && ["1", "2", "3"].includes(key)) {
        event.preventDefault();
        const layout = ({ "1": "masonry", "2": "grid", "3": "list" } as const)[
          key as "1" | "2" | "3"
        ];
        setBrowsingMode((current) => ({ ...current, layout }));
      } else if (command && key === "c" && inspectedFragment) {
        if (isTauriRuntime() && !isDemoFragment(inspectedFragment)) {
          event.preventDefault();
          void copyFragmentImage(inspectedFragment.id).then(() =>
            setStatus("Image copied"),
          );
        }
      } else if (event.key === "Enter" && inspectedFragment) {
        event.preventDefault();
        openFragmentPreview(inspectedFragment);
      } else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        selectedFragmentIds.length === 1
      ) {
        const currentIndex = selectableFragmentIds.indexOf(
          selectedFragmentIds[0]!,
        );
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const nextId = selectableFragmentIds[currentIndex + offset];
        if (!nextId) return;
        event.preventDefault();
        dispatchSelection({
          type: "replace-many",
          scopeKey: selectionScopeKey,
          matchingIds: selectableFragmentIds,
          ids: [nextId],
        });
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>(
              `.fragment-card[data-fragment-id="${CSS.escape(nextId)}"]`,
            )
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
      }
    }
    window.addEventListener("keydown", handleCommandKeyDown);
    return () => window.removeEventListener("keydown", handleCommandKeyDown);
  }, [
    frameModal,
    fragmentContextMenu,
    inspectedFragment,
    quickPreviewFragment,
    selectableFragmentIds,
    selectedFragment,
    selectedFragmentIds,
    selectedFrameId,
    selectionScopeKey,
    shortcutsOpen,
    v7Settings.shortcuts,
  ]);

  const selectFrame = useCallback(
    (frameId: string | null) => {
      setSelectedFragment(null);
      selectedFrameIdRef.current = frameId;
      setSelectedFrameId(frameId);
      selectedSmartFrameIdRef.current = null;
      setSelectedSmartFrameId(null);
      if (selectedSmartFrameId) {
        fragmentFilterRef.current = EMPTY_FRAGMENT_FILTER;
        queryRef.current = "";
        sourceFilterRef.current = "all";
        setFragmentFilter(EMPTY_FRAGMENT_FILTER);
        setQuery("");
        setSourceFilter("all");
      }
      dispatchSelection({ type: "clear", scopeKey: "" });
      setActiveView("home");
      if (frameId) {
        const ancestorIds = frameBreadcrumbs(activeFrameUniverse, frameId)
          .slice(0, -1)
          .map((frame) => frame.id);
        if (ancestorIds.length > 0) {
          setFrameNavigator((current) => ({
            ...current,
            expandedIds: [...new Set([...current.expandedIds, ...ancestorIds])],
          }));
        }
      }
      if (isTauriRuntime()) {
        void loadActivePage(frameId, true);
      }
    },
    [activeFrameUniverse, loadActivePage, selectedSmartFrameId],
  );

  function selectSmartFrameValue(smartFrame: SmartFrame) {
    const filter = normalizeFragmentFilter(smartFrame.filter);
    const nextQuery = filter.query ?? "";
    const nextSource = filter.sourceKind ?? "all";
    fragmentFilterRef.current = filter;
    queryRef.current = nextQuery;
    sourceFilterRef.current = nextSource;
    selectedFrameIdRef.current = null;
    selectedSmartFrameIdRef.current = smartFrame.id;
    setFragmentFilter(filter);
    setQuery(nextQuery);
    setSourceFilter(nextSource);
    setSelectedFrameId(null);
    setSelectedSmartFrameId(smartFrame.id);
    setSelectedFragment(null);
    dispatchSelection({ type: "clear", scopeKey: "" });
    setActiveView("home");
    if (isTauriRuntime()) void loadActivePage(null, true);
  }

  function applyFragmentFilter(filter: FragmentFilter) {
    setColorResultsChanged(false);
    const normalized = normalizeFragmentFilter(filter);
    fragmentFilterRef.current = normalized;
    setFragmentFilter(normalized);
    setSelectedSmartFrameId(null);
    dispatchSelection({ type: "clear", scopeKey: "" });
  }

  async function saveSmartFrame(name: string, filter: FragmentFilter) {
    const savedFilter = filterWithLibraryControls(filter, query, sourceFilter);
    try {
      const smartFrame = await createSmartFrame(name, savedFilter);
      setSmartFrames((current) => [...current, smartFrame]);
      setStatus(`Smart Fragment “${smartFrame.name}” saved`);
      selectSmartFrameValue(smartFrame);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Smart Fragment could not be saved");
      throw caught;
    }
  }

  async function saveSelectedSmartFrame(
    id: string,
    name: string,
    filter: FragmentFilter,
  ) {
    const savedFilter = filterWithLibraryControls(filter, query, sourceFilter);
    try {
      const updated = await updateSmartFrame(id, name, savedFilter);
      setSmartFrames((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setStatus(`Smart Fragment “${updated.name}” updated`);
      selectSmartFrameValue(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Smart Fragment could not be updated");
      throw caught;
    }
  }

  async function removeSmartFrame(smartFrame: SmartFrame) {
    if (
      !window.confirm(
        `Delete Smart Fragment “${smartFrame.name}”?\n\nNo Frames will be deleted.`,
      )
    ) {
      return;
    }
    try {
      await deleteSmartFrame(smartFrame.id);
      setSmartFrames((current) =>
        current.filter((item) => item.id !== smartFrame.id),
      );
      if (selectedSmartFrameId === smartFrame.id) selectFrame(null);
      setStatus(`Smart Fragment “${smartFrame.name}” deleted`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Smart Fragment could not be deleted");
    }
  }

  function setIncludeDescendants(value: boolean) {
    includeDescendantsRef.current = value;
    setFrameNavigator((current) => ({
      ...current,
      includeDescendants: value,
    }));
    dispatchSelection({ type: "clear", scopeKey: "" });
    if (activeView === "home" && selectedFrameId && isTauriRuntime()) {
      void loadActivePage(selectedFrameId, true, value);
    }
  }

  function assetPathCandidates(fragment: Fragment, mode: "detail" | "gallery") {
    const paths =
      mode === "detail"
        ? [fragment.previewPath, fragment.thumbnailPath, fragment.originalPath]
        : [fragment.thumbnailPath, fragment.previewPath, fragment.originalPath];
    return uniqueValues(
      fragment.mimeType === "image/svg+xml"
        ? paths.filter((path) => path !== fragment.originalPath)
        : paths,
    );
  }

  const resolveAssetFallback = useCallback(
    async (relativePath: string) => {
      if (
        relativePath.toLowerCase().endsWith(".svg") ||
        relativePath.includes("svg-cache/")
      )
        return null;
      if (assetDataUrls[relativePath]) {
        return assetDataUrls[relativePath];
      }
      if (assetFallbackRequests.current[relativePath]) {
        return assetFallbackRequests.current[relativePath];
      }

      const svg = [
        ...fragmentsRef.current,
        ...trashedFragmentsRef.current,
        ...framePreviewFragments,
      ].find(
        (fragment) =>
          fragment.mimeType === "image/svg+xml" &&
          (fragment.thumbnailPath === relativePath ||
            fragment.previewPath === relativePath),
      );
      const fallback = async () => {
        if (!svg) return loadAssetDataUrl(relativePath);
        const key = svg.assetId ?? svg.id;
        let repair = svgRepairs.current.get(key);
        if (!repair) {
          repair = ensureSvgPreview(
            svg.id,
            1600,
            crypto.randomUUID(),
            true,
          ).then(() => undefined);
          if (svgRepairs.current.size >= 32) {
            const oldest = svgRepairs.current.keys().next().value;
            if (oldest) svgRepairs.current.delete(oldest);
          }
          svgRepairs.current.set(key, repair);
        }
        await repair;
        return `${assetUrl(assetRoot, relativePath)}?repair=1`;
      };
      const request = fallback()
        .then((dataUrl) => {
          setAssetDataUrls((current) => {
            if (current[relativePath]) return current;
            // Base-image emergency fallback only; retain at most 32 entries / 24 MiB.
            const entries = Object.entries(current);
            let bytes =
              dataUrl.length +
              entries.reduce((sum, [, value]) => sum + value.length, 0);
            while (
              entries.length &&
              (entries.length >= 32 || bytes > 24 * 1024 * 1024)
            ) {
              const removed = entries.shift();
              if (removed) bytes -= removed[1].length;
            }
            return dataUrl.length > 24 * 1024 * 1024
              ? Object.fromEntries(entries)
              : { ...Object.fromEntries(entries), [relativePath]: dataUrl };
          });
          delete assetFallbackRequests.current[relativePath];
          return dataUrl;
        })
        .catch(() => {
          delete assetFallbackRequests.current[relativePath];
          return null;
        });
      assetFallbackRequests.current[relativePath] = request;
      return request;
    },
    [assetDataUrls, assetRoot, framePreviewFragments],
  );

  function assetSourcesFor(
    fragment: Fragment,
    mode: "detail" | "gallery",
  ): AssetSource[] {
    return assetPathCandidates(fragment, mode)
      .map((relativePath) => {
        if (relativePath.startsWith("/demo")) {
          return { url: relativePath };
        }
        if (assetDataUrls[relativePath]) {
          return { url: assetDataUrls[relativePath] };
        }
        return {
          relativePath,
          url: assetRoot ? assetUrl(assetRoot, relativePath) : "",
        };
      })
      .filter((source) => Boolean(source.url));
  }

  function isProtectedFrame(frame: Frame) {
    return (
      frame.id === defaultFrameId ||
      (frame.name === "Inbox" && frame.parentId === null)
    );
  }

  function fileNameFromPath(path: string) {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? "Image";
  }

  function emptyStateTitle() {
    if (query.trim()) {
      return "No matching Frames";
    }
    if (selectedDisplayFrame) {
      return `No Frames in ${selectedDisplayFrame.name} yet`;
    }
    return "No Frames in your Vault yet";
  }

  function emptyStateAction() {
    if (query.trim()) {
      setQuery("");
      return;
    }
    void chooseImages();
  }

  function toggleFragmentSelection(fragmentId: string) {
    dispatchSelection({
      type: "toggle",
      scopeKey: selectionScopeKey,
      matchingIds: selectableFragmentIds,
      id: fragmentId,
    });
  }

  async function selectAllMatchingFragments() {
    if (previewMode) {
      dispatchSelection({
        type: "select-all",
        scopeKey: selectionScopeKey,
        matchingIds: selectableFragmentIds,
      });
      return;
    }

    setStatus("Selecting matching Frames");
    try {
      const matchingIds = await listFragmentIds({
        expectedPaletteRevision: fragmentFilter.color
          ? activeView === "trash"
            ? trashPaletteRevision.current
            : activePaletteRevision.current
          : null,
        frameId: activeView === "home" ? selectedFrameId : null,
        includeDescendants:
          activeView === "home" && Boolean(selectedFrameId)
            ? frameNavigator.includeDescendants
            : false,
        trashed: activeView === "trash",
        query,
        sourceFilter,
        filter: filterWithLibraryControls(fragmentFilter, query, sourceFilter),
        sortMode,
      });
      dispatchSelection({
        type: "select-all",
        scopeKey: selectionScopeKey,
        matchingIds,
      });
      setStatus(
        matchingIds.length === 1
          ? "Selected 1 Frame"
          : `Selected ${matchingIds.length} Frames`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Selection failed");
    }
  }

  function deselectAllFragments() {
    dispatchSelection({ type: "clear", scopeKey: selectionScopeKey });
  }

  function deleteRetentionDays(): number | null {
    return deletePolicy === "forever" ? null : Number(deletePolicy);
  }

  function deletePolicyLabel() {
    return deletePolicy === "forever"
      ? "delete forever"
      : `move to Trash for ${deletePolicy} days`;
  }

  function handleFragmentCardSelect(
    fragment: Fragment,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    if (!event.shiftKey) return;
    event.preventDefault();
    toggleFragmentSelection(fragment.id);
  }

  function handleFragmentContextMenu(
    fragment: Fragment,
    event: MouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    const ids = selectedFragmentIdSet.has(fragment.id)
      ? selectedFragmentIds
      : [fragment.id];
    setFragmentContextMenu({
      fragment,
      fragmentIds: ids,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openFragmentPreview(fragment: Fragment) {
    setSelectedFragment(fragment);
  }

  function addImportedFragment(requestId: string, fragment: Fragment) {
    if (completedImportRequests.current.has(requestId)) {
      return;
    }
    completedImportRequests.current.add(requestId);

    setFramePreviewFragments((current) =>
      mergeUniqueFragments(current, [fragment], "prepend"),
    );
    setFrameFragmentCounts((current) => ({
      ...current,
      [fragment.frameId]: (current[fragment.frameId] ?? 0) + 1,
    }));

    const activeFrameId = selectedFrameIdRef.current;
    if (
      !fragmentFilterRef.current.color &&
      (activeFrameId === null || activeFrameId === fragment.frameId)
    ) {
      const nextFragments = mergeUniqueFragments(
        fragmentsRef.current,
        [fragment],
        "prepend",
      );
      fragmentsRef.current = nextFragments;
      setFragments(nextFragments);
      activeNextOffsetRef.current += 1;
      const nextTotal = activeTotalRef.current + 1;
      activeTotalRef.current = nextTotal;
      setActiveTotal(nextTotal);
      const hasMore = nextFragments.length < nextTotal;
      activeHasMoreRef.current = hasMore;
      setActiveHasMore(hasMore);
    }
  }

  async function runImportBatch(items: ImportQueueItem[], enqueue: boolean) {
    if (items.length === 0) {
      return;
    }
    const jobId = items[0]!.jobId;
    if (enqueue) {
      dispatchImportQueue({ type: "enqueue", items });
    }
    setError(null);
    setStatus(
      items.length === 1
        ? "Importing 1 image"
        : `Importing ${items.length} images`,
    );

    try {
      const results = await importImageBatch(
        jobId,
        items.map((item) => ({
          requestId: item.id,
          frameId: item.frameId,
          filePath: item.path,
        })),
        (event: ImportBatchEvent) => {
          if (event.event === "failed") {
            dispatchImportQueue({
              type: "event",
              event: {
                event: "failed",
                requestId: event.requestId,
                error: event.error,
                errorCode: event.errorCode ?? undefined,
                existingFragmentId: event.existingFragmentId ?? undefined,
                existingTrashed: event.existingTrashed ?? undefined,
              },
            });
          } else if (event.event === "skipped") {
            dispatchImportQueue({
              type: "event",
              event: { event: "skipped", requestId: event.requestId },
            });
          } else {
            dispatchImportQueue({ type: "event", event });
          }
          if (event.event === "complete") {
            addImportedFragment(event.requestId, event.fragment);
          }
        },
      );

      for (const result of results) {
        if (result.ok && result.fragment) {
          addImportedFragment(result.requestId, result.fragment);
          dispatchImportQueue({
            type: "event",
            event: { event: "complete", requestId: result.requestId },
          });
        } else if (result.outcome === "skipped") {
          dispatchImportQueue({
            type: "event",
            event: { event: "skipped", requestId: result.requestId },
          });
        } else if (result.error) {
          dispatchImportQueue({
            type: "event",
            event: {
              event: "failed",
              requestId: result.requestId,
              error: result.error,
              errorCode: result.errorCode ?? undefined,
              existingFragmentId: result.existingFragmentId ?? undefined,
              existingTrashed: result.existingTrashed ?? undefined,
            },
          });
        }
      }

      const summary = summarizeImportResults(results);
      const summaryParts = [
        summary.imported > 0 ? `${summary.imported} imported` : null,
        summary.linkedFragmentIds.length > 0
          ? `${summary.linkedFragmentIds.length} already in your Vault — linked into ${items[0]?.frameName ?? "Inbox"}`
          : null,
        summary.skipped > 0 ? `${summary.skipped} skipped` : null,
        summary.failed > 0 ? `${summary.failed} failed` : null,
      ].filter((part): part is string => Boolean(part));
      const summaryLabel = summaryParts.join(" · ") || "Import complete";
      offerImportSummary(summary.linkedFragmentIds, summaryLabel);
      setStatus(summaryLabel);
      try {
        rememberRevision(await getLibraryRevision());
      } catch {
        // A later focus revision check will reconcile the library.
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      dispatchImportQueue({
        type: "fail",
        ids: items.map((item) => item.id),
        error: message,
      });
      setError(message);
      setStatus("Import failed");
    }
  }

  function retryImport(item: ImportQueueItem) {
    const jobId = operationId("import-job");
    const retryItem = { ...item, jobId, status: "queued" as const };
    dispatchImportQueue({ type: "retry", id: item.id, jobId });
    void runImportBatch([retryItem], false);
  }

  async function cancelImport(item: ImportQueueItem) {
    await cancelImportJob(item.jobId);
    setStatus(`Cancelling ${item.name}`);
  }

  function skipImport(item: ImportQueueItem) {
    dispatchImportQueue({ type: "skip", id: item.id });
    setStatus(`Skipped ${item.name}`);
  }

  async function importPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    const currentFrameId = selectedFrameIdRef.current;
    const recentFrameId = recentFrameIdRef.current;
    const frameId =
      v7Settings.defaultFragment === "inbox"
        ? defaultFrameId
        : v7Settings.defaultFragment === "recent"
          ? recentFrameId && frameById.has(recentFrameId)
            ? recentFrameId
            : defaultFrameId
          : (currentFrameId ?? defaultFrameId);
    const frameName =
      (frameId ? frameById.get(frameId)?.name : null) ??
      selectedDisplayFrame?.name ??
      "Inbox";
    const jobId = operationId("import-job");
    const batch: ImportQueueItem[] = paths.map((path) => ({
      id: operationId("import"),
      jobId,
      name: fileNameFromPath(path),
      path,
      frameId,
      frameName,
      status: "queued",
    }));
    await runImportBatch(batch, true);
  }

  importPathsRef.current = importPaths;

  async function chooseImages() {
    if (!isTauriRuntime()) {
      setError("Open Fragment through Tauri to import images.");
      return;
    }

    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "bmp",
            "tiff",
            "svg",
          ],
        },
      ],
    });
    if (!selected) {
      return;
    }
    void importPaths(Array.isArray(selected) ? selected : [selected]);
  }

  function changeView(view: V7View) {
    setSelectedFragment(null);
    setFrameModal(null);
    dispatchSelection({ type: "clear", scopeKey: "" });
    if (
      view === "home" ||
      view === "frames" ||
      view === "trash" ||
      view === "settings"
    ) {
      selectedFrameIdRef.current = null;
      setSelectedFrameId(null);
    }
    if (view === "home" || view === "frames") {
      selectedSmartFrameIdRef.current = null;
      setSelectedSmartFrameId(null);
      if (selectedSmartFrameId) {
        fragmentFilterRef.current = EMPTY_FRAGMENT_FILTER;
        queryRef.current = "";
        sourceFilterRef.current = "all";
        setFragmentFilter(EMPTY_FRAGMENT_FILTER);
        setQuery("");
        setSourceFilter("all");
      }
      if (isTauriRuntime()) void loadActivePage(null, true);
    }
    setActiveView(view);
  }

  function openCreateFrame(parentId: string | null) {
    setFrameModal({ mode: "create", parentId });
  }

  function toggleFrameExpanded(frameId: string) {
    setFrameNavigator((current) => {
      const expanded = new Set(current.expandedIds);
      if (expanded.has(frameId)) expanded.delete(frameId);
      else expanded.add(frameId);
      return { ...current, expandedIds: [...expanded] };
    });
  }

  function toggleFramePinned(frameId: string) {
    setFrameNavigator((current) => {
      const pinned = new Set(current.pinnedIds);
      if (pinned.has(frameId)) pinned.delete(frameId);
      else pinned.add(frameId);
      return { ...current, pinnedIds: [...pinned] };
    });
  }

  async function renameFrameFromNavigator(frame: Frame, name: string) {
    if (isProtectedFrame(frame)) {
      setError("Inbox is a protected Fragment.");
      return;
    }
    try {
      await renameFrame(frame.id, name);
      setStatus(`Renamed Fragment to ${name}`);
      await refreshSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Fragment rename failed");
    }
  }

  async function submitFrame(name: string) {
    if (frameModal?.mode === "rename") {
      if (isProtectedFrame(frameModal.frame)) {
        setError("Inbox is a protected Fragment.");
        setFrameModal(null);
        return;
      }
      await renameFrame(frameModal.frame.id, name);
    } else {
      const parentId = frameModal?.parentId ?? null;
      const created = await createFrame(name, parentId);
      if (parentId) {
        setFrameNavigator((current) => ({
          ...current,
          expandedIds: [...new Set([...current.expandedIds, parentId])],
        }));
      }
      selectedFrameIdRef.current = created.id;
      setSelectedFrameId(created.id);
      setSelectedFragment(null);
      setActiveView("home");
    }
    setFrameModal(null);
    await refreshSnapshot();
  }

  async function removeFrame(frame: Frame) {
    if (isProtectedFrame(frame)) {
      setError("Inbox is a protected Fragment.");
      return;
    }
    const count = recursiveDisplayCounts.get(frame.id) ?? 0;
    const confirmed = window.confirm(
      `${deletePolicy === "forever" ? "Delete" : "Move"} "${frame.name}"${count > 0 ? ` with its ${count} ${count === 1 ? "Frame" : "Frames"}` : ""} ${deletePolicy === "forever" ? "forever" : `to Trash for ${deletePolicy} days`}?`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFrame(frame.id, deleteRetentionDays());
    if (
      selectedFrameId &&
      descendantFrameIds(frames, frame.id).includes(selectedFrameId)
    ) {
      selectedFrameIdRef.current = null;
      setSelectedFrameId(null);
    }
    await refreshSnapshot();
  }

  async function saveSelectedFragment(
    title: string | null,
    note: string | null,
  ) {
    if (!selectedFragment) {
      return;
    }
    const updated = await updateFragment(selectedFragment.id, title, note);
    setSelectedFragment(updated);
    await refreshSnapshot();
  }

  async function saveInspectedFragment(
    fragment: Fragment,
    title: string | null,
    note: string | null,
  ) {
    if (isDemoFragment(fragment)) {
      return;
    }
    const updated = await updateFragment(fragment.id, title, note);
    setFragments((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setTrashedFragments((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setFramePreviewFragments((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedFragment((current) =>
      current?.id === updated.id ? updated : current,
    );
    setStatus("Frame metadata saved");
  }

  async function saveFocusedFragmentTitle(fragment: Fragment, title: string) {
    const normalizedTitle = normalizeFragmentTitle(title);
    if (!normalizedTitle) {
      throw new Error("Enter a title before saving.");
    }

    if (previewMode || isDemoFragment(fragment)) {
      setPreviewTitleOverrides((current) => ({
        ...current,
        [fragment.id]: normalizedTitle,
      }));
      setSelectedFragment((current) =>
        current?.id === fragment.id
          ? { ...current, title: normalizedTitle }
          : current,
      );
      setQuickPreviewFragment((current) =>
        current?.id === fragment.id
          ? { ...current, title: normalizedTitle }
          : current,
      );
      setStatus("Frame title saved");
      return;
    }

    await saveInspectedFragment(
      fragment,
      normalizedTitle,
      fragment.note ?? null,
    );
  }

  async function saveFocusedFragmentTags(fragment: Fragment, tags: string[]) {
    const normalizedTags = normalizeTags(tags);

    if (previewMode || isDemoFragment(fragment)) {
      setFragmentTagsById((current) => ({
        ...current,
        [fragment.id]: normalizedTags,
      }));
      setFragmentTagStatusById((current) => ({
        ...current,
        [fragment.id]: "ready",
      }));
      setStatus("Frame tags saved");
      return;
    }

    try {
      const updatedTags = normalizeTags(
        await setFragmentTags(fragment.id, normalizedTags),
      );
      setFragmentTagsById((current) => ({
        ...current,
        [fragment.id]: updatedTags,
      }));
      setFragmentTagStatusById((current) => ({
        ...current,
        [fragment.id]: "ready",
      }));
      if (inspectedFragment?.id === fragment.id) {
        setInspectorTags(updatedTags);
      }
      const refreshedKnownTags = await listTags().catch(() => null);
      setKnownTags(
        refreshedKnownTags
          ? normalizeTags(refreshedKnownTags).sort((left, right) =>
              left.localeCompare(right),
            )
          : (current) =>
              normalizeTags([...current, ...updatedTags]).sort((left, right) =>
                left.localeCompare(right),
              ),
      );
      setStatus("Frame tags saved");
    } catch (caught) {
      setFragmentTagStatusById((current) => ({
        ...current,
        [fragment.id]: "ready",
      }));
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Frame tags could not be saved");
      throw caught;
    }
  }

  function loadedSharedReferenceCount(fragment: Fragment) {
    if (!fragment.assetId) {
      return 1;
    }
    return [...fragments, ...trashedFragments].filter(
      (item) => item.assetId === fragment.assetId,
    ).length;
  }

  async function resolveSharedReferenceCount(fragment: Fragment) {
    if (isTauriRuntime()) {
      try {
        return Math.max(1, await fragmentMembershipCount(fragment.id));
      } catch {
        // Fall back to the currently loaded page if the record changed.
      }
    }
    return loadedSharedReferenceCount(fragment);
  }

  async function removeSelectedFragment() {
    if (!selectedFragment) {
      return;
    }
    const sharedCount = await resolveSharedReferenceCount(selectedFragment);
    const confirmed = window.confirm(
      sharedCount > 1
        ? `Remove "${selectedFragment.title ?? "Frame"}" from this Fragment? The shared image stays in ${sharedCount - 1} other ${sharedCount - 1 === 1 ? "place" : "places"}.`
        : `Delete "${selectedFragment.title ?? "Frame"}"? This will ${deletePolicyLabel()}.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFragment(selectedFragment.id, deleteRetentionDays());
    setSelectedFragment(null);
    await refreshSnapshot();
  }

  async function removeSelectedFragmentEverywhere() {
    if (!selectedFragment) {
      return;
    }
    const sharedCount = await resolveSharedReferenceCount(selectedFragment);
    const confirmed = window.confirm(
      `Delete "${selectedFragment.title ?? "Frame"}" everywhere? This removes ${sharedCount} ${sharedCount === 1 ? "reference" : "references"} and the shared image file.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFragmentEverywhere(selectedFragment.id, deleteRetentionDays());
    setSelectedFragment(null);
    deselectAllFragments();
    setStatus("Deleted everywhere");
    await refreshSnapshot();
  }

  async function restoreSelectedFragments() {
    const ids = selectedFragmentIds.filter((id) => !id.startsWith("demo-"));
    if (ids.length === 0) {
      return;
    }
    await restoreFragments(ids);
    deselectAllFragments();
    setStatus(
      ids.length === 1 ? "Restored Frame" : `Restored ${ids.length} Frames`,
    );
    await refreshSnapshot();
  }

  function pointerDragPayloadFor(target: Element): PointerDragPayload | null {
    const fragmentCard = target.closest<HTMLElement>(
      ".fragment-card[data-fragment-id]",
    );
    if (fragmentCard && (activeView === "home" || activeView === "frames")) {
      const fragmentId = fragmentCard.dataset.fragmentId;
      if (!fragmentId) {
        return null;
      }
      const ids =
        selectedFragmentIdSet.has(fragmentId) && selectedFragmentIds.length > 0
          ? selectedFragmentIds
          : [fragmentId];
      const available = new Map(
        [...cachedFragments, ...trashedFragments, ...demoFragments].map(
          (fragment) => [fragment.id, fragment],
        ),
      );
      const imageUrls = ids
        .map((id) => available.get(id))
        .filter((fragment): fragment is Fragment => Boolean(fragment))
        .map((fragment) => assetSourcesFor(fragment, "gallery")[0]?.url ?? "")
        .filter(Boolean)
        .slice(0, 3);
      return {
        kind: "fragments",
        ids,
        imageUrls,
        label: `${ids.length} ${ids.length === 1 ? "Frame" : "Frames"}`,
      };
    }

    const frameCard = target.closest<HTMLElement>("[data-frame-drag-id]");
    if (!frameCard || target.closest("[data-no-frame-drag], input")) {
      return null;
    }
    const frameId = frameCard.dataset.frameDragId;
    const frame = frames.find((item) => item.id === frameId);
    if (!frame || isProtectedFrame(frame)) {
      return null;
    }
    const imageUrls = cachedFragments
      .filter((fragment) => fragment.frameId === frame.id)
      .slice(0, 3)
      .map((fragment) => assetSourcesFor(fragment, "gallery")[0]?.url ?? "")
      .filter(Boolean);
    return {
      kind: "frame",
      id: frame.id,
      imageUrls,
      label: frame.name,
    };
  }

  function handleGalleryPointerDown(event: PointerEvent<HTMLElement>) {
    if (pointerDrag.handlePointerDown(event)) {
      return;
    }
    marquee.handlePointerDown(event);
  }

  function handlePointerDropTargetChange(target: string | null) {
    setTrashDropState((current) =>
      target === "trash" ? "armed" : current === "success" ? current : "idle",
    );
    setFrameDropTarget(target);
  }

  async function handlePointerDrop(
    payload: PointerDragPayload,
    target: string,
  ) {
    try {
      setError(null);
      if (target === "trash") {
        const changed =
          payload.kind === "frame"
            ? await moveFrameToTrash(payload.id)
            : await moveFragmentsToTrash(payload.ids);
        if (changed) {
          flashTrashSuccess();
        }
        return;
      }
      if (
        payload.kind === "fragments" &&
        (target.startsWith("frame-tree:") ||
          target.startsWith("frame-before:") ||
          target.startsWith("frame-after:") ||
          target.startsWith("frame-chip:"))
      ) {
        const separator = target.indexOf(":");
        await linkFragmentsToFrame(payload.ids, target.slice(separator + 1));
        return;
      }
      if (payload.kind === "frame") {
        const parsedTarget = parseFrameDropTarget(target);
        if (!parsedTarget) return;
        const placement = resolveFrameDrop(frames, payload.id, parsedTarget);
        if (!placement) {
          setError(
            "A Fragment cannot move inside itself or one of its nested Fragments.",
          );
          return;
        }
        await moveFrame(payload.id, placement.parentId, placement.position);
        if (placement.parentId) {
          setFrameNavigator((current) => ({
            ...current,
            expandedIds: [
              ...new Set([...current.expandedIds, placement.parentId!]),
            ],
          }));
        }
        const movedFrame = frames.find((frame) => frame.id === payload.id);
        setStatus(
          placement.parentId
            ? `Moved ${movedFrame?.name ?? "Fragment"} into ${frames.find((frame) => frame.id === placement.parentId)?.name ?? "Fragment"}`
            : `Moved ${movedFrame?.name ?? "Fragment"} to the Vault root`,
        );
        await refreshSnapshot();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Drop failed");
      setTrashDropState("idle");
      setFrameDropTarget(null);
    }
  }

  function parseFrameDropTarget(target: string): FrameDropTarget | null {
    if (target === "frame-root") return { kind: "root" };
    const [prefix, frameId] = target.split(":", 2);
    if (!frameId) return null;
    if (prefix === "frame-tree") return { kind: "inside", frameId };
    if (prefix === "frame-before") return { kind: "before", frameId };
    if (prefix === "frame-after") return { kind: "after", frameId };
    return null;
  }

  async function linkFragmentsToFrame(ids: string[], frameId: string) {
    const frame = frames.find((item) => item.id === frameId);
    if (!frame) {
      throw new Error("Destination Fragment was not found");
    }
    let linked = 0;
    let skipped = 0;
    let failed = 0;
    let lastError = "";
    for (const id of new Set(
      ids.filter((value) => !value.startsWith("demo-")),
    )) {
      try {
        await addExistingFragmentToFrame(id, frameId);
        linked += 1;
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : String(caught);
        if (message.includes("asset already belongs to Frame")) {
          skipped += 1;
        } else {
          failed += 1;
          lastError = message;
        }
      }
    }
    if (linked > 0) {
      await refreshSnapshot();
    }
    if (lastError) {
      setError(lastError);
    }
    const label = [
      `Added ${linked} to ${frame.name}`,
      skipped > 0 ? `${skipped} already there` : null,
      failed > 0 ? `${failed} failed` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    offerImportSummary([], label);
    setStatus(label);
  }

  function flashTrashSuccess() {
    setTrashDropState("success");
    window.setTimeout(() => setTrashDropState("idle"), 620);
  }

  function clearTrashUndoTimer() {
    if (trashUndoTimer.current !== null) {
      window.clearTimeout(trashUndoTimer.current);
      trashUndoTimer.current = null;
    }
  }

  function clearTrashUndo() {
    clearTrashUndoTimer();
    setTrashUndo(null);
  }

  function dismissTrashUndo() {
    if (trashUndoPendingRef.current) {
      return;
    }
    clearTrashUndo();
  }

  function setTrashUndoRequestPending(pending: boolean) {
    trashUndoPendingRef.current = pending;
    setTrashUndoPending(pending);
  }

  function offerTrashUndo(ids: string[]) {
    if (trashUndoPendingRef.current) {
      return;
    }
    clearTrashUndo();
    setTrashUndo({
      kind: "fragments",
      ids,
      label: `${ids.length} ${ids.length === 1 ? "Frame" : "Frames"} moved to Trash`,
    });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  function offerFrameTrashUndo(frame: Frame) {
    if (trashUndoPendingRef.current) {
      return;
    }
    clearTrashUndo();
    setTrashUndo({
      kind: "frame",
      frameId: frame.id,
      label: `${frame.name} moved to Trash`,
    });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  function offerImportSummary(ids: string[], label: string) {
    if (trashUndoPendingRef.current) {
      return;
    }
    clearTrashUndo();
    setTrashUndo({ kind: "import-summary", ids, label });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  async function undoLastTrashMove() {
    if (!trashUndo || trashUndoPendingRef.current) {
      return;
    }
    const undo = trashUndo;
    clearTrashUndoTimer();
    if (
      previewMode &&
      undo.kind === "fragments" &&
      undo.ids.every((id) => id.startsWith("demo-"))
    ) {
      setPreviewTrashState((current) => restorePreviewItems(current, undo.ids));
      clearTrashUndo();
      setStatus(
        undo.ids.length === 1
          ? "Restored Frame"
          : `Restored ${undo.ids.length} Frames`,
      );
      return;
    }

    const successLabel =
      undo.kind === "frame"
        ? "Restored Fragment"
        : undo.kind === "import-summary"
          ? undo.ids.length === 1
            ? "Removed linked Frame"
            : `Removed ${undo.ids.length} linked Frames`
          : undo.ids.length === 1
            ? "Restored Frame"
            : `Restored ${undo.ids.length} Frames`;

    setError(null);
    setTrashUndoRequestPending(true);
    try {
      const succeeded = await runRecoverableTrashAction(
        async () => {
          if (undo.kind === "frame") {
            await restoreFrame(undo.frameId);
          } else if (undo.kind === "import-summary") {
            if (undo.ids.length > 0) {
              await deleteFragments(undo.ids, 0);
            }
          } else {
            await restoreFragments(undo.ids);
          }
          await refreshSnapshot(true);
        },
        async (caught) => {
          await refreshSnapshot();
          setError(caught instanceof Error ? caught.message : String(caught));
          setStatus("Undo failed · Try again");
        },
      );
      if (succeeded) {
        setStatus(successLabel);
        clearTrashUndo();
      }
    } finally {
      setTrashUndoRequestPending(false);
    }
  }

  async function moveFragmentsToTrash(ids: string[]) {
    if (trashUndoPendingRef.current) {
      setStatus("Wait for Undo to finish");
      return false;
    }
    const uniqueIds = Array.from(new Set(ids));
    if (previewMode) {
      const activeIds = new Set(
        activeDemoFragments.map((fragment) => fragment.id),
      );
      const demoIds = uniqueIds.filter((id) => activeIds.has(id));
      if (demoIds.length === 0) {
        return false;
      }
      setPreviewTrashState((current) =>
        movePreviewItemsToTrash(current, demoIds),
      );
      deselectAllFragments();
      setSelectedFragment((current) =>
        current && demoIds.includes(current.id) ? null : current,
      );
      setQuickPreviewFragment((current) =>
        current && demoIds.includes(current.id) ? null : current,
      );
      offerTrashUndo(demoIds);
      setStatus(`Moved ${demoIds.length} to Trash`);
      return true;
    }

    const realIds = uniqueIds.filter((id) => !id.startsWith("demo-"));
    if (realIds.length === 0) {
      return false;
    }
    if (deletePolicy === "forever") {
      const confirmed = window.confirm(
        `Delete ${realIds.length} ${realIds.length === 1 ? "Frame" : "Frames"} forever?`,
      );
      if (!confirmed) {
        return false;
      }
    }
    await deleteFragments(realIds, deleteRetentionDays());
    deselectAllFragments();
    setSelectedFragment((current) =>
      current && realIds.includes(current.id) ? null : current,
    );
    if (deletePolicy !== "forever") {
      offerTrashUndo(realIds);
    }
    setStatus(
      deletePolicy === "forever"
        ? "Deleted Frame"
        : `Moved ${realIds.length} to Trash`,
    );
    await refreshSnapshot();
    return true;
  }

  async function moveFrameToTrash(frameId: string) {
    if (trashUndoPendingRef.current) {
      setStatus("Wait for Undo to finish");
      return false;
    }
    const frame = frames.find((item) => item.id === frameId);
    if (!frame) {
      return false;
    }
    if (isProtectedFrame(frame)) {
      setError("Inbox is a protected Fragment.");
      return false;
    }
    const count = recursiveDisplayCounts.get(frame.id) ?? 0;
    const confirmed = window.confirm(
      `${deletePolicy === "forever" ? "Delete" : "Move"} "${frame.name}"${count > 0 ? ` with its ${count} ${count === 1 ? "Frame" : "Frames"}` : ""} ${deletePolicy === "forever" ? "forever" : `to Trash for ${deletePolicy} days`}?`,
    );
    if (!confirmed) {
      return false;
    }
    await deleteFrame(frame.id, deleteRetentionDays());
    if (
      selectedFrameId &&
      descendantFrameIds(frames, frame.id).includes(selectedFrameId)
    ) {
      selectedFrameIdRef.current = null;
      setSelectedFrameId(null);
    }
    dispatchSelection({ type: "clear", scopeKey: "" });
    setSelectedFragment(null);
    if (deletePolicy !== "forever") {
      offerFrameTrashUndo(frame);
    }
    setStatus(
      deletePolicy === "forever"
        ? "Deleted Fragment"
        : "Moved Fragment to Trash",
    );
    await refreshSnapshot();
    return true;
  }

  async function restoreTrashedFrame(frame: Frame) {
    setError(null);
    await restoreFrame(frame.id);
    await refreshSnapshot(true);
    setStatus(`Restored ${frame.name}`);
  }

  async function reportTrashRestoreFailure(caught: unknown) {
    await refreshSnapshot();
    setError(caught instanceof Error ? caught.message : String(caught));
    setStatus("Restore failed · Try again");
  }

  const v7Layout = browsingMode.layout === "grid" ? "grid" : "masonry";
  const paperPreviewCounts = new Map(
    displayFrames.map((frame) => [
      frame.id,
      frame.parentId === null
        ? ([42, 86, 71, 63][frame.sortOrder] ??
          displayCounts.get(frame.id) ??
          0)
        : (displayCounts.get(frame.id) ?? 0),
    ]),
  );
  const v7DisplayCounts = previewMode
    ? paperPreviewCounts
    : recursiveDisplayCounts;
  const displayFrameTotal = previewMode ? 286 : galleryTotal;
  const displayFragmentTotal = previewMode ? 14 : displayFrames.length;
  const shellTitle =
    activeView === "frames"
      ? "Frames"
      : (selectedDisplayFrame?.name ??
        smartFrames.find((item) => item.id === selectedSmartFrameId)?.name ??
        "Your Vault");
  const shellSubtitle =
    selectedVisibleCount > 0
      ? `${selectedVisibleCount} ${selectedVisibleCount === 1 ? "Frame" : "Frames"} selected`
      : activeView === "frames"
        ? `${displayFrameTotal.toLocaleString()} Frames across ${displayFragmentTotal.toLocaleString()} Fragments`
        : selectedFrameId
          ? `${galleryTotal.toLocaleString()} ${galleryTotal === 1 ? "Frame" : "Frames"}`
          : `${displayFragmentTotal.toLocaleString()} Fragments · ${displayFrameTotal.toLocaleString()} Frames`;
  const v7TrashFragments = previewMode
    ? previewTrashedDemoFragments
    : visibleTrashedFragments;
  const v7TrashFrames =
    previewMode || fragmentFilter.color ? [] : visibleTrashedFrames;
  const defaultFocusedCollection =
    activeView === "trash" ? v7TrashFragments : galleryFragments;
  const selectedFocusedCollection = selectedFragmentIds
    .map((id) =>
      defaultFocusedCollection.find((fragment) => fragment.id === id),
    )
    .filter((fragment): fragment is Fragment => Boolean(fragment));
  const focusedCollection =
    focusedFragment &&
    selectedFragmentIdSet.has(focusedFragment.id) &&
    selectedFocusedCollection.length > 1
      ? selectedFocusedCollection
      : defaultFocusedCollection;
  const focusedIndex = focusedFragment
    ? Math.max(
        0,
        focusedCollection.findIndex(
          (fragment) => fragment.id === focusedFragment.id,
        ),
      )
    : 0;

  async function tagSelectedFrames(tag: string) {
    const ids = Array.from(new Set(selectedFragmentIds));
    if (ids.length === 0) {
      throw new Error("Select at least one Frame to add a tag");
    }

    if (previewMode) {
      setFragmentTagsById((current) => {
        const next = { ...current };
        ids.forEach((id) => {
          next[id] = addTag(next[id] ?? [], tag);
        });
        return next;
      });
      setFragmentTagStatusById((current) => {
        const next = { ...current };
        ids.forEach((id) => {
          next[id] = "ready";
        });
        return next;
      });
      setKnownTags((current) =>
        normalizeTags([...current, tag]).sort((left, right) =>
          left.localeCompare(right),
        ),
      );
      setStatus(
        `Tagged ${ids.length} ${ids.length === 1 ? "Frame" : "Frames"}`,
      );
      return;
    }

    const realIds = ids.filter((id) => !id.startsWith("demo-"));
    const updatedTagsById: Record<string, string[]> = {};
    let tagged = 0;
    let failed = 0;
    let lastError = "";
    for (const id of realIds) {
      try {
        const currentTags = await getFragmentTags(id);
        updatedTagsById[id] = normalizeTags(
          await setFragmentTags(id, addTag(currentTags, tag)),
        );
        tagged += 1;
      } catch (caught) {
        failed += 1;
        lastError = caught instanceof Error ? caught.message : String(caught);
      }
    }

    if (tagged > 0) {
      setFragmentTagsById((current) => ({
        ...current,
        ...updatedTagsById,
      }));
      const refreshedKnownTags = await listTags().catch(() => null);
      setKnownTags(
        refreshedKnownTags
          ? normalizeTags(refreshedKnownTags).sort((left, right) =>
              left.localeCompare(right),
            )
          : (current) =>
              normalizeTags([...current, tag]).sort((left, right) =>
                left.localeCompare(right),
              ),
      );
    }
    const label = [
      `Tagged ${tagged} ${tagged === 1 ? "Frame" : "Frames"}`,
      failed > 0 ? `${failed} failed` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    setStatus(label);
    if (lastError) {
      setError(lastError);
    }
    if (tagged === 0 && failed > 0) {
      throw new Error(lastError || "Tagging failed");
    }
  }

  async function emptyTrashPermanently() {
    if (trashUndoPendingRef.current) {
      setStatus("Wait for Undo to finish");
      return;
    }
    if (previewMode) {
      dismissTrashUndo();
      setPreviewTrashState(purgePreviewTrash);
      setSelectedFragment(null);
      setQuickPreviewFragment(null);
      setStatus("Trash emptied");
      return;
    }
    try {
      await emptyNativeTrash();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }

    trashPageRequestRef.current += 1;
    trashPageLoadingRef.current = false;
    trashedFragmentsRef.current = [];
    trashNextOffsetRef.current = 0;
    trashHasMoreRef.current = false;
    trashLoadedRef.current = true;
    trashLoadAttemptedRef.current = true;
    setTrashedFragments([]);
    setTrashedFrames([]);
    setTrashTotal(0);
    setTrashHasMore(false);
    setTrashLoaded(true);
    setTrashLoading(false);
    dismissTrashUndo();
    setSelectedFragment(null);
    setQuickPreviewFragment(null);
    setError(null);
    setStatus("Trash emptied");

    void refreshSnapshot(true).catch(() => {
      setError("Trash emptied but refresh failed");
      setStatus("Trash emptied but refresh failed");
    });
  }

  function showFocusedSibling(direction: -1 | 1) {
    const next = focusedCollection[focusedIndex + direction];
    if (!next) return;
    if (selectedFragment) setSelectedFragment(next);
    if (quickPreviewFragment) setQuickPreviewFragment(next);
  }

  async function moveSelectedFramesToFragment(
    ids: string[],
    targetFrameId: string,
  ) {
    const targetFrame = displayFrames.find(
      (frame) => frame.id === targetFrameId,
    );
    if (!targetFrame) {
      throw new Error("Destination Fragment was not found");
    }

    const uniqueIds = Array.from(new Set(ids));
    if (previewMode) {
      const activeIds = new Set(
        activeDemoFragments.map((fragment) => fragment.id),
      );
      const demoIds = uniqueIds.filter((id) => activeIds.has(id));
      if (demoIds.length === 0) {
        throw new Error("No selected Frames are available to move");
      }
      setPreviewFrameAssignments((current) => {
        const next = { ...current };
        demoIds.forEach((id) => {
          next[id] = targetFrameId;
        });
        return next;
      });
      deselectAllFragments();
      setFragmentContextMenu(null);
      setStatus(
        `Moved ${demoIds.length} ${demoIds.length === 1 ? "Frame" : "Frames"} to ${targetFrame.name}`,
      );
      return;
    }

    const realIds = uniqueIds.filter((id) => !id.startsWith("demo-"));
    if (realIds.length === 0) {
      throw new Error("No saved Frames are available to move");
    }

    const loadedById = new Map(
      [...fragments, ...framePreviewFragments].map((fragment) => [
        fragment.id,
        fragment,
      ]),
    );
    let moved = 0;
    let skipped = 0;
    let failed = 0;
    let lastError = "";
    for (const id of realIds) {
      if (loadedById.get(id)?.frameId === targetFrameId) {
        skipped += 1;
        continue;
      }
      try {
        await moveFragmentToFrame(id, targetFrameId);
        moved += 1;
      } catch (caught) {
        failed += 1;
        lastError = caught instanceof Error ? caught.message : String(caught);
      }
    }

    if (moved > 0) {
      await refreshSnapshot(true);
      deselectAllFragments();
    }
    setFragmentContextMenu(null);
    const label = [
      `Moved ${moved} to ${targetFrame.name}`,
      skipped > 0 ? `${skipped} already there` : null,
      failed > 0 ? `${failed} failed` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
    setStatus(label);
    if (lastError) {
      setError(lastError);
    }
    if (moved === 0 && failed > 0) {
      throw new Error(lastError || "Move failed");
    }
  }

  async function moveFrameToFragment(
    fragment: Fragment,
    targetFrameId: string,
  ) {
    const targetFrame = displayFrames.find(
      (frame) => frame.id === targetFrameId,
    );
    if (!targetFrame) {
      throw new Error("Destination Fragment was not found");
    }
    if (fragment.frameId === targetFrameId) {
      setStatus(`Frame is already in ${targetFrame.name}`);
      return;
    }

    try {
      setError(null);
      if (isDemoFragment(fragment)) {
        setPreviewFrameAssignments((current) => ({
          ...current,
          [fragment.id]: targetFrameId,
        }));
      } else {
        await moveFragmentToFrame(fragment.id, targetFrameId);
        await refreshSnapshot(true);
      }
      setSelectedFragment(null);
      setQuickPreviewFragment(null);
      setFragmentContextMenu(null);
      selectFrame(targetFrameId);
      setStatus(
        `Moved ${fragment.title?.trim() || "Frame"} to ${targetFrame.name}`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setStatus("Move failed");
      throw caught;
    }
  }

  async function openFocusedSource(fragment: Fragment) {
    const url = fragment.sourceUrl ?? fragment.pageUrl;
    if (!url) return;
    if (isTauriRuntime() && !isDemoFragment(fragment)) {
      await openFragmentSource(fragment.id);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const libraryToolbar =
    activeView === "home" || activeView === "frames" ? (
      <LibraryToolbar
        density={browsingMode.density}
        layout={v7Layout}
        sortMode={sortMode}
        onDensityChange={(density) =>
          setBrowsingMode((current) => ({ ...current, density }))
        }
        onLayoutChange={(layout) =>
          setBrowsingMode((current) => ({ ...current, layout }))
        }
        onSortChange={setSortMode}
      />
    ) : undefined;

  return (
    <DesktopShell
      activeView={activeView}
      dropTarget={frameDropTarget}
      expandedIds={new Set(frameNavigator.expandedIds)}
      frameCounts={v7DisplayCounts}
      frames={displayFrames}
      frameTotal={displayFrameTotal}
      pageActions={libraryToolbar}
      pageSubtitle={shellSubtitle}
      pageTitle={shellTitle}
      query={query}
      searchShortcutLabel={formatShortcutBinding(v7Settings.shortcuts.search)}
      selectedFrameId={selectedFrameId}
      showFragmentTree={activeView === "home" || activeView === "frames"}
      showMockWindowControls={previewMode}
      showPageBar={activeView === "home" || activeView === "frames"}
      trashDropState={trashDropState}
      trashTotal={
        previewMode
          ? previewTrashedDemoFragments.length
          : trashTotal + trashedFrames.length
      }
      onBack={() => {
        if (selectedFrameId) {
          selectFrame(
            (
              frameById.get(selectedFrameId) ??
              demoFrameById.get(selectedFrameId)
            )?.parentId ?? null,
          );
        } else if (activeView !== "home") {
          changeView("home");
        }
      }}
      onCreateFragment={openCreateFrame}
      onImportFrames={() => void chooseImages()}
      onPointerDown={(event) => {
        pointerDrag.handlePointerDown(event);
      }}
      onQueryChange={setQuery}
      onSelectFrame={selectFrame}
      onToggleExpanded={toggleFrameExpanded}
      onViewChange={changeView}
    >
      {showVaultHome ? (
        <VaultPage
          assetSourcesFor={(fragment) => assetSourcesFor(fragment, "gallery")}
          density={browsingMode.density}
          dropTarget={frameDropTarget}
          folderNameFor={(fragment) =>
            (
              frameById.get(fragment.frameId) ??
              demoFrameById.get(fragment.frameId)
            )?.name ?? "Vault"
          }
          frameCounts={v7DisplayCounts}
          framePreviews={framePreviewMap}
          frames={visibleFrames.filter((frame) => frame.parentId === null)}
          fragments={vaultRecentFragments}
          ready={previewMode || libraryRevision !== ""}
          searchQuery={query}
          selectedIds={selectedFragmentIdSet}
          systemFrameId={defaultFrameId}
          onAssetFallback={resolveAssetFallback}
          onBrowseAll={() => changeView("frames")}
          onContextMenu={handleFragmentContextMenu}
          onImport={() => void chooseImages()}
          onOpen={openFragmentPreview}
          onOpenFolder={(frame) => selectFrame(frame.id)}
          onOpenSettings={() => changeView("settings")}
          onPointerDown={handleGalleryPointerDown}
          onSelect={handleFragmentCardSelect}
        />
      ) : activeView === "home" || activeView === "frames" ? (
        <FramesPage
          paletteIndex={paletteIndex}
          colorResultsChanged={colorResultsChanged}
          onRefreshColors={() => {
            dispatchSelection({ type: "clear", scopeKey: "" });
            void loadActivePage(selectedFrameIdRef.current, true);
          }}
          assetSourcesFor={(fragment) => assetSourcesFor(fragment, "gallery")}
          density={browsingMode.density}
          filter={fragmentFilter}
          folderNameFor={(fragment) =>
            (
              frameById.get(fragment.frameId) ??
              demoFrameById.get(fragment.frameId)
            )?.name ?? "Vault"
          }
          fragments={galleryFragments}
          hasMore={!previewMode && activeHasMore}
          knownTags={knownTags}
          layout={v7Layout}
          loading={activePageLoading}
          resultCount={displayFrameTotal}
          selectedIds={selectedFragmentIdSet}
          sourceFilter={sourceFilter}
          onAssetFallback={resolveAssetFallback}
          onClearFilters={() => {
            sourceFilterRef.current = "all";
            setSourceFilter("all");
            applyFragmentFilter(EMPTY_FRAGMENT_FILTER);
          }}
          onContextMenu={handleFragmentContextMenu}
          onFilterChange={applyFragmentFilter}
          onLoadMore={previewMode ? undefined : loadNextActivePage}
          onOpen={openFragmentPreview}
          onPointerDown={handleGalleryPointerDown}
          onSelect={handleFragmentCardSelect}
          onSourceFilterChange={(nextSourceFilter) => {
            sourceFilterRef.current = nextSourceFilter;
            setSourceFilter(nextSourceFilter);
            setSelectedSmartFrameId(null);
            dispatchSelection({ type: "clear", scopeKey: "" });
          }}
        />
      ) : activeView === "trash" ? (
        <V7TrashPage
          color={fragmentFilter.color}
          paletteIndex={paletteIndex}
          colorResultsChanged={colorResultsChanged}
          onColorChange={(color) =>
            applyFragmentFilter({ ...fragmentFilter, color })
          }
          onRefreshColors={() => {
            dispatchSelection({ type: "clear", scopeKey: "" });
            void loadTrashPage(true);
          }}
          assetSourcesFor={(fragment) => assetSourcesFor(fragment, "gallery")}
          frameNameFor={(frameId) =>
            (frameById.get(frameId) ?? demoFrameById.get(frameId))?.name ??
            "Vault"
          }
          fragments={v7TrashFragments}
          frames={v7TrashFrames}
          hasMore={!previewMode && trashHasMore}
          loading={trashLoading}
          retentionLabel={
            deletePolicy === "forever"
              ? "Deleted immediately"
              : `Permanently removed after ${deletePolicy} days`
          }
          sort={trashSort}
          onAssetFallback={resolveAssetFallback}
          onEmptyTrash={emptyTrashPermanently}
          onLoadMore={previewMode ? undefined : loadNextTrashPage}
          onRestoreError={reportTrashRestoreFailure}
          onRestoreFragment={async (fragment) => {
            if (isDemoFragment(fragment)) {
              setPreviewTrashState((current) =>
                restorePreviewItems(current, [fragment.id]),
              );
              setStatus("Restored Frame");
              return;
            }
            setError(null);
            await restoreFragments([fragment.id]);
            await refreshSnapshot(true);
            setStatus("Restored Frame");
          }}
          onRestoreFrame={async (frame) => {
            if (frame.id.startsWith("demo-")) return;
            await restoreTrashedFrame(frame);
          }}
          onSortChange={(nextSort) => {
            trashSortRef.current = nextSort;
            setTrashSort(nextSort);
            if (!previewMode) {
              void loadTrashPage(true, false, nextSort);
            }
          }}
          total={
            previewMode
              ? v7TrashFragments.length + v7TrashFrames.length
              : trashTotal + v7TrashFrames.length
          }
        />
      ) : (
        <V7SettingsPage
          paletteIndex={paletteIndex}
          deletePolicy={deletePolicy}
          nativeHostStatus={nativeHostStatus}
          settings={v7Settings}
          theme={theme}
          vaultPath={assetRoot || "~/Library/Application Support/Fragment"}
          onDeletePolicyChange={setDeletePolicy}
          onRefreshNativeHostStatus={refreshNativeHostStatus}
          onRevealVault={async () => {
            if (!isTauriRuntime()) return;
            await revealVaultInFinder();
          }}
          onResetToDefaults={() => {
            setBrowsingMode({ density: "comfortable", layout: "masonry" });
            setFrameNavigator(DEFAULT_FRAME_NAVIGATOR_PREFERENCES);
          }}
          onSettingsChange={setV7Settings}
          onThemeChange={setTheme}
        />
      )}

      {error || pendingImports.length > 0 ? (
        <div className="v7-notice-stack" aria-live="polite">
          {error ? (
            <div className="v7-notice" data-tone="error">
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                onClick={() => setError(null)}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          ) : null}
          {pendingImports.length > 0 ? (
            <div className="v7-notice fragment-import-notice">
              <span>
                {activeImportCount > 0
                  ? `Importing ${activeImportCount} ${activeImportCount === 1 ? "Frame" : "Frames"}`
                  : "Import complete"}
                {failedImportCount > 0 ? ` · ${failedImportCount} failed` : ""}
              </span>
              {failedImportCount > 0 ? (
                <details className="fragment-import-failures">
                  <summary>Show failed imports</summary>
                  <ul>
                    {pendingImports
                      .filter((item) => item.status === "failed")
                      .map((item) => (
                        <li key={item.id}>
                          <strong>{item.name}</strong>
                          <span>
                            {item.error || "This file could not be imported."}
                          </span>
                          <div>
                            <button
                              type="button"
                              onClick={() => retryImport(item)}
                            >
                              Retry
                            </button>
                            <button
                              type="button"
                              onClick={() => skipImport(item)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {(activeView === "home" || activeView === "frames") &&
      selectedVisibleCount > 0 ? (
        <SelectionActionBar
          count={selectedVisibleCount}
          frames={displayFrames}
          knownTags={knownTags}
          onClear={deselectAllFragments}
          onMove={(frameId) =>
            moveSelectedFramesToFragment(selectedFragmentIds, frameId)
          }
          onPreview={() => {
            if (!primarySelectedFragment) {
              throw new Error("The selected Frames are not loaded yet");
            }
            openFragmentPreview(primarySelectedFragment);
          }}
          onTag={tagSelectedFrames}
          onTrash={async () => {
            await moveFragmentsToTrash(selectedFragmentIds);
          }}
        />
      ) : null}

      <DragGhost session={pointerDrag.session} />
      <MarqueeOverlay rect={marquee.rect} />

      {fragmentContextMenu ? (
        <FragmentContextMenu
          {...fragmentContextMenu}
          closeShortcut={v7Settings.shortcuts.closeOverlay}
          canTrash={activeView === "home" || activeView === "frames"}
          canUseNativeActions={
            isTauriRuntime() && !isDemoFragment(fragmentContextMenu.fragment)
          }
          frames={displayFrames}
          onAddToFrame={(frameId) =>
            isDemoFragment(fragmentContextMenu.fragment)
              ? void moveFrameToFragment(fragmentContextMenu.fragment, frameId)
              : void linkFragmentsToFrame(
                  fragmentContextMenu.fragmentIds,
                  frameId,
                )
          }
          onClose={() => setFragmentContextMenu(null)}
          onCopy={() => {
            void copyFragmentImage(fragmentContextMenu.fragment.id)
              .then(() => setStatus("Image copied"))
              .catch((caught) =>
                setError(
                  caught instanceof Error ? caught.message : String(caught),
                ),
              );
          }}
          onOpen={() => openFragmentPreview(fragmentContextMenu.fragment)}
          onOpenSource={
            fragmentContextMenu.fragment.sourceUrl ||
            fragmentContextMenu.fragment.pageUrl
              ? () => void openFocusedSource(fragmentContextMenu.fragment)
              : undefined
          }
          onReveal={() => {
            if (
              isTauriRuntime() &&
              !isDemoFragment(fragmentContextMenu.fragment)
            ) {
              void revealFragmentInFinder(fragmentContextMenu.fragment.id);
            }
          }}
          onTrash={() =>
            void moveFragmentsToTrash(fragmentContextMenu.fragmentIds)
          }
        />
      ) : null}

      {shortcutsOpen ? (
        <KeyboardShortcutsHelp
          closeShortcut={v7Settings.shortcuts.closeOverlay}
          shortcuts={v7Settings.shortcuts}
          onClose={() => setShortcutsOpen(false)}
        />
      ) : null}

      {trashUndo ? (
        <div
          aria-busy={trashUndoPending}
          aria-label="Undoable action"
          className="v7-undo-toast"
          data-pending={trashUndoPending}
          role="region"
        >
          <span className="v7-undo-icon" aria-hidden="true">
            {trashUndo.kind === "import-summary" ? (
              <Undo2 size={16} />
            ) : (
              <Trash2 size={16} />
            )}
          </span>
          <strong aria-atomic="true" aria-live="polite">
            {trashUndo.label}
          </strong>
          {trashUndo.kind !== "import-summary" || trashUndo.ids.length > 0 ? (
            <button
              className="v7-undo-action"
              disabled={trashUndoPending}
              onClick={() => void undoLastTrashMove()}
              type="button"
            >
              {trashUndoPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="v7-undo-pending-icon"
                  size={15}
                />
              ) : (
                <Undo2 aria-hidden="true" size={15} />
              )}
              <span>{trashUndoPending ? "Restoring…" : "Undo"}</span>
            </button>
          ) : null}
          <button
            aria-label="Dismiss Undo"
            className="v7-undo-dismiss"
            disabled={trashUndoPending}
            onClick={dismissTrashUndo}
            title="Dismiss"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      ) : null}

      {frameModal ? (
        <CreateFrameModal
          actionLabel={frameModal.mode === "rename" ? "Save" : "Create"}
          initialName={
            frameModal.mode === "rename" ? frameModal.frame.name : ""
          }
          title={
            frameModal.mode === "rename"
              ? "Rename Fragment"
              : frameModal.parentId
                ? "New nested Fragment"
                : "New Fragment"
          }
          onCancel={() => setFrameModal(null)}
          onSubmit={submitFrame}
        />
      ) : null}

      {focusedFragment ? (
        <FocusedFrameOverlay
          assetRoot={assetRoot}
          showPalette={isTauriRuntime() && !isDemoFragment(focusedFragment)}
          onFindColor={(color) => {
            applyFragmentFilter({ ...fragmentFilter, color });
            setSelectedFragment(null);
            setQuickPreviewFragment(null);
          }}
          actionsOpen={
            fragmentContextMenu?.layer === "overlay" &&
            fragmentContextMenu.fragment.id === focusedFragment.id
          }
          assetSources={assetSourcesFor(focusedFragment, "detail")}
          closeShortcut={v7Settings.shortcuts.closeOverlay}
          currentIndex={focusedIndex}
          fragment={focusedFragment}
          frames={displayFrames}
          tags={fragmentTagsById[focusedFragment.id] ?? []}
          tagsLoading={
            !previewMode &&
            fragmentTagStatusById[focusedFragment.id] !== "ready"
          }
          total={focusedCollection.length}
          onAssetFallback={resolveAssetFallback}
          onClose={() => {
            setSelectedFragment(null);
            setQuickPreviewFragment(null);
          }}
          onFrameChange={
            activeView === "trash"
              ? undefined
              : (frameId) => moveFrameToFragment(focusedFragment, frameId)
          }
          onMoreActions={({ x, y }) => {
            setFragmentContextMenu((current) =>
              current?.layer === "overlay" &&
              current.fragment.id === focusedFragment.id
                ? null
                : {
                    fragment: focusedFragment,
                    fragmentIds: [focusedFragment.id],
                    layer: "overlay",
                    x,
                    y,
                  },
            );
          }}
          onNext={() => showFocusedSibling(1)}
          onNotesChange={
            isTauriRuntime() && !isDemoFragment(focusedFragment)
              ? (notes) =>
                  saveInspectedFragment(
                    focusedFragment,
                    focusedFragment.title ?? null,
                    notes,
                  )
              : undefined
          }
          onTitleChange={(title) =>
            saveFocusedFragmentTitle(focusedFragment, title)
          }
          onTagsChange={(tags) =>
            saveFocusedFragmentTags(focusedFragment, tags)
          }
          onOpenSource={
            focusedFragment.sourceUrl || focusedFragment.pageUrl
              ? () => openFocusedSource(focusedFragment)
              : undefined
          }
          onPrevious={() => showFocusedSibling(-1)}
          onReveal={
            isTauriRuntime() && !isDemoFragment(focusedFragment)
              ? () => revealFragmentInFinder(focusedFragment.id)
              : undefined
          }
          shortcutCloseDisabled={Boolean(fragmentContextMenu)}
        />
      ) : null}
    </DesktopShell>
  );
}
