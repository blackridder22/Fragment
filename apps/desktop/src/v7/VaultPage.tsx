import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Images,
  Inbox,
  Settings,
} from "lucide-react";
import type { Fragment, Frame } from "@fragment/shared";
import type { BrowsingDensity } from "../store/library-types";
import {
  V7AssetImage,
  V7FrameCard,
  FrameCanvas,
  type FrameCanvasProps,
  type GalleryCard,
  type V7AssetFallback,
  type V7FrameCardProps,
} from "./FrameGallery";
import {
  FOLDER_CARD_LIMIT,
  FOLDER_PREVIEW_LIMIT,
  INTRO_WINDOW_MS,
  RECENT_ROW_TARGET,
  fragmentCountLabel,
  isBrandNewVault,
  isSystemFrame,
  justifiedRows,
  staggerIndex,
  topLevelFrames,
  visibleFolderFrames,
} from "./vault-home";

export type VaultPageProps = {
  density?: BrowsingDensity;
  /** Drop target currently under a pointer drag, e.g. `frame-tree:<id>`. */
  dropTarget?: string | null;
  /** Collage cards per top-level Frame id, precomputed by the store. */
  folderCovers: ReadonlyMap<string, GalleryCard[]>;
  /** Top-level Frames, already narrowed by the search query. */
  folders: Frame[];
  /** Recursive Fragment totals per Frame from the store. */
  frameCounts: ReadonlyMap<string, number>;
  /** Newest-first cards from the whole Vault, bounded by the store. */
  items: GalleryCard[];
  /** False until the first snapshot arrived; keeps the empty state from flashing. */
  ready?: boolean;
  searchQuery?: string;
  selectedIds: ReadonlySet<string>;
  systemFrameId?: string | null;
  onAssetFallback?: V7AssetFallback;
  onBrowseAll: () => void;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onImport?: () => void;
  onOpen: (fragment: Fragment) => void;
  onOpenFolder: (frame: Frame) => void;
  onOpenSettings?: () => void;
  onPointerDown?: FrameCanvasProps["onPointerDown"];
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
};

type StaggerStyle = CSSProperties & {
  "--v7-stagger-index"?: number;
};

type RecentRowStyle = CSSProperties & {
  "--v7-recent-row-count": number;
  "--v7-recent-row-sum": number;
};

type RecentCardStyle = NonNullable<V7FrameCardProps["style"]> & {
  "--v7-recent-ratio": number;
  "--v7-stagger-index"?: number;
};

const EMPTY_COVERS: GalleryCard[] = [];

function SectionAction({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button className="v7-section-action" onClick={onClick} type="button">
      <span>{children}</span>
      <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
    </button>
  );
}

function CollageTile({
  card,
  className,
  onAssetFallback,
  tone,
}: {
  card?: GalleryCard;
  className: string;
  onAssetFallback?: V7AssetFallback;
  tone: number;
}) {
  return (
    <span className={className}>
      {card ? (
        <V7AssetImage
          assetSources={card.assetSources}
          className="v7-folder-image"
          decorative
          fragment={card.fragment}
          onAssetFallback={onAssetFallback}
          tone={tone}
        />
      ) : (
        <span className="v7-folder-image v7-asset-fallback" data-tone={tone} />
      )}
    </span>
  );
}

type FolderCardProps = {
  count: number;
  covers: GalleryCard[];
  enterClass: string;
  frame: Frame;
  dropArmed: boolean;
  index: number;
  isSystem: boolean;
  onAssetFallback?: V7AssetFallback;
  onOpen: (frame: Frame) => void;
};

