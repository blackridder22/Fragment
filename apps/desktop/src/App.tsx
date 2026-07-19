import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import type { Fragment, Frame } from "@fragment/shared";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Monitor,
  Moon,
  Plug,
  ShieldCheck,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { AppShell } from "./app/AppShell";
import { EmptyState } from "./components/EmptyState";
import type { RailView } from "./components/IconRail";
import { FrameCard } from "./components/FrameCard";
import { FrameChipBar } from "./components/FrameChipBar";
import { MasonryGrid } from "./components/MasonryGrid";
import {
  type SortMode,
  type SourceFilter,
  TopCommandBar,
} from "./components/TopCommandBar";
import { CreateFrameModal } from "./features/frames/CreateFrameModal";
import { FragmentDetailSheet } from "./features/fragments/FragmentDetailSheet";
import { SelectionToolbar } from "./features/selection/SelectionToolbar";
import {
  createSelectionState,
  resolveSelectedIds,
  selectionKeyboardIntent,
  selectionReducer,
} from "./features/selection/selection-model";
import type { AssetSource } from "./lib/assets";
import {
  assetUrl,
  checkImportDuplicate,
  createFrame,
  deleteFragment,
  deleteFragmentEverywhere,
  deleteFrame,
  ensureDefaultFrame,
  importImage,
  isTauriRuntime,
  listAllFragments,
  listFrames,
  listTrashedFragments,
  loadAssetDataUrl,
  loadAssetRoot,
  openFragmentSource,
  renameFrame,
  revealFragmentInFinder,
  restoreFragment,
  updateFragment,
} from "./lib/tauri";
import { demoFrames, demoFragments, isDemoFragment } from "./lib/demo-vault";

type FrameModalState =
  | { mode: "create" }
  | { mode: "rename"; frame: Frame }
  | null;

type PendingImport = {
  id: string;
  name: string;
  path: string;
  frameName: string;
};

type ThemeMode = "light" | "dark";
type ThemePreference = ThemeMode | "system";
type DeletePolicy = "forever" | "7" | "14" | "24" | "31";
type TrashDropState = "idle" | "armed" | "success";
type TrashDragPayload =
  | { kind: "fragments"; ids: string[] }
  | { kind: "frame"; id: string };
type TrashUndoState = { ids: string[]; label: string } | null;

