import type {
  ColorFilter,
  Fragment,
  Frame,
  PaletteIndexStatus,
} from "@fragment/shared";
import {
  Check,
  ChevronDown,
  Folder,
  ImageOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ColorFilterControl } from "../features/colors/ColorFilterControl";
import {
  createSelectionState,
  resolveSelectedIds,
  selectionReducer,
} from "../features/selection/selection-model";
import { readMotionDuration } from "../features/trash/motion";
import {
  deletionLabel,
  daysUntil,
  retentionSummary,
  type TrashRetention,
} from "../features/trash/retention";
import {
  canUndoRestore,
  previewRestoredFrameName,
  type EmptyTrashSummary,
  type RestoredFrameResult,
} from "../features/trash/trash-actions";
import {
  buildFragmentRows,
  buildFrameRows,
  fragmentRowKey,
  frameRowKey,
  pluralize,
  sortByDeletedAt,
  trashSelectionSummary,
  type TrashFragmentRow,
  type TrashFrameRow,
  type TrashSort,
} from "../features/trash/trash-model";
import {
  consumeTrashPulse,
  useTrashPulsePending,
} from "../features/trash/trash-session";
import { useExitingRows } from "../features/trash/useExitingRows";
import type { AssetSource } from "../lib/assets";
import { PaginationFooter } from "./PaginationFooter";
import { SelectionActionBar } from "./SelectionActionBar";

export type { TrashSort } from "../features/trash/trash-model";

type MaybePromise = void | Promise<void>;

export async function runRecoverableTrashAction(
  action: () => MaybePromise,
  onError: (error: unknown) => MaybePromise,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (caught) {
    try {
      await onError(caught);
    } catch {
      // Recovery reporting must never create a second unhandled rejection.
    }
    return false;
  }
}

/** Feedback the page asks the shell to show; Undo is offered when reversible. */
export type TrashToast = {
  label: string;
  tone: "restore" | "delete" | "neutral";
  undo?: {
    run: () => Promise<void>;
    doneLabel: string;
  };
};

type TrashDialog =
  | { kind: "restore"; fragmentIds: string[]; frames: Frame[] }
  | { kind: "delete-now"; fragmentIds: string[]; frames: Frame[] }
  | { kind: "empty" };

export type TrashPageProps = {
  color?: ColorFilter | null;
  paletteIndex?: PaletteIndexStatus | null;
  colorResultsChanged?: boolean;
  onColorChange?: (color: ColorFilter | null) => void;
  onRefreshColors?: () => void;

  /** Trashed Fragments loaded so far, in the server's deleted-date order. */
  fragments: Fragment[];
  /** Trashed Frames (roots of trashed trees). */
  frames: Frame[];
  /** Active Frames, used to predict restore name conflicts. */
  activeFrames?: readonly Frame[];
  /** Server-side total of trashed Fragments. */
  fragmentTotal: number;
  hasMore?: boolean;
  loading: boolean;
  loaded?: boolean;
  retention: TrashRetention;

  assetSourcesFor: (fragment: Fragment) => AssetSource[];
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  frameNameFor: (frameId: string) => string;

  /** Fragment sort is server-side; Frames sort locally. */
  sort?: TrashSort;
  onSortChange?: (sort: TrashSort) => void;
  onLoadMore?: () => void;

  /** Fragment selection shared with the gallery (marquee, ⌘A, Esc). */
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (fragment: Fragment) => void;
  onSelectAll?: () => MaybePromise;
  onClearSelection?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onOpen?: (fragment: Fragment) => void;
  /** Every trashed Fragment id matching the current filters, for Restore all. */
  onListAllFragmentIds?: () => Promise<string[]>;

  onRestoreFragments: (ids: string[]) => Promise<void>;
  onRestoreFrame: (frame: Frame) => Promise<RestoredFrameResult>;
  onDeleteFragmentsNow: (ids: string[]) => Promise<void>;
  onDeleteFrameNow: (frame: Frame) => Promise<void>;
  onEmptyTrash: () => Promise<EmptyTrashSummary | void>;
  /** Undo of a restore: the rows go back to Trash. */
  onTrashFragments?: (ids: string[]) => Promise<void>;
  onTrashFrame?: (frame: Frame) => Promise<void>;
  onNotify: (toast: TrashToast) => void;
  onActionError?: (error: unknown) => MaybePromise;
};