function FolderCard({
  count,
  covers,
  enterClass,
  frame,
  dropArmed,
  index,
  isSystem,
  onAssetFallback,
  onOpen,
}: FolderCardProps) {
  const label = fragmentCountLabel(count);

  return (
    <button
      aria-label={`Open ${frame.name}, ${label}`}
      className={`v7-folder-card ${enterClass}`.trim()}
      data-drop-state={dropArmed ? "armed" : "idle"}
      data-drop-target={`frame-tree:${frame.id}`}
      data-system={isSystem || undefined}
      onClick={() => onOpen(frame)}
      style={{ "--v7-stagger-index": staggerIndex(index) } as StaggerStyle}
      type="button"
    >
      <span className="v7-folder-collage" aria-hidden="true">
        <CollageTile
          card={covers[0]}
          className="v7-folder-tile v7-folder-tile-main"
          onAssetFallback={onAssetFallback}
          tone={0}
        />
        <span className="v7-folder-tile-stack">
          {Array.from({ length: FOLDER_PREVIEW_LIMIT - 1 }, (_, slot) => (
            <CollageTile
              card={covers[slot + 1]}
              className="v7-folder-tile"
              key={slot}
              onAssetFallback={onAssetFallback}
              tone={slot + 1}
            />
          ))}
        </span>
      </span>

      <span className="v7-folder-card-meta">
        <span className="v7-folder-card-name">
          {isSystem ? (
            <Inbox aria-hidden="true" size={13} strokeWidth={1.9} />
          ) : null}
          <strong>{frame.name}</strong>
          {isSystem ? (
            <span className="v7-folder-system-badge">System</span>
          ) : null}
        </span>
        <span className="v7-folder-card-count">{label}</span>
      </span>
    </button>
  );
}

function VaultEmptyState({
  onImport,
  onOpenSettings,
}: {
  onImport?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="v7-vault-empty" role="status">
      <div className="v7-vault-empty-art" aria-hidden="true">
        <span className="v7-vault-empty-icon">
          <FolderOpen size={22} strokeWidth={1.6} />
        </span>
        <span className="v7-vault-empty-icon">
          <Images size={22} strokeWidth={1.6} />
        </span>
      </div>
      <h2>Your Vault is empty</h2>
      <p>
        <strong>Frames</strong> are the collections you create.{" "}
        <strong>Fragments</strong> are the images you save into them, each kept
        with its source. Import a few images to start, or save them from your
        browser with Capture Mode.
      </p>
      <div className="v7-vault-empty-actions">
        <button
          className="v7-vault-empty-primary"
          disabled={!onImport}
          onClick={onImport}
          type="button"
        >
          <Images aria-hidden="true" size={15} strokeWidth={1.9} />
          <span>Import Fragments</span>
        </button>
        <button
          className="v7-vault-empty-secondary"
          disabled={!onOpenSettings}
          onClick={onOpenSettings}
          type="button"
        >
          <Settings aria-hidden="true" size={15} strokeWidth={1.9} />
          <span>Set up Capture Mode</span>
        </button>
      </div>
      <p className="v7-vault-empty-hint">
        Capture Mode lives in Settings under Capture: install the browser
        extension there, then save any image on a page straight into a Frame.
      </p>
    </div>
  );
}

