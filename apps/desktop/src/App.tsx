import {
  useCallback,
  useEffect,
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
import { Trash2, Undo2, X } from "lucide-react";
import { AppShell } from "./app/AppShell";
import { EmptyState } from "./components/EmptyState";
import type { RailView } from "./components/IconRail";
import { FrameCard } from "./components/FrameCard";
import { LoadMoreSentinel } from "./components/LoadMoreSentinel";
import { MasonryGrid } from "./components/MasonryGrid";
import {
  type SortMode,
  type SourceFilter,
  TopCommandBar,
} from "./components/TopCommandBar";
import { CreateFrameModal } from "./features/frames/CreateFrameModal";
import { FrameBreadcrumbs } from "./features/frames/FrameBreadcrumbs";
import { FrameNavigator } from "./features/frames/FrameNavigator";
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
import { FragmentDetailSheet } from "./features/fragments/FragmentDetailSheet";
import {
  importQueueReducer,
  summarizeImportResults,
  type ImportQueueItem,
} from "./features/import/import-state";
import {
  PendingImportCards,
  PendingImportStatus,
} from "./features/import/PendingImports";
import {
  mergeUniqueFragments,
  readSnapshotMetadata,
} from "./features/library/library-state";
import { SelectionToolbar } from "./features/selection/SelectionToolbar";
import { MarqueeOverlay } from "./features/selection/MarqueeOverlay";
import {
  createSelectionState,
  resolveSelectedIds,
  selectionKeyboardIntent,
  selectionReducer,
} from "./features/selection/selection-model";
import { useMarqueeSelection } from "./features/selection/useMarqueeSelection";
import {
  SettingsPage,
  type DeletePolicy,
  type ThemePreference,
} from "./features/settings/SettingsPage";
import { TrashedFramesList } from "./features/trash/TrashedFramesList";
import type { AssetSource } from "./lib/assets";
import {
  addExistingFragmentToFrame,
  assetUrl,
  cancelImportJob,
  copyFragmentImage,
  createFrame,
  deleteFragment,
  deleteFragmentEverywhere,
  deleteFragments,
  deleteFrame,
  fragmentMembershipCount,
  getLibraryRevision,
  importImageBatch,
  isTauriRuntime,
  listFragmentIds,
  listFragmentPage,
  listTrashedFrames,
  loadLibrarySnapshot,
  loadAssetDataUrl,
  moveFrame,
  openFragmentSource,
  renameFrame,
  revealFragmentInFinder,
  restoreFragments,
  restoreFrame,
  updateFragment,
  type ImportBatchEvent,
} from "./lib/tauri";
import { demoFrames, demoFragments, isDemoFragment } from "./lib/demo-vault";

type FrameModalState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; frame: Frame }
  | null;

type ThemeMode = Exclude<ThemePreference, "system">;
type TrashDropState = "idle" | "armed" | "success";
type TrashUndoState =
  | { kind: "fragments"; ids: string[]; label: string }
  | { kind: "frame"; frameId: string; label: string }
  | { kind: "import-summary"; ids: string[]; label: string }
  | null;

const THEME_STORAGE_KEY = "fragment-theme";
const DELETE_POLICY_STORAGE_KEY = "fragment-delete-policy";
const FRAME_NAVIGATOR_STORAGE_KEY = "fragment-frame-navigator-v1";
const LIBRARY_PAGE_SIZE = 60;

function initialTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : "system";
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
  const [activeView, setActiveView] = useState<RailView>("home");
  const [assetRoot, setAssetRoot] = useState("");
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
  const [activeTotal, setActiveTotal] = useState(0);
  const [activeHasMore, setActiveHasMore] = useState(false);
  const [activePageLoading, setActivePageLoading] = useState(false);
  const [trashedFragments, setTrashedFragments] = useState<Fragment[]>([]);
  const [trashedFrames, setTrashedFrames] = useState<Frame[]>([]);
  const [trashTotal, setTrashTotal] = useState(0);
  const [trashHasMore, setTrashHasMore] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
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
  const revisionRef = useRef("");
  const activeTotalRef = useRef(0);
  const activeNextOffsetRef = useRef(0);
  const selectedFrameIdRef = useRef<string | null>(null);
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
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    createSelectionState(),
  );
  const [frameModal, setFrameModal] = useState<FrameModalState>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [deletePolicy, setDeletePolicy] =
    useState<DeletePolicy>(initialDeletePolicy);
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
  const trashUndoTimer = useRef<number | null>(null);
  const previewMode = !isTauriRuntime();

  const rememberRevision = useCallback((revision: string) => {
    revisionRef.current = revision;
    setLibraryRevision(revision);
  }, []);

  const loadActivePage = useCallback(
    async (
      frameId: string | null,
      reset: boolean,
      includeDescendants = includeDescendantsRef.current,
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
    async (reset: boolean) => {
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
          }),
          reset ? listTrashedFrames() : Promise.resolve(null),
        ]);
        if (requestId !== trashPageRequestRef.current) {
          return;
        }
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

  const refreshSnapshot = useCallback(async () => {
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
      return;
    }

    snapshotLoadingRef.current = true;
    try {
      setError(null);
      const snapshot = await loadLibrarySnapshot(LIBRARY_PAGE_SIZE);
      const metadata = readSnapshotMetadata(snapshot);
      setDefaultFrameId(snapshot.defaultFrame.id);
      setFrames(snapshot.frames);
      setFramePreviewFragments(snapshot.fragments);
      setFrameFragmentCounts(metadata.frameCounts);
      setTrashTotal(metadata.trashTotal);
      setAssetRoot(snapshot.assetRoot);
      rememberRevision(snapshot.revision);

      const activeFrameId = selectedFrameIdRef.current;
      if (activeFrameId === null) {
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
        await loadActivePage(activeFrameId, true);
      }
      if (trashLoadedRef.current) {
        await loadTrashPage(true);
      }
      setStatus("Native host ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Needs setup");
    } finally {
      snapshotLoadingRef.current = false;
    }
  }, [loadActivePage, loadTrashPage, rememberRevision]);

  const resolvedTheme = resolvedThemePreference(theme, systemPrefersDark);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemPrefersDark(mediaQuery.matches);
    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    selectedFrameIdRef.current = selectedFrameId;
  }, [selectedFrameId]);

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
      if (!isTauriRuntime() || snapshotLoadingRef.current) {
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
  }, [refreshSnapshot]);

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

  const demoCounts = useMemo(() => {
    const next = new Map<string, number>();
    for (const fragment of demoFragments) {
      next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
    }
    return next;
  }, []);

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
        ? demoFragments
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
      demoFrameById,
      filteredFragments,
      query,
      selectedFrameScopeIds,
      showDemoGallery,
      sortMode,
      sourceFilter,
    ],
  );

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
    const sourceFragments = frames.length > 0 ? cachedFragments : demoFragments;
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
    frames.length,
    query,
    sortMode,
    sourceFilter,
  ]);
  const mainTitle = selectedDisplayFrame
    ? selectedDisplayFrame.name
    : "Your Vault";
  const mainSubtitle = showDemoGallery
    ? previewMode
      ? "Sample wall"
      : "No Fragments yet"
    : `${activeTotal} ${activeTotal === 1 ? "Fragment" : "Fragments"}`;
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
          ? `${visibleFrames.length} ${visibleFrames.length === 1 ? "Frame" : "Frames"}`
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
      : activeView === "home"
        ? visibleFragmentIds
        : [];
  const selectionScopeKey = useMemo(
    () =>
      [
        activeView,
        selectedFrameId ?? "all-frames",
        frameNavigator.includeDescendants ? "with-subframes" : "direct",
        query.trim().toLowerCase(),
        sourceFilter,
      ].join("\u0000"),
    [
      activeView,
      frameNavigator.includeDescendants,
      query,
      selectedFrameId,
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
  const selectedVisibleCount = selectedFragmentIds.length;
  const selectedAllMatching =
    selection.mode === "all-matching" &&
    selection.scopeKey === selectionScopeKey;
  const matchingSelectionTotal = selectedAllMatching
    ? selection.matchingIds.length
    : activeView === "trash"
      ? trashTotal
      : activeView === "home"
        ? activeTotal
        : selectableFragmentIds.length;
  const canSelectAll = previewMode
    ? selectableFragmentIds.length > 0
    : activeView === "trash"
      ? trashTotal > 0
      : activeView === "home" && activeTotal > 0;
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
    function handleSelectionKeyDown(event: KeyboardEvent) {
      if (
        (activeView !== "home" && activeView !== "trash") ||
        selectedFragment ||
        frameModal ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const focusedElement = document.activeElement as HTMLElement | null;
      const focusedId = focusedElement?.dataset.fragmentId ?? null;
      const intent = selectionKeyboardIntent(event.key, {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        hasFocusedItem: Boolean(
          focusedId && selectableFragmentIds.includes(focusedId),
        ),
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
      if (intent === "toggle-focused" && !focusedId) {
        return;
      }
      if (
        intent === "delete-selection" &&
        (activeView !== "home" || selectedFragmentIds.length === 0)
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
      } else {
        dispatchSelection({
          type: "toggle",
          scopeKey: selectionScopeKey,
          matchingIds: selectableFragmentIds,
          id: focusedId!,
        });
      }
    }

    window.addEventListener("keydown", handleSelectionKeyDown);
    return () => window.removeEventListener("keydown", handleSelectionKeyDown);
  }, [
    activeView,
    frameModal,
    selectableFragmentIds,
    selectedFragment,
    selectedFragmentIds.length,
    selectionScopeKey,
    activeTotal,
    previewMode,
    trashTotal,
  ]);

  const selectFrame = useCallback(
    (frameId: string | null) => {
      setSelectedFragment(null);
      selectedFrameIdRef.current = frameId;
      setSelectedFrameId(frameId);
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
    [activeFrameUniverse, loadActivePage],
  );

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
    return uniqueValues(paths);
  }

  const resolveAssetFallback = useCallback(
    async (relativePath: string) => {
      if (assetDataUrls[relativePath]) {
        return assetDataUrls[relativePath];
      }
      if (assetFallbackRequests.current[relativePath]) {
        return assetFallbackRequests.current[relativePath];
      }

      const request = loadAssetDataUrl(relativePath)
        .then((dataUrl) => {
          setAssetDataUrls((current) =>
            current[relativePath]
              ? current
              : { ...current, [relativePath]: dataUrl },
          );
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
    [assetDataUrls],
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
      return "No matching Fragments";
    }
    if (selectedDisplayFrame) {
      return `No Fragments in ${selectedDisplayFrame.name} yet`;
    }
    return "No Fragments in your Vault yet";
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

  function selectFragmentRange(fragmentId: string, additive = false) {
    dispatchSelection({
      type: "range",
      scopeKey: selectionScopeKey,
      matchingIds: selectableFragmentIds,
      id: fragmentId,
      additive,
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

    setStatus("Selecting matching Fragments");
    try {
      const matchingIds = await listFragmentIds({
        frameId: activeView === "home" ? selectedFrameId : null,
        includeDescendants:
          activeView === "home" && Boolean(selectedFrameId)
            ? frameNavigator.includeDescendants
            : false,
        trashed: activeView === "trash",
        query,
        sourceFilter,
      });
      dispatchSelection({
        type: "select-all",
        scopeKey: selectionScopeKey,
        matchingIds,
      });
      setStatus(
        matchingIds.length === 1
          ? "Selected 1 Fragment"
          : `Selected ${matchingIds.length} Fragments`,
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
    if (event.shiftKey) {
      event.preventDefault();
      selectFragmentRange(fragment.id, event.metaKey || event.ctrlKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || selectedFragmentIds.length > 0) {
      event.preventDefault();
      toggleFragmentSelection(fragment.id);
      return;
    }

    if (!isDemoFragment(fragment)) {
      setSelectedFragment(fragment);
    }
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
    if (activeFrameId === null || activeFrameId === fragment.frameId) {
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
    const frameId = selectedFrameIdRef.current;
    const frameName = selectedDisplayFrame?.name ?? "Inbox";
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
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"],
        },
      ],
    });
    if (!selected) {
      return;
    }
    void importPaths(Array.isArray(selected) ? selected : [selected]);
  }

  function changeView(view: RailView) {
    setSelectedFragment(null);
    setFrameModal(null);
    dispatchSelection({ type: "clear", scopeKey: "" });
    if (view === "trash" || view === "settings") {
      selectedFrameIdRef.current = null;
      setSelectedFrameId(null);
    }
    setActiveView(view);
    if (
      view === "home" &&
      activePageFrameIdRef.current !== selectedFrameIdRef.current &&
      isTauriRuntime()
    ) {
      void loadActivePage(selectedFrameIdRef.current, true);
    }
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
      setError("Inbox is a protected Frame.");
      return;
    }
    try {
      await renameFrame(frame.id, name);
      setStatus(`Renamed Frame to ${name}`);
      await refreshSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Frame rename failed");
    }
  }

  async function submitFrame(name: string) {
    if (frameModal?.mode === "rename") {
      if (isProtectedFrame(frameModal.frame)) {
        setError("Inbox is a protected Frame.");
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
      setError("Inbox is a protected Frame.");
      return;
    }
    const count = recursiveDisplayCounts.get(frame.id) ?? 0;
    const confirmed = window.confirm(
      `${deletePolicy === "forever" ? "Delete" : "Move"} "${frame.name}"${count > 0 ? ` with its ${count} ${count === 1 ? "Fragment" : "Fragments"}` : ""} ${deletePolicy === "forever" ? "forever" : `to Trash for ${deletePolicy} days`}?`,
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
        ? `Remove "${selectedFragment.title ?? "Fragment"}" from this Frame? The shared image stays in ${sharedCount - 1} other ${sharedCount - 1 === 1 ? "place" : "places"}.`
        : `Delete "${selectedFragment.title ?? "Fragment"}"? This will ${deletePolicyLabel()}.`,
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
      `Delete "${selectedFragment.title ?? "Fragment"}" everywhere? This removes ${sharedCount} ${sharedCount === 1 ? "reference" : "references"} and the shared image file.`,
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

  async function removeSelectedFragments() {
    const ids = selectedFragmentIds.filter((id) => !id.startsWith("demo-"));
    if (ids.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${ids.length} selected ${ids.length === 1 ? "Fragment" : "Fragments"}? This will ${deletePolicyLabel()}.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFragments(ids, deleteRetentionDays());
    deselectAllFragments();
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
      ids.length === 1
        ? "Restored Fragment"
        : `Restored ${ids.length} Fragments`,
    );
    await refreshSnapshot();
  }

  function pointerDragPayloadFor(target: Element): PointerDragPayload | null {
    const fragmentCard = target.closest<HTMLElement>(
      ".fragment-card[data-fragment-id]",
    );
    if (fragmentCard && activeView === "home") {
      const fragmentId = fragmentCard.dataset.fragmentId;
      if (!fragmentId || fragmentId.startsWith("demo-")) {
        return null;
      }
      const ids =
        selectedFragmentIdSet.has(fragmentId) && selectedFragmentIds.length > 0
          ? selectedFragmentIds.filter((id) => !id.startsWith("demo-"))
          : [fragmentId];
      const available = new Map(
        [...cachedFragments, ...trashedFragments].map((fragment) => [
          fragment.id,
          fragment,
        ]),
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
        label: `${ids.length} ${ids.length === 1 ? "Fragment" : "Fragments"}`,
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
            "A Frame cannot move inside itself or one of its Sub-frames.",
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
            ? `Moved ${movedFrame?.name ?? "Frame"} into ${frames.find((frame) => frame.id === placement.parentId)?.name ?? "Frame"}`
            : `Moved ${movedFrame?.name ?? "Frame"} to the Vault root`,
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
      throw new Error("Destination Frame was not found");
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

  function dismissTrashUndo() {
    if (trashUndoTimer.current !== null) {
      window.clearTimeout(trashUndoTimer.current);
      trashUndoTimer.current = null;
    }
    setTrashUndo(null);
  }

  function offerTrashUndo(ids: string[]) {
    dismissTrashUndo();
    setTrashUndo({
      kind: "fragments",
      ids,
      label: `${ids.length} ${ids.length === 1 ? "Fragment" : "Fragments"} moved to Trash`,
    });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  function offerFrameTrashUndo(frame: Frame) {
    dismissTrashUndo();
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
    dismissTrashUndo();
    setTrashUndo({ kind: "import-summary", ids, label });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  async function undoLastTrashMove() {
    if (!trashUndo) {
      return;
    }
    const undo = trashUndo;
    dismissTrashUndo();
    try {
      if (undo.kind === "frame") {
        await restoreFrame(undo.frameId);
        setStatus("Restored Frame");
      } else if (undo.kind === "import-summary") {
        if (undo.ids.length > 0) {
          await deleteFragments(undo.ids, 0);
        }
        setStatus(
          undo.ids.length === 1
            ? "Removed linked Fragment"
            : `Removed ${undo.ids.length} linked Fragments`,
        );
      } else {
        await restoreFragments(undo.ids);
        setStatus(
          undo.ids.length === 1
            ? "Restored Fragment"
            : `Restored ${undo.ids.length} Fragments`,
        );
      }
      await refreshSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Restore failed");
    }
  }

  async function moveFragmentsToTrash(ids: string[]) {
    const realIds = Array.from(
      new Set(ids.filter((id) => !id.startsWith("demo-"))),
    );
    if (realIds.length === 0) {
      return false;
    }
    if (deletePolicy === "forever") {
      const confirmed = window.confirm(
        `Delete ${realIds.length} ${realIds.length === 1 ? "Fragment" : "Fragments"} forever?`,
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
        ? "Deleted Fragment"
        : `Moved ${realIds.length} to Trash`,
    );
    await refreshSnapshot();
    return true;
  }

  async function moveFrameToTrash(frameId: string) {
    const frame = frames.find((item) => item.id === frameId);
    if (!frame) {
      return false;
    }
    if (isProtectedFrame(frame)) {
      setError("Inbox is a protected Frame.");
      return false;
    }
    const count = recursiveDisplayCounts.get(frame.id) ?? 0;
    const confirmed = window.confirm(
      `${deletePolicy === "forever" ? "Delete" : "Move"} "${frame.name}"${count > 0 ? ` with its ${count} ${count === 1 ? "Fragment" : "Fragments"}` : ""} ${deletePolicy === "forever" ? "forever" : `to Trash for ${deletePolicy} days`}?`,
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
      deletePolicy === "forever" ? "Deleted Frame" : "Moved Frame to Trash",
    );
    await refreshSnapshot();
    return true;
  }

  async function restoreTrashedFrame(frame: Frame) {
    try {
      await restoreFrame(frame.id);
      setStatus(`Restored ${frame.name}`);
      await refreshSnapshot();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Frame restore failed");
    }
  }

  const frameCards = (
    <section className="frame-section">
      <div className="section-heading">
        <h2>Frames</h2>
        <span>{visibleFrames.length} total</span>
      </div>
      <div
        className="frame-card-grid"
        onPointerDown={pointerDrag.handlePointerDown}
      >
        {visibleFrames.map((frame) => {
          const frameFragments = (
            frames.length > 0 ? cachedFragments : demoFragments
          ).filter((fragment) => fragment.frameId === frame.id);
          const demo = frame.id.startsWith("demo-");
          const protectedFrame = !demo && isProtectedFrame(frame);
          return (
            <FrameCard
              assetFor={(fragment) =>
                assetSourcesFor(fragment, "gallery")[0] ?? { url: "" }
              }
              frame={frame}
              fragments={frameFragments}
              key={frame.id}
              onAssetFallback={resolveAssetFallback}
              protectedFrame={protectedFrame}
              readonly={demo}
              onDelete={() => (demo ? undefined : void removeFrame(frame))}
              onOpen={() => {
                if (demo) {
                  return;
                }
                selectFrame(frame.id);
              }}
              onRename={() =>
                demo || protectedFrame
                  ? undefined
                  : setFrameModal({ mode: "rename", frame })
              }
            />
          );
        })}
      </div>
    </section>
  );

  const detailFragments = (
    activeView === "trash" ? visibleTrashedFragments : galleryFragments
  ).filter((fragment) => !isDemoFragment(fragment));
  const selectedDetailIndex = selectedFragment
    ? detailFragments.findIndex(
        (fragment) => fragment.id === selectedFragment.id,
      )
    : -1;

  function navigateDetail(direction: -1 | 1) {
    const nextFragment = detailFragments[selectedDetailIndex + direction];
    if (nextFragment) {
      setSelectedFragment(nextFragment);
    }
  }

  return (
    <AppShell
      navigator={
        <FrameNavigator
          activeView={activeView}
          collapsed={frameNavigator.collapsed}
          defaultFrameId={
            defaultFrameId ??
            displayFrames.find(
              (frame) => frame.name === "Inbox" && frame.parentId === null,
            )?.id ??
            null
          }
          directCounts={displayCounts}
          dropTarget={frameDropTarget}
          expandedIds={new Set(frameNavigator.expandedIds)}
          frames={displayFrames}
          pinnedIds={new Set(frameNavigator.pinnedIds)}
          recursiveCounts={recursiveDisplayCounts}
          selectedFrameId={selectedFrameId}
          trashDropState={trashDropState}
          width={frameNavigator.width}
          onCollapsedChange={(collapsed) =>
            setFrameNavigator((current) => ({ ...current, collapsed }))
          }
          onCreateFrame={openCreateFrame}
          onDeleteFrame={(frame) => void removeFrame(frame)}
          onPointerDown={(event) => {
            pointerDrag.handlePointerDown(event);
          }}
          onRenameFrame={renameFrameFromNavigator}
          onSelectFrame={selectFrame}
          onToggleExpanded={toggleFrameExpanded}
          onTogglePinned={toggleFramePinned}
          onViewChange={changeView}
          onWidthChange={(width) =>
            setFrameNavigator((current) => ({ ...current, width }))
          }
        />
      }
      navigatorCollapsed={frameNavigator.collapsed}
      navigatorWidth={frameNavigator.width}
    >
      <TopCommandBar
        query={query}
        onQueryChange={setQuery}
        onCreateFrame={() => openCreateFrame(null)}
        onImport={() => void chooseImages()}
        onSortChange={setSortMode}
        onSourceFilterChange={setSourceFilter}
        onSelectAll={
          (activeView === "home" || activeView === "trash") &&
          selectedVisibleCount === 0 &&
          canSelectAll
            ? () => void selectAllMatchingFragments()
            : undefined
        }
        showLibraryTools={
          activeView === "home" ||
          activeView === "frames" ||
          activeView === "trash"
        }
        sourceFilter={sourceFilter}
        sortMode={sortMode}
        subtitle={commandSubtitle}
        title={commandTitle}
      />

      <div className="content-stage" data-drag-active={dragActive}>
        {activeView === "home" ? (
          <FrameBreadcrumbs
            frames={displayFrames}
            includeDescendants={frameNavigator.includeDescendants}
            selectedFrameId={selectedFrameId}
            onIncludeDescendantsChange={setIncludeDescendants}
            onSelectFrame={selectFrame}
          />
        ) : null}

        {activeView === "home" ? (
          <SelectionToolbar
            allMatching={selectedAllMatching}
            context="vault"
            count={selectedVisibleCount}
            totalCount={matchingSelectionTotal}
            onClear={deselectAllFragments}
            onDelete={() => void removeSelectedFragments()}
            onSelectAll={() => void selectAllMatchingFragments()}
          />
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}

        {pendingImports.length > 0 ? (
          <PendingImportStatus
            activeCount={activeImportCount}
            failedCount={failedImportCount}
          />
        ) : null}

        {activeView === "frames" ? (
          frameCards
        ) : activeView === "trash" ? (
          <section className="trash-page fragment-section">
            <div className="trash-panel">
              <Trash2 aria-hidden="true" size={22} />
              <div>
                <strong>Trash</strong>
                <span>
                  {deletePolicy === "forever"
                    ? "Delete forever is active"
                    : `Frames and Fragments stay here for ${deletePolicy} days`}
                </span>
              </div>
            </div>
            <SelectionToolbar
              allMatching={selectedAllMatching}
              context="trash"
              count={selectedVisibleCount}
              totalCount={matchingSelectionTotal}
              onClear={deselectAllFragments}
              onRestore={() => void restoreSelectedFragments()}
              onSelectAll={() => void selectAllMatchingFragments()}
            />
            {visibleTrashedFrames.length > 0 ? (
              <TrashedFramesList
                frames={visibleTrashedFrames}
                onRestore={restoreTrashedFrame}
              />
            ) : null}
            {trashLoading && !trashLoaded ? (
              <div className="import-status" aria-live="polite">
                <span />
                <strong>Loading Trash</strong>
                <small>Your active library remains available.</small>
              </div>
            ) : visibleTrashedFragments.length === 0 &&
              visibleTrashedFrames.length === 0 ? (
              <EmptyState
                actionLabel="Back to Vault"
                title={
                  query.trim() ? "No matching Trash items" : "Trash is empty"
                }
                onAction={() => changeView("home")}
              />
            ) : visibleTrashedFragments.length > 0 ? (
              <div
                className="gallery-wrap trash-gallery"
                onPointerDown={handleGalleryPointerDown}
              >
                <MasonryGrid
                  assetSourcesFor={(fragment) =>
                    assetSourcesFor(fragment, "gallery")
                  }
                  fragments={visibleTrashedFragments}
                  onAssetFallback={resolveAssetFallback}
                  selectionActive={selectedVisibleCount > 0}
                  selectedIds={selectedFragmentIdSet}
                  onSelect={handleFragmentCardSelect}
                />
                {trashHasMore || trashLoading ? (
                  <LoadMoreSentinel
                    hasMore={trashHasMore}
                    loadedCount={trashedFragments.length}
                    loading={trashLoading}
                    totalCount={trashTotal}
                    onLoadMore={loadNextTrashPage}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : activeView === "settings" ? (
          <SettingsPage
            deletePolicy={deletePolicy}
            theme={theme}
            onDeletePolicyChange={setDeletePolicy}
            onThemeChange={setTheme}
          />
        ) : (
          <>
            <section className="fragment-section">
              {pendingImports.length > 0 ? (
                <PendingImportCards
                  items={pendingImports}
                  onCancel={(item) => void cancelImport(item)}
                  onRetry={retryImport}
                  onSkip={skipImport}
                />
              ) : null}
              {showEmptyState ? (
                <EmptyState
                  actionLabel={query.trim() ? "Clear Search" : "Import Images"}
                  title={emptyStateTitle()}
                  onAction={emptyStateAction}
                />
              ) : (
                <div
                  className="gallery-wrap"
                  data-demo={showDemoGallery}
                  onPointerDown={handleGalleryPointerDown}
                >
                  <MasonryGrid
                    assetSourcesFor={(fragment) =>
                      assetSourcesFor(fragment, "gallery")
                    }
                    fragments={galleryFragments}
                    onAssetFallback={resolveAssetFallback}
                    selectionActive={selectedVisibleCount > 0}
                    selectedIds={selectedFragmentIdSet}
                    onSelect={handleFragmentCardSelect}
                  />
                  {!showDemoGallery && (activeHasMore || activePageLoading) ? (
                    <LoadMoreSentinel
                      hasMore={activeHasMore}
                      loadedCount={fragments.length}
                      loading={activePageLoading}
                      totalCount={activeTotal}
                      onLoadMore={loadNextActivePage}
                    />
                  ) : null}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <DragGhost session={pointerDrag.session} />
      <MarqueeOverlay rect={marquee.rect} />

      {trashUndo ? (
        <div aria-label="Undoable action" className="undo-toast" role="region">
          {trashUndo.kind === "import-summary" ? (
            <Undo2 aria-hidden="true" size={17} />
          ) : (
            <Trash2 aria-hidden="true" size={17} />
          )}
          <strong aria-live="polite">{trashUndo.label}</strong>
          {trashUndo.kind !== "import-summary" || trashUndo.ids.length > 0 ? (
            <button
              className="button compact"
              onClick={() => void undoLastTrashMove()}
              type="button"
            >
              <Undo2 aria-hidden="true" size={15} />
              <span>Undo</span>
            </button>
          ) : null}
          <button
            aria-label="Dismiss Undo"
            className="icon-button compact-icon"
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
              ? "Rename"
              : frameModal.parentId
                ? "New Sub-frame"
                : "New Frame"
          }
          onCancel={() => setFrameModal(null)}
          onSubmit={submitFrame}
        />
      ) : null}

      {selectedFragment ? (
        <FragmentDetailSheet
          assetSources={assetSourcesFor(selectedFragment, "detail")}
          transparentAsset={isTransparentAsset(selectedFragment)}
          fragment={selectedFragment}
          sharedReferenceCount={selectedFragmentReferenceCount}
          onAssetFallback={resolveAssetFallback}
          onClose={() => setSelectedFragment(null)}
          onCopyImage={
            isTauriRuntime()
              ? () => copyFragmentImage(selectedFragment.id)
              : undefined
          }
          onDelete={removeSelectedFragment}
          onDeleteEverywhere={removeSelectedFragmentEverywhere}
          onOpenSource={() => openFragmentSource(selectedFragment.id)}
          onReveal={() => revealFragmentInFinder(selectedFragment.id)}
          onSave={saveSelectedFragment}
          onNext={
            selectedDetailIndex >= 0 &&
            selectedDetailIndex < detailFragments.length - 1
              ? () => navigateDetail(1)
              : undefined
          }
          onPrevious={
            selectedDetailIndex > 0 ? () => navigateDetail(-1) : undefined
          }
        />
      ) : null}
    </AppShell>
  );
}