const FRAME_SELECTION_SCOPE = "trash-frames";
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const MAX_ANIMATED_ROWS = 200;
const PULSE_FALLBACK_MS = 1_400;

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export function TrashPage({
  color,
  paletteIndex,
  colorResultsChanged,
  onColorChange,
  onRefreshColors,
  fragments,
  frames,
  activeFrames = [],
  fragmentTotal,
  hasMore = false,
  loading,
  loaded = true,
  retention,
  assetSourcesFor,
  onAssetFallback,
  frameNameFor,
  sort: controlledSort,
  onSortChange,
  onLoadMore,
  selectedIds = EMPTY_SELECTION,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onPointerDown,
  onOpen,
  onListAllFragmentIds,
  onRestoreFragments,
  onRestoreFrame,
  onDeleteFragmentsNow,
  onDeleteFrameNow,
  onEmptyTrash,
  onTrashFragments,
  onTrashFrame,
  onNotify,
  onActionError,
}: TrashPageProps) {
  const [localFragmentSort, setLocalFragmentSort] =
    useState<TrashSort>("newest");
  const fragmentSort = controlledSort ?? localFragmentSort;
  const [frameSort, setFrameSort] = useState<TrashSort>("newest");
  const [frameSelection, dispatchFrameSelection] = useReducer(
    selectionReducer,
    FRAME_SELECTION_SCOPE,
    createSelectionState,
  );
  const [dialog, setDialog] = useState<TrashDialog | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [exitDuration, setExitDuration] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  const pulsePending = useTrashPulsePending();
  const dialogRef = useRef<TrashDialog | null>(null);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  useEffect(() => {
    setExitDuration(readMotionDuration("--dur-base", 200));
  }, []);

  const fragmentRows = useMemo(
    () => sortByDeletedAt(buildFragmentRows(fragments), fragmentSort),
    [fragmentSort, fragments],
  );
  const frameRows = useMemo(
    () => buildFrameRows(frames, frameSort, retention),
    [frameSort, frames, retention],
  );
  const frameIds = useMemo(() => frameRows.map((row) => row.id), [frameRows]);
  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );

  useEffect(() => {
    dispatchFrameSelection({
      type: "reconcile",
      scopeKey: FRAME_SELECTION_SCOPE,
      matchingIds: frameIds,
    });
  }, [frameIds]);

  const selectedFrameIds = useMemo(
    () => resolveSelectedIds(frameSelection, FRAME_SELECTION_SCOPE, frameIds),
    [frameIds, frameSelection],
  );
  const selectedFrameIdSet = useMemo(
    () => new Set(selectedFrameIds),
    [selectedFrameIds],
  );
  const selectedFrames = useMemo(
    () =>
      selectedFrameIds
        .map((id) => frameById.get(id))
        .filter((frame): frame is Frame => Boolean(frame)),
    [frameById, selectedFrameIds],
  );
  const selectedFragmentIds = useMemo(
    () => Array.from(selectedIds),
    [selectedIds],
  );

  const fragmentExit = useExitingRows(fragmentRows, {
    durationMs: exitDuration,
  });
  const frameExit = useExitingRows(frameRows, { durationMs: exitDuration });

  const fragmentCount = Math.max(fragmentTotal, fragmentRows.length);
  const frameCount = frameRows.length;
  const totalCount = fragmentCount + frameCount;
  const allFragmentsLoaded = fragmentRows.length >= fragmentCount;
  const selectedCount = selectedFragmentIds.length + selectedFrameIds.length;
  // Rows that are still collapsing keep their section mounted so the exit
  // motion can finish before the empty state takes over.
  const hasTransientFragments = fragmentExit.renderedRows.length > 0;
  const hasTransientFrames = frameExit.renderedRows.length > 0;
  const showInitialLoading = loading && !loaded && totalCount === 0;
  const showEmpty =
    !loading &&
    loaded &&
    totalCount === 0 &&
    !hasTransientFragments &&
    !hasTransientFrames;

  useEffect(() => {
    if (!pulsePending || totalCount === 0 || pulsing) return;
    const frame = window.requestAnimationFrame(() => setPulsing(true));
    return () => window.cancelAnimationFrame(frame);
  }, [pulsePending, pulsing, totalCount]);

  const finishPulse = useCallback(() => {
    setPulsing(false);
    consumeTrashPulse();
  }, []);

  useEffect(() => {
    if (!pulsing) return;
    const timer = window.setTimeout(finishPulse, PULSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [finishPulse, pulsing]);

  const clearSelections = useCallback(() => {
    onClearSelection?.();
    dispatchFrameSelection({ type: "clear", scopeKey: FRAME_SELECTION_SCOPE });
  }, [onClearSelection]);

  function openDialog(next: TrashDialog) {
    setDialogError(null);
    setDialog(next);
  }

  function closeDialog() {
    if (dialogPending) return;
    setDialog(null);
    setDialogError(null);
  }

  const openDeleteNow = useCallback(
    (fragmentIds: string[], frameList: Frame[]) => {
      if (fragmentIds.length + frameList.length === 0) return;
      setDialogError(null);
      setDialog({ kind: "delete-now", fragmentIds, frames: frameList });
    },
    [],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (dialogRef.current || isEditableTarget(event.target)) return;
      if (event.key === "Escape") {
        if (selectedFrameIds.length > 0) {
          dispatchFrameSelection({
            type: "clear",
            scopeKey: FRAME_SELECTION_SCOPE,
          });
        }
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        selectedFragmentIds.length + selectedFrameIds.length > 0
      ) {
        event.preventDefault();
        openDeleteNow(selectedFragmentIds, selectedFrames);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openDeleteNow, selectedFragmentIds, selectedFrameIds, selectedFrames]);

  async function restoreAllFragments() {
    const ids =
      allFragmentsLoaded || !onListAllFragmentIds
        ? fragmentRows.map((row) => row.id)
        : await onListAllFragmentIds();
    if (ids.length === 0) return;
    openDialog({ kind: "restore", fragmentIds: ids, frames: [] });
  }

  async function runRestore(fragmentIds: string[], frameList: Frame[]) {
    const fragmentKeys = fragmentIds.map(fragmentRowKey);
    const frameKeys = frameList.map((frame) => frameRowKey(frame.id));
    const animate = fragmentKeys.length + frameKeys.length <= MAX_ANIMATED_ROWS;
    fragmentExit.holdRows(fragmentKeys);
    frameExit.holdRows(frameKeys);

    const results: RestoredFrameResult[] = [];
    const releasedFrameKeys = new Set<string>();
    let fragmentsDone = fragmentIds.length === 0;
    try {
      if (fragmentIds.length > 0) {
        await onRestoreFragments(fragmentIds);
        fragmentsDone = true;
        fragmentExit.releaseRows(fragmentKeys, animate);
      }
      for (const frame of frameList) {
        results.push(await onRestoreFrame(frame));
        const key = frameRowKey(frame.id);
        releasedFrameKeys.add(key);
        frameExit.releaseRows([key], animate);
      }
    } catch (caught) {
      if (!fragmentsDone) fragmentExit.releaseRows(fragmentKeys, false);
      frameExit.releaseRows(
        frameKeys.filter((key) => !releasedFrameKeys.has(key)),
        false,
      );
      throw caught;
    }

    const summary = trashSelectionSummary(fragmentIds.length, frameList.length);
    const renamed = results.filter((result) => result.renamedFrom);
    let label = `Restored ${summary}`;
    if (renamed.length === 1 && results.length === 1 && fragmentIds.length === 0) {
      label = `Restored “${renamed[0].renamedFrom}” as “${renamed[0].frame.name}”`;
    } else if (renamed.length > 0) {
      label += ` · ${renamed
        .map((result) => `${result.renamedFrom} is now ${result.frame.name}`)
        .join(", ")}`;
    }

    const undoable =
      canUndoRestore(retention) &&
      (fragmentIds.length === 0 || Boolean(onTrashFragments)) &&
      (results.length === 0 || Boolean(onTrashFrame));
    onNotify({
      label,
      tone: "restore",
      undo: undoable
        ? {
            doneLabel: `Moved ${summary} back to Trash`,
            run: async () => {
              if (fragmentIds.length > 0) await onTrashFragments?.(fragmentIds);
              for (const result of results) await onTrashFrame?.(result.frame);
            },
          }
        : undefined,
    });
    clearSelections();
  }

  async function runDeleteNow(fragmentIds: string[], frameList: Frame[]) {
    const fragmentKeys = fragmentIds.map(fragmentRowKey);
    const frameKeys = frameList.map((frame) => frameRowKey(frame.id));
    const animate = fragmentKeys.length + frameKeys.length <= MAX_ANIMATED_ROWS;
    fragmentExit.holdRows(fragmentKeys);
    frameExit.holdRows(frameKeys);

    const releasedFrameKeys = new Set<string>();
    let fragmentsDone = fragmentIds.length === 0;
    try {
      if (fragmentIds.length > 0) {
        await onDeleteFragmentsNow(fragmentIds);
        fragmentsDone = true;
        fragmentExit.releaseRows(fragmentKeys, animate);
      }
      for (const frame of frameList) {
        await onDeleteFrameNow(frame);
        const key = frameRowKey(frame.id);
        releasedFrameKeys.add(key);
        frameExit.releaseRows([key], animate);
      }
    } catch (caught) {
      if (!fragmentsDone) fragmentExit.releaseRows(fragmentKeys, false);
      frameExit.releaseRows(
        frameKeys.filter((key) => !releasedFrameKeys.has(key)),
        false,
      );
      throw caught;
    }

    onNotify({
      label: `Deleted ${trashSelectionSummary(fragmentIds.length, frameList.length)} forever`,
      tone: "delete",
    });
    clearSelections();
  }

  async function runEmpty() {
    const fragmentKeys = fragmentRows.map((row) => row.key);
    const frameKeys = frameRows.map((row) => row.key);
    const animate = fragmentKeys.length + frameKeys.length <= MAX_ANIMATED_ROWS;
    fragmentExit.holdRows(fragmentKeys);
    frameExit.holdRows(frameKeys);
    let summary: EmptyTrashSummary | void;
    try {
      summary = await onEmptyTrash();
    } catch (caught) {
      fragmentExit.releaseRows(fragmentKeys, false);
      frameExit.releaseRows(frameKeys, false);
      throw caught;
    }
    fragmentExit.releaseRows(fragmentKeys, animate);
    frameExit.releaseRows(frameKeys, animate);
    const removed = summary
      ? trashSelectionSummary(summary.fragments, summary.frames)
      : trashSelectionSummary(fragmentCount, frameCount);
    onNotify({
      label:
        removed === "nothing"
          ? "Trash emptied"
          : `Trash emptied · ${removed} removed`,
      tone: "delete",
    });
    clearSelections();
  }

  async function confirmDialog() {
    if (!dialog || dialogPending) return;
    setDialogPending(true);
    setDialogError(null);
    try {
      if (dialog.kind === "restore") {
        await runRestore(dialog.fragmentIds, dialog.frames);
      } else if (dialog.kind === "delete-now") {
        await runDeleteNow(dialog.fragmentIds, dialog.frames);
      } else {
        await runEmpty();
      }
      setDialog(null);
    } catch (caught) {
      setDialogError(errorMessage(caught));
      try {
        await onActionError?.(caught);
      } catch {
        // Reporting must not mask the original failure shown in the dialog.
      }
    } finally {
      setDialogPending(false);
    }
  }

  function chooseFragmentSort(nextSort: TrashSort) {
    if (controlledSort === undefined) setLocalFragmentSort(nextSort);
    onSortChange?.(nextSort);
  }

  function toggleFrame(frame: Frame) {
    dispatchFrameSelection({
      type: "toggle",
      scopeKey: FRAME_SELECTION_SCOPE,
      matchingIds: frameIds,
      id: frame.id,
    });
  }

  function toggleAllFrames() {
    if (selectedFrameIds.length === frameIds.length && frameIds.length > 0) {
      dispatchFrameSelection({ type: "clear", scopeKey: FRAME_SELECTION_SCOPE });
      return;
    }
    dispatchFrameSelection({
      type: "select-all",
      scopeKey: FRAME_SELECTION_SCOPE,
      matchingIds: frameIds,
    });
  }

  function toggleAllFragments() {
    if (selectedFragmentIds.length > 0 && selectedFragmentIds.length >= fragmentCount) {
      onClearSelection?.();
      return;
    }
    void onSelectAll?.();
  }

  const subtitle = [
    pluralize(fragmentCount, "Fragment"),
    pluralize(frameCount, "Frame"),
    retentionSummary(retention),
  ].join(" · ");

  return (
    <section className="v7-trash-page" aria-labelledby="v7-trash-title">
      <header className="v7-trash-pagebar">
        <div className="v7-trash-title-stack">
          <h1 id="v7-trash-title">Trash</h1>
          <p>{subtitle}</p>
        </div>
        <div className="v7-trash-page-actions">
          {onColorChange ? (
            <ColorFilterControl value={color} onChange={onColorChange} />
          ) : null}
          <button
            className="v7-trash-empty-button"
            data-pulse={pulsing}
            disabled={totalCount === 0 || dialogPending}
            onAnimationEnd={finishPulse}
            onClick={() => openDialog({ kind: "empty" })}
            type="button"
          >
            Empty Trash
          </button>
        </div>
      </header>

      <div
        className="v7-trash-content"
        data-frame-canvas="true"
        onPointerDown={onPointerDown}
      >
        {onColorChange && color && (paletteIndex?.pending || colorResultsChanged) ? (
          <div className="fragment-index-status" data-canvas-control>
            {paletteIndex?.pending ? (
              <span>
                Colors are still being extracted · {paletteIndex.pending}{" "}
                remaining
              </span>
            ) : null}
            {colorResultsChanged ? (
              <>
                <span>More color results available</span>
                <button type="button" onClick={onRefreshColors}>
                  Refresh
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {showInitialLoading ? (
          <div className="v7-trash-state" aria-live="polite">
            <span className="v7-trash-spinner" />
            <strong>Loading Trash</strong>
            <small>Your active library remains available.</small>
          </div>
        ) : showEmpty ? (
          <div className="v7-trash-state" role="status">
            <Trash2 aria-hidden="true" size={24} strokeWidth={1.5} />
            <strong>Trash is empty</strong>
            <small>Deleted Frames and Fragments will appear here.</small>
          </div>
        ) : (
          <>
            <TrashSection
              count={frameCount}
              countLabel={pluralize(frameCount, "Frame")}
              emptyMessage={
                color
                  ? "Frames are hidden while a color filter is active."
                  : "No Frames in Trash."
              }
              hasRows={hasTransientFrames}
              onDeleteSelected={() => openDeleteNow([], selectedFrames)}
              onRestoreAll={() =>
                openDialog({ kind: "restore", fragmentIds: [], frames })
              }
              onRestoreSelected={() =>
                openDialog({
                  kind: "restore",
                  fragmentIds: [],
                  frames: selectedFrames,
                })
              }
              onSortChange={setFrameSort}
              onToggleAll={toggleAllFrames}
              selectedCount={selectedFrameIds.length}
              sort={frameSort}
              title="Frames"
            >
              <div
                aria-label="Deleted Frames"
                className="v7-trash-list"
                role="table"
              >
                {frameExit.renderedRows.map(({ row, pending, exiting }) => (
                  <FrameRow
                    exiting={exiting}
                    frameNameFor={frameNameFor}
                    key={row.key}
                    pending={pending}
                    row={row}
                    selected={selectedFrameIdSet.has(row.id)}
                    onDeleteNow={() => openDeleteNow([], [row.frame])}
                    onRestore={() =>
                      openDialog({
                        kind: "restore",
                        fragmentIds: [],
                        frames: [row.frame],
                      })
                    }
                    onToggle={() => toggleFrame(row.frame)}
                  />
                ))}
              </div>
            </TrashSection>

            <TrashSection
              count={fragmentCount}
              countLabel={
                allFragmentsLoaded
                  ? pluralize(fragmentCount, "Fragment")
                  : `${fragmentRows.length.toLocaleString()} of ${pluralize(fragmentCount, "Fragment")} loaded`
              }
              emptyMessage={
                color ? "No Fragments match this color." : "No Fragments in Trash."
              }
              hasRows={hasTransientFragments}
              onDeleteSelected={() => openDeleteNow(selectedFragmentIds, [])}
              onRestoreAll={() => void restoreAllFragments()}
              onRestoreSelected={() =>
                openDialog({
                  kind: "restore",
                  fragmentIds: selectedFragmentIds,
                  frames: [],
                })
              }
              onSortChange={chooseFragmentSort}
              onToggleAll={toggleAllFragments}
              selectedCount={selectedFragmentIds.length}
              sort={fragmentSort}
              title="Fragments"
            >
              <div
                aria-label="Deleted Fragments"
                className="v7-trash-list"
                role="table"
              >
                {fragmentExit.renderedRows.map(({ row, pending, exiting }) => (
                  <FragmentRow
                    assetSources={assetSourcesFor(row.fragment)}
                    exiting={exiting}
                    frameNameFor={frameNameFor}
                    key={row.key}
                    pending={pending}
                    row={row}
                    selected={selectedIds.has(row.id)}
                    onAssetFallback={onAssetFallback}
                    onDeleteNow={() => openDeleteNow([row.id], [])}
                    onOpen={onOpen ? () => onOpen(row.fragment) : undefined}
                    onRestore={() =>
                      openDialog({
                        kind: "restore",
                        fragmentIds: [row.id],
                        frames: [],
                      })
                    }
                    onToggle={
                      onToggleSelect
                        ? () => onToggleSelect(row.fragment)
                        : undefined
                    }
                  />
                ))}
              </div>
              <PaginationFooter
                hasMore={hasMore}
                loadedCount={fragmentRows.length}
                loading={loading}
                noun="Fragments"
                onLoadMore={onLoadMore}
                totalCount={fragmentCount}
              />
            </TrashSection>
          </>
        )}
      </div>

      {selectedCount > 0 ? (
        <SelectionActionBar
          count={selectedCount}
          countLabel={`${trashSelectionSummary(selectedFragmentIds.length, selectedFrameIds.length)} selected`}
          scope="trash"
          onClear={clearSelections}
          onDeleteNow={() => openDeleteNow(selectedFragmentIds, selectedFrames)}
          onRestore={() =>
            openDialog({
              kind: "restore",
              fragmentIds: selectedFragmentIds,
              frames: selectedFrames,
            })
          }
        />
      ) : null}

      {dialog ? (
        <TrashConfirmDialog
          activeFrames={activeFrames}
          dialog={dialog}
          error={dialogError}
          fragmentById={fragmentByIdFrom(fragments)}
          frameNameFor={frameNameFor}
          loadedCounts={{ fragments: fragmentCount, frames: frameCount }}
          pending={dialogPending}
          retention={retention}
          onCancel={closeDialog}
          onConfirm={() => void confirmDialog()}
        />
      ) : null}
    </section>
  );
}

function fragmentByIdFrom(fragments: readonly Fragment[]) {
  return new Map(fragments.map((fragment) => [fragment.id, fragment]));
}

type TrashSectionProps = {
  children: ReactNode;
  count: number;
  countLabel: string;
  emptyMessage: string;
  /** True while rows are still rendered (for example collapsing out). */
  hasRows: boolean;
  selectedCount: number;
  sort: TrashSort;
  title: "Frames" | "Fragments";
  onDeleteSelected: () => void;
  onRestoreAll: () => void;
  onRestoreSelected: () => void;
  onSortChange: (sort: TrashSort) => void;
  onToggleAll: () => void;
};

function TrashSection({
  children,
  count,
  countLabel,
  emptyMessage,
  hasRows,
  selectedCount,
  sort,
  title,
  onDeleteSelected,
  onRestoreAll,
  onRestoreSelected,
  onSortChange,
  onToggleAll,
}: TrashSectionProps) {
  const sortMenu = useRef<HTMLDetailsElement>(null);
  const allSelected = count > 0 && selectedCount >= count;
  const headingId = `v7-trash-section-${title.toLowerCase()}`;

  function chooseSort(nextSort: TrashSort) {
    onSortChange(nextSort);
    if (sortMenu.current) sortMenu.current.open = false;
  }

  return (
    <section
      aria-labelledby={headingId}
      className="v7-trash-section"
      data-section={title.toLowerCase()}
    >
      <header className="v7-trash-section-head" data-canvas-control>
        <button
          aria-checked={allSelected ? true : selectedCount > 0 ? "mixed" : false}
          aria-label={`Select all ${title}`}
          className="v7-trash-check"
          data-state={allSelected ? "all" : selectedCount > 0 ? "some" : "none"}
          disabled={count === 0}
          onClick={onToggleAll}
          role="checkbox"
          type="button"
        >
          <Check aria-hidden="true" size={12} strokeWidth={3} />
        </button>
        <div className="v7-trash-section-title">
          <h2 id={headingId}>{title}</h2>
          <span className="v7-trash-section-count">
            {selectedCount > 0
              ? `${selectedCount.toLocaleString()} of ${countLabel} selected`
              : countLabel}
          </span>
        </div>
        <div className="v7-trash-section-actions">
          <details className="v7-trash-sort" ref={sortMenu}>
            <summary aria-label={`Sort ${title} by deleted date`}>
              <span>{sort === "newest" ? "Newest first" : "Oldest first"}</span>
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.7} />
            </summary>
            <div className="v7-trash-sort-menu" role="menu">
              <button
                aria-checked={sort === "newest"}
                onClick={() => chooseSort("newest")}
                role="menuitemradio"
                type="button"
              >
                <span>Deleted newest first</span>
                {sort === "newest" ? <Check aria-hidden="true" size={14} /> : null}
              </button>
              <button
                aria-checked={sort === "oldest"}
                onClick={() => chooseSort("oldest")}
                role="menuitemradio"
                type="button"
              >
                <span>Deleted oldest first</span>
                {sort === "oldest" ? <Check aria-hidden="true" size={14} /> : null}
              </button>
            </div>
          </details>
          {selectedCount > 0 ? (
            <>
              <button
                className="v7-trash-section-restore"
                onClick={onRestoreSelected}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>Restore {selectedCount.toLocaleString()}</span>
              </button>
              <button
                className="v7-trash-section-delete"
                onClick={onDeleteSelected}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>Delete {selectedCount.toLocaleString()} now</span>
              </button>
            </>
          ) : (
            <button
              className="v7-trash-section-restore"
              disabled={count === 0}
              onClick={onRestoreAll}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>Restore all</span>
            </button>
          )}
        </div>
      </header>
      {count === 0 && !hasRows ? (
        <p className="v7-trash-section-empty">{emptyMessage}</p>
      ) : (
        children
      )}
    </section>
  );
}

type RowShellProps = {
  children: ReactNode;
  exiting: boolean;
  kind: "frame" | "fragment";
  name: string;
  pending: boolean;
  rowId: string;
  selected: boolean;
  onToggle?: () => void;
};

function RowShell({
  children,
  exiting,
  kind,
  name,
  pending,
  rowId,
  selected,
  onToggle,
}: RowShellProps) {
  return (
    <div
      aria-busy={pending || undefined}
      aria-label={name}
      aria-selected={selected}
      className="v7-trash-row v7-trash-item-row"
      data-canvas-control={kind === "frame" ? "" : undefined}
      data-exiting={exiting}
      data-fragment-id={kind === "fragment" ? rowId : undefined}
      data-marquee-item={kind === "fragment" ? "" : undefined}
      data-pending={pending}
      data-selected={selected}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (event.shiftKey && onToggle) {
          event.preventDefault();
          onToggle();
        }
      }}
      role="row"
    >
      <div className="v7-trash-cell v7-trash-select-cell" role="cell">
        <button
          aria-checked={selected}
          aria-label={`${selected ? "Deselect" : "Select"} ${name}`}
          className="v7-trash-check"
          data-state={selected ? "all" : "none"}
          disabled={!onToggle || pending}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
          role="checkbox"
          type="button"
        >
          <Check aria-hidden="true" size={12} strokeWidth={3} />
        </button>
      </div>
      {children}
    </div>
  );
}

type RetentionCellProps = {
  deleteAfter: string | null;
  estimated?: boolean;
};

function RetentionCell({ deleteAfter, estimated }: RetentionCellProps) {
  const days = deleteAfter ? daysUntil(deleteAfter) : null;
  return (
    <span
      className="v7-trash-retention"
      data-urgent={days !== null && days <= 1}
      role="cell"
      title={
        estimated
          ? "Estimated from the current retention setting"
          : deleteAfter
            ? `Removed on ${formatFullDate(deleteAfter)}`
            : undefined
      }
    >
      {deletionLabel(deleteAfter)}
    </span>
  );
}

type FrameRowProps = {
  exiting: boolean;
  frameNameFor: (frameId: string) => string;
  pending: boolean;
  row: TrashFrameRow;
  selected: boolean;
  onDeleteNow: () => void;
  onRestore: () => void;
  onToggle: () => void;
};

function FrameRow({
  exiting,
  frameNameFor,
  pending,
  row,
  selected,
  onDeleteNow,
  onRestore,
  onToggle,
}: FrameRowProps) {
  const from = row.frame.parentId
    ? frameNameFor(row.frame.parentId)
    : "Your Vault";
  return (
    <RowShell
      exiting={exiting}
      kind="frame"
      name={row.name}
      pending={pending}
      rowId={row.id}
      selected={selected}
      onToggle={onToggle}
    >
      <div className="v7-trash-cell v7-trash-thumbnail-cell" role="cell">
        <span className="v7-trash-frame-thumbnail" aria-hidden="true">
          <Folder size={22} strokeWidth={1.6} />
        </span>
      </div>
      <div className="v7-trash-cell v7-trash-name-cell" role="cell">
        <strong className="v7-trash-name" title={row.name}>
          {row.name}
        </strong>
        <span className="v7-trash-from" title={from}>
          Frame · from {from}
        </span>
      </div>
      <time className="v7-trash-deleted" dateTime={row.deletedAt} role="cell">
        {formatDeletedDate(row.deletedAt)}
      </time>
      <RetentionCell deleteAfter={row.deleteAfter} estimated />
      <RowActions
        name={row.name}
        pending={pending}
        onDeleteNow={onDeleteNow}
        onRestore={onRestore}
      />
    </RowShell>
  );
}

type FragmentRowProps = {
  assetSources: AssetSource[];
  exiting: boolean;
  frameNameFor: (frameId: string) => string;
  pending: boolean;
  row: TrashFragmentRow;
  selected: boolean;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onDeleteNow: () => void;
  onOpen?: () => void;
  onRestore: () => void;
  onToggle?: () => void;
};

function FragmentRow({
  assetSources,
  exiting,
  frameNameFor,
  pending,
  row,
  selected,
  onAssetFallback,
  onDeleteNow,
  onOpen,
  onRestore,
  onToggle,
}: FragmentRowProps) {
  const from = frameNameFor(row.fragment.frameId);
  return (
    <RowShell
      exiting={exiting}
      kind="fragment"
      name={row.name}
      pending={pending}
      rowId={row.id}
      selected={selected}
      onToggle={onToggle}
    >
      <div className="v7-trash-cell v7-trash-thumbnail-cell" role="cell">
        <TrashThumbnail
          alt={row.name}
          onAssetFallback={onAssetFallback}
          sources={assetSources}
        />
      </div>
      <div className="v7-trash-cell v7-trash-name-cell" role="cell">
        {onOpen ? (
          <button
            className="v7-trash-name v7-trash-name-button"
            disabled={pending}
            onClick={(event) => {
              if (event.shiftKey) return;
              event.stopPropagation();
              onOpen();
            }}
            title={`${row.name}. Click to preview; Shift-click to ${selected ? "deselect" : "select"}.`}
            type="button"
          >
            {row.name}
          </button>
        ) : (
          <strong className="v7-trash-name" title={row.name}>
            {row.name}
          </strong>
        )}
        <span className="v7-trash-from" title={from}>
          Fragment · from {from}
        </span>
      </div>
      <time className="v7-trash-deleted" dateTime={row.deletedAt} role="cell">
        {formatDeletedDate(row.deletedAt)}
      </time>
      <RetentionCell deleteAfter={row.deleteAfter} />
      <RowActions
        name={row.name}
        pending={pending}
        onDeleteNow={onDeleteNow}
        onRestore={onRestore}
      />
    </RowShell>
  );
}

function RowActions({
  name,
  pending,
  onDeleteNow,
  onRestore,
}: {
  name: string;
  pending: boolean;
  onDeleteNow: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="v7-trash-cell v7-trash-action-cell" role="cell">
      <button
        aria-label={`Restore ${name}`}
        className="v7-trash-restore"
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          onRestore();
        }}
        type="button"
      >
        <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>Restore</span>
      </button>
      <button
        aria-label={`Delete ${name} now`}
        className="v7-trash-delete-now"
        disabled={pending}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteNow();
        }}
        title="Delete now"
        type="button"
      >
        <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