export function VaultPage({
  density = "comfortable",
  dropTarget = null,
  folderCovers,
  folders,
  frameCounts,
  items,
  ready = true,
  searchQuery = "",
  selectedIds,
  systemFrameId = null,
  onAssetFallback,
  onBrowseAll,
  onContextMenu,
  onImport,
  onOpen,
  onOpenFolder,
  onOpenSettings,
  onPointerDown,
  onSelect,
}: VaultPageProps) {
  const [showAllFrames, setShowAllFrames] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  const orderedFolders = useMemo(
    () => topLevelFrames(folders, systemFrameId),
    [folders, systemFrameId],
  );
  const { visible: visibleFolders, hiddenCount } = useMemo(
    () => visibleFolderFrames(orderedFolders, showAllFrames, FOLDER_CARD_LIMIT),
    [orderedFolders, showAllFrames],
  );
  const recent = useMemo(() => items.map((card) => card.fragment), [items]);
  // Each row carries the index of its first card so cards and rows line up.
  const rows = useMemo(() => {
    let start = 0;
    return justifiedRows(recent, RECENT_ROW_TARGET[density]).map((row) => {
      const withStart = { ...row, start };
      start += row.items.length;
      return withStart;
    });
  }, [recent, density]);
  const hasQuery = searchQuery.trim().length > 0;
  const brandNew = isBrandNewVault({
    ready,
    frames: orderedFolders,
    fragments: recent,
    systemFrameId,
    searchQuery,
  });
  const hasItems = visibleFolders.length > 0 || recent.length > 0;

  useEffect(() => {
    if (introDone || !hasItems) return;
    const timer = window.setTimeout(() => setIntroDone(true), INTRO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [hasItems, introDone]);

  // Only the first paint staggers; data refreshes render without motion.
  const enterClass = introDone ? "" : "v7-vault-enter";

  return (
    <FrameCanvas
      className="v7-vault-page"
      density={density}
      onPointerDown={onPointerDown}
    >
      {brandNew ? (
        <VaultEmptyState onImport={onImport} onOpenSettings={onOpenSettings} />
      ) : (
        <>
          <section
            className="v7-vault-frames"
            aria-labelledby="v7-vault-frames-title"
          >
            <header className="v7-section-header">
              <h2 id="v7-vault-frames-title">Frames</h2>
              {orderedFolders.length > 0 ? (
                <span className="v7-section-count">
                  {orderedFolders.length.toLocaleString()}{" "}
                  {orderedFolders.length === 1 ? "Frame" : "Frames"}
                </span>
              ) : null}
            </header>

            {visibleFolders.length > 0 ? (
              <div className="v7-folder-grid">
                {visibleFolders.map((frame, index) => (
                  <FolderCard
                    count={frameCounts.get(frame.id) ?? 0}
                    covers={folderCovers.get(frame.id) ?? EMPTY_COVERS}
                    dropArmed={dropTarget === `frame-tree:${frame.id}`}
                    enterClass={enterClass}
                    frame={frame}
                    index={index}
                    isSystem={isSystemFrame(frame, systemFrameId)}
                    key={frame.id}
                    onAssetFallback={onAssetFallback}
                    onOpen={onOpenFolder}
                  />
                ))}
              </div>
            ) : ready && hasQuery ? (
              <div className="v7-vault-note" role="status">
                No Frames match “{searchQuery.trim()}”.
              </div>
            ) : null}

            {hiddenCount > 0 ? (
              <button
                aria-expanded={false}
                className="v7-vault-expander"
                onClick={() => setShowAllFrames(true)}
                type="button"
              >
                <span>Show all Frames</span>
                <span className="v7-vault-expander-count">
                  {hiddenCount.toLocaleString()} more
                </span>
                <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            ) : showAllFrames && orderedFolders.length > FOLDER_CARD_LIMIT ? (
              <button
                aria-expanded
                className="v7-vault-expander"
                onClick={() => setShowAllFrames(false)}
                type="button"
              >
                <span>Show fewer Frames</span>
                <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
              </button>
            ) : null}
          </section>

          <section
            className="v7-vault-recent"
            aria-labelledby="v7-recent-title"
          >
            <header className="v7-recent-header">
              <span className="v7-recent-heading-copy">
                <h2 id="v7-recent-title">
                  {hasQuery ? "Matching Fragments" : "Recently added"}
                </h2>
                <span>
                  {hasQuery
                    ? `Fragments matching “${searchQuery.trim()}” across your Vault`
                    : "Fragments from across your Vault"}
                </span>
              </span>
              <SectionAction onClick={onBrowseAll}>Browse all</SectionAction>
            </header>

            {rows.length > 0 ? (
              <div className="v7-vault-recent-rows">
                {rows.map((row, rowIndex) => (
                  <div
                    className="v7-vault-recent-row"
                    key={row.items[0]?.fragment.id ?? rowIndex}
                    style={
                      {
                        "--v7-recent-row-count": row.items.length,
                        "--v7-recent-row-sum": row.ratioSum,
                      } as RecentRowStyle
                    }
                  >
                    {row.items.map(({ fragment, ratio }, index) => {
                      const card = items[row.start + index];
                      if (!card) return null;
                      return (
                        <V7FrameCard
                          assetSources={card.assetSources}
                          className={`v7-vault-recent-card ${enterClass}`.trim()}
                          folderName={card.folderName}
                          fragment={fragment}
                          key={fragment.id}
                          onAssetFallback={onAssetFallback}
                          onContextMenu={onContextMenu}
                          onOpen={onOpen}
                          onSelect={onSelect}
                          selected={selectedIds.has(fragment.id)}
                          style={
                            {
                              "--v7-recent-ratio": ratio,
                              "--v7-stagger-index": staggerIndex(
                                row.start + index,
                              ),
                            } as RecentCardStyle
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : ready ? (
              <div
                className="v7-vault-note v7-vault-recent-empty"
                role="status"
              >
                <strong>
                  {hasQuery ? "No matching Fragments" : "No Fragments yet"}
                </strong>
                <span>
                  {hasQuery
                    ? "Try another search, or browse all Fragments."
                    : "Import images or save them from Capture Mode to see them here."}
                </span>
                {!hasQuery && onImport ? (
                  <button
                    className="v7-vault-empty-secondary"
                    onClick={onImport}
                    type="button"
                  >
                    <Images aria-hidden="true" size={15} strokeWidth={1.9} />
                    <span>Import Fragments</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </FrameCanvas>
  );
}
