import type {
  ColorFilter,
  Fragment,
  Frame,
  PaletteIndexStatus,
} from "@fragment/shared";
import { ColorFilterControl } from "../features/colors/ColorFilterControl";
import { Check, ChevronDown, Folder, ImageOff, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../components/Modal";
import type { AssetSource } from "../lib/assets";
import type { GalleryCard } from "../store/library-selectors";
import type { TrashSort } from "../store/library-types";
import { PaginationFooter } from "./PaginationFooter";

export type { TrashSort } from "../store/library-types";

type TrashFilter = "all" | "fragments" | "frames";
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

type TrashedFragmentEntry = {
  key: string;
  kind: "fragment";
  record: Fragment;
  card: GalleryCard;
  deletedAt: string;
};

type TrashedFrameEntry = {
  key: string;
  kind: "frame";
  record: Frame;
  deletedAt: string;
};

type TrashEntry = TrashedFragmentEntry | TrashedFrameEntry;

export type TrashPageProps = {
  color?: ColorFilter | null;
  paletteIndex?: PaletteIndexStatus | null;
  colorResultsChanged?: boolean;
  onColorChange?: (color: ColorFilter | null) => void;
  onRefreshColors?: () => void;
  /** Trashed Fragments with their asset sources and Frame name precomputed. */
  items: GalleryCard[];
  frames: Frame[];
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  /** Name of a Frame by id, used for a trashed Frame's parent. */
  frameNameFor: (frameId: string) => string;
  hasMore?: boolean;
  loading: boolean;
  retentionLabel: string;
  sort?: TrashSort;
  total: number;
  onRestoreFragment: (fragment: Fragment) => MaybePromise;
  onRestoreFrame: (frame: Frame) => MaybePromise;
  onRestoreError?: (error: unknown) => MaybePromise;
  onEmptyTrash: () => MaybePromise;
  onLoadMore?: () => void;
  onSortChange?: (sort: TrashSort) => void;
};

export function TrashPage({
  color,
  paletteIndex,
  colorResultsChanged,
  onColorChange,
  onRefreshColors,
  items,
  frames,
  onAssetFallback,
  frameNameFor,
  hasMore = false,
  loading,
  retentionLabel,
  sort: controlledSort,
  total,
  onRestoreFragment,
  onRestoreFrame,
  onRestoreError,
  onEmptyTrash,
  onLoadMore,
  onSortChange,
}: TrashPageProps) {
  const [filter, setFilter] = useState<TrashFilter>("all");
  const [localSort, setLocalSort] = useState<TrashSort>("newest");
  const sort = controlledSort ?? localSort;
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [emptying, setEmptying] = useState(false);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const sortMenu = useRef<HTMLDetailsElement>(null);

  const entries = useMemo<TrashEntry[]>(() => {
    const next: TrashEntry[] = [
      ...items.map(
        (card): TrashedFragmentEntry => ({
          key: `fragment:${card.fragment.id}`,
          kind: "fragment",
          record: card.fragment,
          card,
          deletedAt:
            card.fragment.deletedAt ??
            card.fragment.updatedAt ??
            card.fragment.createdAt,
        }),
      ),
      ...frames.map(
        (frame): TrashedFrameEntry => ({
          key: `frame:${frame.id}`,
          kind: "frame",
          record: frame,
          deletedAt: frame.updatedAt ?? frame.createdAt,
        }),
      ),
    ];

    return next.sort((left, right) => {
      const difference = timestamp(right.deletedAt) - timestamp(left.deletedAt);
      return sort === "newest" ? difference : -difference;
    });
  }, [items, frames, sort]);

  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (filter === "all") return true;
        return entry.kind === filter.slice(0, -1);
      }),
    [entries, filter],
  );

  const loadedTotal = entries.length;
  const globalTotal = Math.max(total, loadedTotal);
  const itemLabel = globalTotal === 1 ? "item" : "items";
  const subtitle = retentionLabel.trim()
    ? `${globalTotal} ${itemLabel} · ${retentionLabel}`
    : `${globalTotal} ${itemLabel}`;

  async function restore(entry: TrashEntry) {
    setPendingKeys((current) => new Set(current).add(entry.key));
    try {
      await runRecoverableTrashAction(
        () =>
          entry.kind === "fragment"
            ? onRestoreFragment(entry.record)
            : onRestoreFrame(entry.record),
        async (caught) => {
          await onRestoreError?.(caught);
        },
      );
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(entry.key);
        return next;
      });
    }
  }

  async function emptyTrash() {
    if (globalTotal === 0) return;
    setEmptying(true);
    try {
      await onEmptyTrash();
      setConfirmingEmpty(false);
    } finally {
      setEmptying(false);
    }
  }

  function chooseSort(nextSort: TrashSort) {
    if (controlledSort === undefined) {
      setLocalSort(nextSort);
    }
    onSortChange?.(nextSort);
    if (sortMenu.current) sortMenu.current.open = false;
  }

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
          <details className="v7-trash-sort" ref={sortMenu}>
            <summary>
              <span>Deleted date</span>
              <ChevronDown aria-hidden="true" size={14} strokeWidth={1.7} />
            </summary>
            <div className="v7-trash-sort-menu" role="menu">
              <button
                aria-checked={sort === "newest"}
                onClick={() => chooseSort("newest")}
                role="menuitemradio"
                type="button"
              >
                <span>Newest first</span>
                {sort === "newest" ? (
                  <Check aria-hidden="true" size={14} />
                ) : null}
              </button>
              <button
                aria-checked={sort === "oldest"}
                onClick={() => chooseSort("oldest")}
                role="menuitemradio"
                type="button"
              >
                <span>Oldest first</span>
                {sort === "oldest" ? (
                  <Check aria-hidden="true" size={14} />
                ) : null}
              </button>
            </div>
          </details>
          <button
            className="v7-trash-empty-button"
            disabled={globalTotal === 0 || emptying}
            onClick={() => setConfirmingEmpty(true)}
            type="button"
          >
            {emptying ? "Emptying…" : "Empty Trash"}
          </button>
        </div>
      </header>

      <div className="v7-trash-content">
        <div className="v7-trash-filterbar">
          <div
            aria-label="Filter Trash by item type"
            className="v7-trash-filters"
            role="group"
          >
            <TrashFilterButton
              active={filter === "all"}
              label="All items"
              onClick={() => setFilter("all")}
            />
            <TrashFilterButton
              active={filter === "fragments"}
              label="Fragments"
              onClick={() => setFilter("fragments")}
            />
            <TrashFilterButton
              active={filter === "frames"}
              label="Frames"
              onClick={() => setFilter("frames")}
            />
          </div>
          <span>
            {filter === "all" && visibleEntries.length < globalTotal
              ? `Showing ${visibleEntries.length.toLocaleString()} of ${globalTotal.toLocaleString()} items`
              : `${visibleEntries.length.toLocaleString()} ${visibleEntries.length === 1 ? "item" : "items"}`}
          </span>
        </div>

        {onColorChange &&
        color &&
        (paletteIndex?.pending || colorResultsChanged) ? (
          <div className="fragment-index-status">
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

        <div className="v7-trash-list-shell">
          <div className="v7-trash-list-scroll">
            <div
              aria-colcount={6}
              aria-label="Deleted items"
              className="v7-trash-list"
              role="table"
            >
              <div className="v7-trash-row v7-trash-list-header" role="row">
                <span aria-hidden="true" role="columnheader" />
                <span role="columnheader">Name</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">From</span>
                <span role="columnheader">Deleted</span>
                <span role="columnheader">Action</span>
              </div>

              {visibleEntries.map((entry) => (
                <TrashRow
                  entry={entry}
                  frameNameFor={frameNameFor}
                  key={entry.key}
                  pending={pendingKeys.has(entry.key)}
                  onAssetFallback={onAssetFallback}
                  onRestore={() => void restore(entry)}
                />
              ))}
            </div>

            <PaginationFooter
              hasMore={hasMore}
              loadedCount={loadedTotal}
              loading={loading}
              noun="items"
              onLoadMore={onLoadMore}
              totalCount={globalTotal}
            />

            {loading && loadedTotal === 0 ? (
              <div className="v7-trash-state" aria-live="polite">
                <span className="v7-trash-spinner" />
                <strong>Loading Trash</strong>
                <small>Your active library remains available.</small>
              </div>
            ) : !loading && visibleEntries.length === 0 ? (
              <div className="v7-trash-state">
                <Trash2 aria-hidden="true" size={24} strokeWidth={1.5} />
                <strong>
                  {globalTotal === 0 ? "Trash is empty" : "No matching items"}
                </strong>
                <small>
                  {globalTotal === 0
                    ? "Deleted Frames and Fragments will appear here."
                    : "Choose another item type to see deleted work."}
                </small>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {confirmingEmpty ? (
        <Modal
          className="v7-frame-name-modal v7-confirm-modal"
          title="Empty Trash?"
          onClose={() => {
            if (!emptying) setConfirmingEmpty(false);
          }}
        >
          <div className="v7-frame-name-form">
            <div className="v7-frame-name-copy">
              <p>
                Permanently delete all {globalTotal.toLocaleString()}{" "}
                {itemLabel}? This cannot be undone.
              </p>
            </div>
            <div className="v7-frame-name-actions">
              <button
                className="v7-frame-dialog-button"
                disabled={emptying}
                onClick={() => setConfirmingEmpty(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="v7-frame-dialog-button v7-trash-confirm-button"
                data-modal-preferred-focus="true"
                disabled={emptying}
                onClick={() => void emptyTrash()}
                type="button"
              >
                {emptying ? "Emptying…" : "Empty Trash"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function TrashFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function TrashRow({
  entry,
  frameNameFor,
  pending,
  onAssetFallback,
  onRestore,
}: {
  entry: TrashEntry;
  frameNameFor: (frameId: string) => string;
  pending: boolean;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onRestore: () => void;
}) {
  const isFragment = entry.kind === "fragment";
  const name = isFragment
    ? entry.record.title?.trim() || "Untitled Fragment"
    : entry.record.name.trim() || "Unnamed Frame";
  const from = isFragment
    ? entry.card.folderName
    : entry.record.parentId
      ? frameNameFor(entry.record.parentId)
      : "Your Vault";

  return (
    <div className="v7-trash-row v7-trash-item-row" role="row">
      <div className="v7-trash-cell v7-trash-thumbnail-cell" role="cell">
        {isFragment ? (
          <TrashThumbnail
            alt={name}
            onAssetFallback={onAssetFallback}
            sources={entry.card.assetSources}
          />
        ) : (
          <span className="v7-trash-fragment-thumbnail" aria-hidden="true">
            <Folder size={23} strokeWidth={1.6} />
          </span>
        )}
      </div>
      <strong className="v7-trash-name" role="cell" title={name}>
        {name}
      </strong>
      <div className="v7-trash-cell" role="cell">
        <span className="v7-trash-type-badge">
          {isFragment ? "Fragment" : "Frame"}
        </span>
      </div>
      <span className="v7-trash-from" role="cell" title={from}>
        {from}
      </span>
      <time className="v7-trash-deleted" dateTime={entry.deletedAt} role="cell">
        {formatDeletedDate(entry.deletedAt)}
      </time>
      <div className="v7-trash-cell v7-trash-action-cell" role="cell">
        <button
          aria-label={pending ? `Restoring ${name}` : `Restore ${name}`}
          className="v7-trash-restore"
          disabled={pending}
          onClick={onRestore}
          type="button"
        >
          <span>{pending ? "Restoring…" : "Restore"}</span>
        </button>
      </div>
    </div>
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

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
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