type TrashConfirmDialogProps = {
  activeFrames: readonly Frame[];
  dialog: TrashDialog;
  error: string | null;
  fragmentById: Map<string, Fragment>;
  frameNameFor: (frameId: string) => string;
  loadedCounts: { fragments: number; frames: number };
  pending: boolean;
  retention: TrashRetention;
  onCancel: () => void;
  onConfirm: () => void;
};

function TrashConfirmDialog({
  activeFrames,
  dialog,
  error,
  fragmentById,
  frameNameFor,
  loadedCounts,
  pending,
  retention,
  onCancel,
  onConfirm,
}: TrashConfirmDialogProps) {
  if (dialog.kind === "empty") {
    const summary = trashSelectionSummary(
      loadedCounts.fragments,
      loadedCounts.frames,
    );
    return (
      <ConfirmDialog
        confirmLabel="Empty Trash"
        description={`Permanently delete ${summary}, including anything not loaded yet, and the image files no active Fragment uses. This cannot be undone.`}
        destructive
        error={error}
        pending={pending}
        pendingLabel="Emptying…"
        title="Empty Trash?"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }

  const fragmentCount = dialog.fragmentIds.length;
  const frameCount = dialog.frames.length;
  const summary = trashSelectionSummary(fragmentCount, frameCount);
  const singleFragment =
    fragmentCount === 1 && frameCount === 0
      ? fragmentById.get(dialog.fragmentIds[0])
      : undefined;
  const singleFrame =
    frameCount === 1 && fragmentCount === 0 ? dialog.frames[0] : undefined;
  const subject = singleFragment
    ? `“${singleFragment.title?.trim() || "Untitled Fragment"}”`
    : singleFrame
      ? `“${singleFrame.name}”`
      : summary;

  if (dialog.kind === "delete-now") {
    const consequence = [
      `This permanently removes ${subject}`,
      frameCount > 0
        ? ", including nested Frames and every Fragment inside, "
        : " ",
      "and the image files no other Fragment uses. This cannot be undone.",
    ].join("");
    return (
      <ConfirmDialog
        confirmLabel="Delete now"
        description={consequence}
        destructive
        error={error}
        pending={pending}
        pendingLabel="Deleting…"
        title={`Delete ${summary} now?`}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }

  const destination = singleFragment
    ? `“${frameNameFor(singleFragment.frameId)}”`
    : singleFrame
      ? singleFrame.parentId
        ? `“${frameNameFor(singleFrame.parentId)}”`
        : "your Vault"
      : frameCount > 0 && fragmentCount > 0
        ? "their Frames and your Vault"
        : frameCount > 0
          ? "your Vault"
          : "their Frames";
  const conflicts = dialog.frames
    .map((frame) => ({
      frame,
      resolved: previewRestoredFrameName(frame, activeFrames),
    }))
    .filter(
      (entry): entry is { frame: Frame; resolved: string } =>
        entry.resolved !== null,
    );
  const undoHint =
    retention.kind === "days"
      ? " You can undo this from the confirmation for a few seconds."
      : " Retention is off, so this cannot be undone from the toast.";

  return (
    <ConfirmDialog
      confirmLabel={fragmentCount + frameCount > 1 ? `Restore ${(fragmentCount + frameCount).toLocaleString()}` : "Restore"}
      description={`${subject} will leave the Trash and return to ${destination}${frameCount > 0 ? ", together with any nested Frames" : ""}.${undoHint}`}
      detail={
        conflicts.length > 0 ? (
          <ul className="v7-trash-conflicts">
            {conflicts.map(({ frame, resolved }) => (
              <li key={frame.id}>
                A Frame named “{frame.name}” already exists there. The restored
                Frame will be named <strong>“{resolved}”</strong>.
              </li>
            ))}
          </ul>
        ) : undefined
      }
      error={error}
      pending={pending}
      pendingLabel="Restoring…"
      title={`Restore ${summary}?`}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function TrashThumbnail({
  alt,
  onAssetFallback,
  sources,
}: {
  alt: string;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  sources: AssetSource[];
}) {
  const usableSources = sources.filter((source) => Boolean(source.url));
  const sourceKey = usableSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const [index, setIndex] = useState(0);
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(usableSources.length === 0);
  const source = usableSources[index];

  useEffect(() => {
    setIndex(0);
    setOverrideUrl(null);
    setFailed(usableSources.length === 0);
  }, [sourceKey, usableSources.length]);

  async function handleError() {
    if (source?.relativePath && onAssetFallback) {
      const fallback = await onAssetFallback(source.relativePath);
      if (fallback) {
        setOverrideUrl(fallback);
        return;
      }
    }
    if (index + 1 < usableSources.length) {
      setIndex((current) => current + 1);
      setOverrideUrl(null);
      return;
    }
    setFailed(true);
  }

  if (failed) {
    return (
      <span
        className="v7-trash-image-fallback"
        aria-label={`${alt} preview unavailable`}
      >
        <ImageOff aria-hidden="true" size={18} strokeWidth={1.5} />
      </span>
    );
  }

  return (
    <img
      alt={alt}
      className="v7-trash-thumbnail"
      decoding="async"
      draggable={false}
      loading="lazy"
      onError={() => void handleError()}
      src={overrideUrl ?? source?.url ?? ""}
    />
  );
}

function formatFullDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDeletedDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );

  if (dayDifference === 0) {
    return `Today, ${new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`;
  }
  if (dayDifference === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