const THEME_STORAGE_KEY = "fragment-theme";
const DELETE_POLICY_STORAGE_KEY = "fragment-delete-policy";
const FRAGMENT_DRAG_MIME = "application/x-fragment-fragment-ids";
const FRAME_DRAG_MIME = "application/x-fragment-frame-id";

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
    return "forever";
  }
  const stored = window.localStorage.getItem(DELETE_POLICY_STORAGE_KEY);
  return stored === "7" || stored === "14" || stored === "24" || stored === "31"
    ? stored
    : "forever";
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
  const [trashedFragments, setTrashedFragments] = useState<Fragment[]>([]);
  const [pendingImports, setPendingImports] = useState<PendingImport[]>([]);
  const [assetDataUrls, setAssetDataUrls] = useState<Record<string, string>>(
    {},
  );
  const assetFallbackRequests = useRef<
    Partial<Record<string, Promise<string | null>>>
  >({});
  const trashDragPayload = useRef<TrashDragPayload | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<Fragment | null>(
    null,
  );
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
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    initialSystemPrefersDark,
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [dragActive, setDragActive] = useState(false);
  const [trashDropState, setTrashDropState] = useState<TrashDropState>("idle");
  const [trashUndo, setTrashUndo] = useState<TrashUndoState>(null);
  const trashUndoTimer = useRef<number | null>(null);
  const previewMode = !isTauriRuntime();

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setFrames([]);
      setFragments([]);
      setTrashedFragments([]);
      setAssetRoot("");
      setDefaultFrameId(null);
      setError(null);
      setStatus("Browser preview");
      return;
    }

    try {
      setError(null);
      const defaultFrame = await ensureDefaultFrame();
      const [nextFrames, nextFragments, nextTrashedFragments, nextRoot] =
        await Promise.all([
          listFrames(),
          listAllFragments(),
          listTrashedFragments(),
          loadAssetRoot(),
        ]);
      setDefaultFrameId(defaultFrame.id);
      setFrames(nextFrames);
      setFragments(nextFragments);
      setTrashedFragments(nextTrashedFragments);
      setAssetRoot(nextRoot);
      setStatus("Native host ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Needs setup");
    }
  }, []);

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
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      if (trashUndoTimer.current !== null) {
        window.clearTimeout(trashUndoTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

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
            void importPaths(event.payload.paths);
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
  }, [selectedFrameId]);

  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );

  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const fragment of fragments) {
      next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
    }
    return next;
  }, [fragments]);

  const demoCounts = useMemo(() => {
    const next = new Map<string, number>();
    for (const fragment of demoFragments) {
      next.set(fragment.frameId, (next.get(fragment.frameId) ?? 0) + 1);
    }
    return next;
  }, []);

  const filteredFragments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return fragments
      .filter((fragment) => {
        if (selectedFrameId && fragment.frameId !== selectedFrameId) {
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
  }, [fragments, frameById, query, selectedFrameId, sortMode, sourceFilter]);

  const demoFrameById = useMemo(
    () => new Map(demoFrames.map((frame) => [frame.id, frame])),
    [],
  );

  const showDemoGallery = previewMode && filteredFragments.length === 0;
  const galleryFragments = showDemoGallery
    ? demoFragments
        .filter((fragment) => {
          const normalized = query.trim().toLowerCase();
          if (
            selectedFrameId?.startsWith("demo-") &&
            fragment.frameId !== selectedFrameId
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
    : filteredFragments;

  const selectedDisplayFrame = selectedFrameId
    ? (frameById.get(selectedFrameId) ??
      (previewMode ? demoFrameById.get(selectedFrameId) : undefined) ??
      null)
    : null;
  const displayFrames =
    frames.length > 0 ? frames : previewMode ? demoFrames : [];
  const displayCounts =
    frames.length > 0 ? counts : previewMode ? demoCounts : new Map();
  const visibleFrames = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sourceFragments = frames.length > 0 ? fragments : demoFragments;
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
    fragments,
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
    : `${galleryFragments.length} ${galleryFragments.length === 1 ? "Fragment" : "Fragments"}`;
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
        ? `${trashedFragments.length} ${trashedFragments.length === 1 ? "Fragment" : "Fragments"}`
        : activeView === "frames"
          ? `${visibleFrames.length} ${visibleFrames.length === 1 ? "Frame" : "Frames"}`
          : mainSubtitle;
  const showEmptyState =
    !showDemoGallery &&
    galleryFragments.length === 0 &&
    pendingImports.length === 0;
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
        query.trim().toLowerCase(),
        sourceFilter,
      ].join("\u0000"),
    [activeView, query, selectedFrameId, sourceFilter],
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
      });
      if (!intent) {
        return;
      }
      if (intent === "clear" && selectedFragmentIds.length === 0) {
        return;
      }
      if (intent === "select-all" && selectableFragmentIds.length === 0) {
        return;
      }
      if (intent === "toggle-focused" && !focusedId) {
        return;
      }

      event.preventDefault();
      if (intent === "select-all") {
        dispatchSelection({
          type: "select-all",
          scopeKey: selectionScopeKey,
          matchingIds: selectableFragmentIds,
        });
      } else if (intent === "clear") {
        dispatchSelection({ type: "clear", scopeKey: selectionScopeKey });
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
  ]);

  const selectFrame = useCallback((frameId: string | null) => {
    setSelectedFragment(null);
    setSelectedFrameId(frameId);
    dispatchSelection({ type: "clear", scopeKey: "" });
    setActiveView("home");
  }, []);

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

  function selectAllMatchingFragments() {
    dispatchSelection({
      type: "select-all",
      scopeKey: selectionScopeKey,
      matchingIds: selectableFragmentIds,
    });
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

  async function importPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    const frameName = selectedDisplayFrame?.name ?? "Inbox";
    const batch = paths.map((path, index) => ({
      id: `${Date.now()}-${index}`,
      name: fileNameFromPath(path),
      path,
      frameName,
    }));
    setPendingImports((current) => [...batch, ...current]);

    try {
      setError(null);
      setStatus(
        paths.length === 1
          ? "Importing 1 image"
          : `Importing ${paths.length} images`,
      );
      let importedCount = 0;
      for (const item of batch) {
        const duplicate = await checkImportDuplicate(
          selectedFrameId,
          item.path,
        );
        let titleOverride: string | null | undefined;
        if (duplicate.duplicate) {
          if (duplicate.kind === "same_image_in_vault") {
            const existingFrameName =
              duplicate.existingFrameName ?? "another Frame";
            const confirmed = window.confirm(
              `This exact image already exists in ${existingFrameName}.\n\nAdd it to ${frameName} too? Fragment will share the same local asset, not duplicate the file.`,
            );
            if (!confirmed) {
              setPendingImports((current) =>
                current.filter((pending) => pending.id !== item.id),
              );
              continue;
            }
          } else {
            const reason =
              duplicate.kind === "same_name_and_pixels"
                ? `A Fragment named "${duplicate.existingTitle ?? item.name}" with the same pixel size already exists in this Frame.`
                : `This exact image already exists in this Frame.`;
            const renamed = window.prompt(
              `${reason}\n\nEnter a new name to import it anyway, or press Cancel for Never mind.`,
              duplicate.suggestedTitle ?? `${item.name} copy`,
            );
            if (!renamed?.trim()) {
              setPendingImports((current) =>
                current.filter((pending) => pending.id !== item.id),
              );
              continue;
            }
            titleOverride = renamed.trim();
          }
        }

        const imported = await importImage(
          selectedFrameId,
          item.path,
          titleOverride,
        );
        importedCount += 1;
        setFragments((current) => [
          imported,
          ...current.filter((fragment) => fragment.id !== imported.id),
        ]);
        setPendingImports((current) =>
          current.filter((pending) => pending.id !== item.id),
        );
      }
      void refresh();
      setStatus(importedCount > 0 ? "Imported" : "Import cancelled");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Import failed");
      setPendingImports((current) =>
        current.filter(
          (pending) => !batch.some((item) => item.id === pending.id),
        ),
      );
    }
  }

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
      setSelectedFrameId(null);
    }
    setActiveView(view);
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
      const created = await createFrame(name);
      setSelectedFrameId(created.id);
      setSelectedFragment(null);
      setActiveView("home");
    }
    setFrameModal(null);
    await refresh();
  }

  async function removeFrame(frame: Frame) {
    if (isProtectedFrame(frame)) {
      setError("Inbox is a protected Frame.");
      return;
    }
    const count = counts.get(frame.id) ?? 0;
    if (count > 0) {
      const confirmed = window.confirm(
        `Delete "${frame.name}" and its ${count} Fragments? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
    }
    await deleteFrame(frame.id);
    if (selectedFrameId === frame.id) {
      setSelectedFrameId(null);
    }
    await refresh();
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
    await refresh();
  }

  function sharedReferenceCount(fragment: Fragment) {
    if (!fragment.assetId) {
      return 1;
    }
    return [...fragments, ...trashedFragments].filter(
      (item) => item.assetId === fragment.assetId,
    ).length;
  }

  async function removeSelectedFragment() {
    if (!selectedFragment) {
      return;
    }
    const sharedCount = sharedReferenceCount(selectedFragment);
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
    await refresh();
  }

  async function removeSelectedFragmentEverywhere() {
    if (!selectedFragment) {
      return;
    }
    const sharedCount = sharedReferenceCount(selectedFragment);
    const confirmed = window.confirm(
      `Delete "${selectedFragment.title ?? "Fragment"}" everywhere? This removes ${sharedCount} ${sharedCount === 1 ? "reference" : "references"} and the shared image file.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteFragmentEverywhere(selectedFragment.id);
    setSelectedFragment(null);
    deselectAllFragments();
    setStatus("Deleted everywhere");
    await refresh();
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
    await Promise.all(
      ids.map((id) => deleteFragment(id, deleteRetentionDays())),
    );
    deselectAllFragments();
    await refresh();
  }

  async function restoreSelectedFragments() {
    const ids = selectedFragmentIds.filter((id) => !id.startsWith("demo-"));
    if (ids.length === 0) {
      return;
    }
    await Promise.all(ids.map((id) => restoreFragment(id)));
    deselectAllFragments();
    setStatus(
      ids.length === 1
        ? "Restored Fragment"
        : `Restored ${ids.length} Fragments`,
    );
    await refresh();
  }

  function dragTypes(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types);
  }

  function hasTrashPayload(event: DragEvent<HTMLElement>) {
    const types = dragTypes(event);
    return (
      trashDragPayload.current !== null ||
      types.includes(FRAGMENT_DRAG_MIME) ||
      types.includes(FRAME_DRAG_MIME)
    );
  }

  function armTrashDrop(event: DragEvent<HTMLElement>) {
    if (!hasTrashPayload(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTrashDropState("armed");
  }

  function handleTrashDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setTrashDropState("idle");
  }

  function handleDragEnd(event: DragEvent<HTMLElement>) {
    event.currentTarget.removeAttribute("data-dragging");
    trashDragPayload.current = null;
    setTrashDropState("idle");
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
      ids,
      label: `${ids.length} ${ids.length === 1 ? "Fragment" : "Fragments"} moved to Trash`,
    });
    trashUndoTimer.current = window.setTimeout(() => {
      trashUndoTimer.current = null;
      setTrashUndo(null);
    }, 6000);
  }

  async function undoLastTrashMove() {
    if (!trashUndo) {
      return;
    }
    const ids = trashUndo.ids;
    dismissTrashUndo();
    try {
      await Promise.all(ids.map((id) => restoreFragment(id)));
      setStatus(
        ids.length === 1
          ? "Restored Fragment"
          : `Restored ${ids.length} Fragments`,
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Restore failed");
    }
  }

  function handleFragmentDragStart(
    fragment: Fragment,
    event: DragEvent<HTMLElement>,
  ) {
    if (isDemoFragment(fragment)) {
      event.preventDefault();
      return;
    }
    const selectedIds =
      selectedFragmentIds.includes(fragment.id) &&
      selectedFragmentIds.length > 0
        ? selectedFragmentIds
        : [fragment.id];
    const ids = Array.from(
      new Set(selectedIds.filter((id) => !id.startsWith("demo-"))),
    );
    if (ids.length === 0) {
      event.preventDefault();
      return;
    }
    event.currentTarget.setAttribute("data-dragging", "true");
    trashDragPayload.current = { kind: "fragments", ids };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FRAGMENT_DRAG_MIME, JSON.stringify(ids));
    event.dataTransfer.setData(
      "text/plain",
      `${ids.length} ${ids.length === 1 ? "Fragment" : "Fragments"}`,
    );
  }

  function handleFrameDragStart(frame: Frame, event: DragEvent<HTMLElement>) {
    if (frame.id.startsWith("demo-") || isProtectedFrame(frame)) {
      event.preventDefault();
      return;
    }
    event.currentTarget.setAttribute("data-dragging", "true");
    trashDragPayload.current = { kind: "frame", id: frame.id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FRAME_DRAG_MIME, frame.id);
    event.dataTransfer.setData("text/plain", frame.name);
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
    await Promise.all(
      realIds.map((id) => deleteFragment(id, deleteRetentionDays())),
    );
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
    await refresh();
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
    const count = counts.get(frame.id) ?? 0;
    const confirmed = window.confirm(
      `Delete "${frame.name}" permanently${count > 0 ? ` with its ${count} ${count === 1 ? "Fragment" : "Fragments"}` : ""}? Frame restore is not available yet.`,
    );
    if (!confirmed) {
      return false;
    }
    await deleteFrame(frame.id);
    if (selectedFrameId === frame.id) {
      setSelectedFrameId(null);
    }
    dispatchSelection({ type: "clear", scopeKey: "" });
    setSelectedFragment(null);
    setActiveView("frames");
    setStatus("Deleted Frame");
    await refresh();
    return true;
  }

  async function handleTrashDrop(event: DragEvent<HTMLElement>) {
    if (!hasTrashPayload(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setTrashDropState("armed");
    try {
      setError(null);
      const frameId = event.dataTransfer.getData(FRAME_DRAG_MIME);
      const fragmentPayload = event.dataTransfer.getData(FRAGMENT_DRAG_MIME);
      const fallbackPayload = trashDragPayload.current;
      let changed = false;
      if (frameId) {
        changed = await moveFrameToTrash(frameId);
      } else if (fallbackPayload?.kind === "frame") {
        changed = await moveFrameToTrash(fallbackPayload.id);
      } else {
        const ids = fragmentPayload
          ? JSON.parse(fragmentPayload)
          : fallbackPayload?.kind === "fragments"
            ? fallbackPayload.ids
            : [];
        changed = await moveFragmentsToTrash(ids);
      }
      trashDragPayload.current = null;
      if (changed) {
        flashTrashSuccess();
      } else {
        setTrashDropState("idle");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Trash failed");
      setTrashDropState("idle");
    }
  }

  const frameCards = (
    <section className="frame-section">
      <div className="section-heading">
        <h2>Frames</h2>
        <span>{visibleFrames.length} total</span>
      </div>
      <div className="frame-card-grid">
        {visibleFrames.map((frame) => {
          const frameFragments = (
            frames.length > 0 ? fragments : demoFragments
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
              onDragEnd={handleDragEnd}
              onDragStart={(event) => handleFrameDragStart(frame, event)}
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
      activeView={activeView}
      trashDropState={trashDropState}
      onTrashDragEnter={armTrashDrop}
      onTrashDragLeave={handleTrashDragLeave}
      onTrashDragOver={armTrashDrop}
      onTrashDrop={(event) => void handleTrashDrop(event)}
      onViewChange={changeView}
    >
      <TopCommandBar
        query={query}
        onQueryChange={setQuery}
        onCreateFrame={() => setFrameModal({ mode: "create" })}
        onImport={() => void chooseImages()}
        onSortChange={setSortMode}
        onSourceFilterChange={setSourceFilter}
        onSelectAll={
          (activeView === "home" || activeView === "trash") &&
          selectedVisibleCount === 0 &&
          selectableFragmentIds.length > 0
            ? selectAllMatchingFragments
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
          <FrameChipBar
            counts={displayCounts}
            frames={displayFrames}
            selectedFrameId={selectedFrameId}
            onSelect={selectFrame}
          />
        ) : null}

        {activeView === "home" ? (
          <SelectionToolbar
            allMatching={
              selection.mode === "all-matching" &&
              selection.scopeKey === selectionScopeKey
            }
            context="vault"
            count={selectedVisibleCount}
            totalCount={selectableFragmentIds.length}
            onClear={deselectAllFragments}
            onDelete={() => void removeSelectedFragments()}
            onSelectAll={selectAllMatchingFragments}
          />
        ) : null}

        {error ? <div className="error-banner">{error}</div> : null}

        {pendingImports.length > 0 ? (
          <div className="import-status" aria-live="polite">
            <span />
            <strong>
              Importing {pendingImports.length}{" "}
              {pendingImports.length === 1 ? "Fragment" : "Fragments"}
            </strong>
            <small>You can keep using Fragment while this finishes.</small>
          </div>
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
                    : `Fragments stay here for ${deletePolicy} days`}
                </span>
              </div>
            </div>
            <SelectionToolbar
              allMatching={
                selection.mode === "all-matching" &&
                selection.scopeKey === selectionScopeKey
              }
              context="trash"
              count={selectedVisibleCount}
              totalCount={selectableFragmentIds.length}
              onClear={deselectAllFragments}
              onRestore={() => void restoreSelectedFragments()}
              onSelectAll={selectAllMatchingFragments}
            />
            {visibleTrashedFragments.length === 0 ? (
              <EmptyState
                actionLabel="Back to Vault"
                title={
                  query.trim() ? "No matching Trash items" : "Trash is empty"
                }
                onAction={() => changeView("home")}
              />
            ) : (
              <div className="gallery-wrap trash-gallery">
                <MasonryGrid
                  assetSourcesFor={(fragment) =>
                    assetSourcesFor(fragment, "gallery")
                  }
                  draggable={false}
                  fragments={visibleTrashedFragments}
                  onAssetFallback={resolveAssetFallback}
                  selectionActive={selectedVisibleCount > 0}
                  selectedIds={selectedFragmentIdSet}
                  onSelect={handleFragmentCardSelect}
                />
              </div>
            )}
          </section>
        ) : activeView === "settings" ? (
          <section className="utility-panel utility-panel-wide settings-page">
            <p className="panel-kicker">Vault settings</p>
            <h1>Local library, native bridge, protected defaults.</h1>
            <div className="settings-grid">
              <article>
                <Plug size={19} />
                <span>Capture connection</span>
                <strong>{status}</strong>
              </article>
              <article>
                <ShieldCheck size={19} />
                <span>System Frame</span>
                <strong>Inbox cannot be renamed or deleted</strong>
              </article>
              <article className="settings-theme-card">
                <Trash2 size={19} />
                <span>Delete behavior</span>
                <strong>
                  {deletePolicy === "forever"
                    ? "Delete forever"
                    : `Trash for ${deletePolicy} days`}
                </strong>
                <div
                  className="theme-toggle"
                  aria-label="Delete behavior"
                  role="group"
                >
                  {(["forever", "7", "14", "24", "31"] as DeletePolicy[]).map(
                    (policy) => (
                      <button
                        aria-pressed={deletePolicy === policy}
                        className="theme-option"
                        data-active={deletePolicy === policy}
                        key={policy}
                        onClick={() => setDeletePolicy(policy)}
                        type="button"
                      >
                        {policy === "forever" ? "Forever" : `${policy}d`}
                      </button>
                    ),
                  )}
                </div>
              </article>
              <article className="settings-theme-card">
                <Sun size={19} />
                <span>Appearance</span>
                <strong>Window theme</strong>
                <div
                  className="theme-toggle"
                  aria-label="Appearance"
                  role="group"
                >
                  <button
                    aria-pressed={theme === "system"}
                    className="theme-option"
                    data-active={theme === "system"}
                    onClick={() => setTheme("system")}
                    type="button"
                  >
                    <Monitor aria-hidden="true" size={15} />
                    System
                  </button>
                  <button
                    aria-pressed={theme === "light"}
                    className="theme-option"
                    data-active={theme === "light"}
                    onClick={() => setTheme("light")}
                    type="button"
                  >
                    <Sun aria-hidden="true" size={15} />
                    Light
                  </button>
                  <button
                    aria-pressed={theme === "dark"}
                    className="theme-option"
                    data-active={theme === "dark"}
                    onClick={() => setTheme("dark")}
                    type="button"
                  >
                    <Moon aria-hidden="true" size={15} />
                    Dark
                  </button>
                </div>
              </article>
            </div>
          </section>
        ) : (
          <>
            <section className="fragment-section">
              {pendingImports.length > 0 ? (
                <div className="pending-import-grid" aria-live="polite">
                  {pendingImports.map((item) => (
                    <article className="pending-import-card" key={item.id}>
                      <div className="pending-import-preview" />
                      <span>{item.frameName}</span>
                      <strong>{item.name}</strong>
                      <small>Importing Fragment</small>
                    </article>
                  ))}
                </div>
              ) : null}
              {showEmptyState ? (
                <EmptyState
                  actionLabel={query.trim() ? "Clear Search" : "Import Images"}
                  title={emptyStateTitle()}
                  onAction={emptyStateAction}
                />
              ) : (
                <div className="gallery-wrap" data-demo={showDemoGallery}>
                  <MasonryGrid
                    assetSourcesFor={(fragment) =>
                      assetSourcesFor(fragment, "gallery")
                    }
                    fragments={galleryFragments}
                    onAssetFallback={resolveAssetFallback}
                    onDragEnd={handleDragEnd}
                    onDragStart={handleFragmentDragStart}
                    selectionActive={selectedVisibleCount > 0}
                    selectedIds={selectedFragmentIdSet}
                    onSelect={handleFragmentCardSelect}
                  />
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {trashUndo ? (
        <div aria-label="Trash action" className="undo-toast" role="region">
          <Trash2 aria-hidden="true" size={17} />
          <strong aria-live="polite">{trashUndo.label}</strong>
          <button
            className="button compact"
            onClick={() => void undoLastTrashMove()}
            type="button"
          >
            <Undo2 aria-hidden="true" size={15} />
            <span>Undo</span>
          </button>
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
          title={frameModal.mode === "rename" ? "Rename" : "New Frame"}
          onCancel={() => setFrameModal(null)}
          onSubmit={submitFrame}
        />
      ) : null}

      {selectedFragment ? (
        <FragmentDetailSheet
          assetSources={assetSourcesFor(selectedFragment, "detail")}
          transparentAsset={isTransparentAsset(selectedFragment)}
          fragment={selectedFragment}
          sharedReferenceCount={sharedReferenceCount(selectedFragment)}
          onAssetFallback={resolveAssetFallback}
          onClose={() => setSelectedFragment(null)}
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
