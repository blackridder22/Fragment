import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
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
import type { BrowsingDensity } from "../features/library/BrowsingModeControl";
import {
  V7AssetImage,
  V7FrameCard,
  FrameCanvas,
  type FrameCanvasProps,
  type V7AssetFallback,
  type V7AssetSourcesFor,
  type V7FolderNameFor,
  type V7FrameCardProps,
} from "./FrameGallery";
import {
  FOLDER_CARD_LIMIT,
  FOLDER_PREVIEW_LIMIT,
  INTRO_WINDOW_MS,
  RECENT_LIMIT,
  RECENT_ROW_TARGET,
  collageFragments,
  fragmentCountLabel,
  frameCountFor,
  isBrandNewVault,
  isSystemFrame,
  justifiedRows,
  recentFragments as selectRecentFragments,
  staggerIndex,
  topLevelFrames,
  visibleFolderFrames,
  type FrameCountSource,
  type FramePreviewMap,
} from "./vault-home";

export type VaultPageProps = {
  assetSourcesFor: V7AssetSourcesFor;
  density?: BrowsingDensity;
  /** Drop target currently under a pointer drag, e.g. `frame-tree:<id>`. */
  dropTarget?: string | null;
  folderNameFor: V7FolderNameFor;
  /** Recursive Fragment totals per Frame from the store. */
  frameCounts?: FrameCountSource;
  /** Latest Fragments per top-level Frame from `list_frame_previews`. */
  framePreviews?: FramePreviewMap;
  frames: Frame[];
  /** Newest-first Fragments from the whole Vault (the shared snapshot page). */
  fragments: Fragment[];
  /** False until the first snapshot arrived; keeps the empty state from flashing. */
  ready?: boolean;
  searchQuery?: string;
  selectedIds: Set<string>;
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

type FolderCardProps = {
  assetSourcesFor: V7AssetSourcesFor;
  count: number;
  enterClass: string;
  frame: Frame;
  dropArmed: boolean;
  index: number;
  isSystem: boolean;
  previews: Fragment[];
  onAssetFallback?: V7AssetFallback;
  onOpen: (frame: Frame) => void;
};

function FolderCard({
  assetSourcesFor,
  count,
  enterClass,
  frame,
  dropArmed,
  index,
  isSystem,
  previews,
  onAssetFallback,
  onOpen,
}: FolderCardProps) {
  const label = fragmentCountLabel(count);
  const [main, ...stack] = previews;

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
        <span className="v7-folder-tile v7-folder-tile-main">
          {main ? (
            <V7AssetImage
              assetSources={assetSourcesFor(main)}
              className="v7-folder-image"
              decorative
              fragment={main}
              onAssetFallback={onAssetFallback}
              tone={0}
            />
          ) : (
            <span className="v7-folder-image v7-asset-fallback" data-tone="0" />
          )}
        </span>
        <span className="v7-folder-tile-stack">
          {Array.from({ length: FOLDER_PREVIEW_LIMIT - 1 }, (_, slot) => {
            const preview = stack[slot];
            return (
              <span className="v7-folder-tile" key={slot}>
                {preview ? (
                  <V7AssetImage
                    assetSources={assetSourcesFor(preview)}
                    className="v7-folder-image"
                    decorative
                    fragment={preview}
                    onAssetFallback={onAssetFallback}
                    tone={slot + 1}
                  />
                ) : (
                  <span
                    className="v7-folder-image v7-asset-fallback"
                    data-tone={slot + 1}
                  />
                )}
              </span>
            );
          })}
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
        <strong>Fragments</strong> are the images you save into them, each
        kept with its source. Import a few images to start, or save them from
        your browser with Capture Mode.
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
  assetSourcesFor,
  density = "comfortable",
  dropTarget = null,
  folderNameFor,
  frameCounts,
  framePreviews,
  frames,
  fragments,
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

  const folders = topLevelFrames(frames, systemFrameId);
  const { visible: visibleFolders, hiddenCount } = visibleFolderFrames(
    folders,
    showAllFrames,
    FOLDER_CARD_LIMIT,
  );
  const recent = selectRecentFragments(fragments, RECENT_LIMIT);
  const rows = justifiedRows(recent, RECENT_ROW_TARGET[density]);
  const hasQuery = searchQuery.trim().length > 0;
  const brandNew = isBrandNewVault({
    ready,
    frames: folders,
    fragments,
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
              {folders.length > 0 ? (
                <span className="v7-section-count">
                  {folders.length.toLocaleString()}{" "}
                  {folders.length === 1 ? "Frame" : "Frames"}
                </span>
              ) : null}
            </header>

            {visibleFolders.length > 0 ? (
              <div className="v7-folder-grid">
                {visibleFolders.map((frame, index) => (
                  <FolderCard
                    assetSourcesFor={assetSourcesFor}
                    count={frameCountFor(frame, frameCounts, fragments)}
                    dropArmed={dropTarget === `frame-tree:${frame.id}`}
                    enterClass={enterClass}
                    frame={frame}
                    index={index}
                    isSystem={isSystemFrame(frame, systemFrameId)}
                    key={frame.id}
                    previews={collageFragments(
                      frame.id,
                      framePreviews,
                      fragments,
                      FOLDER_PREVIEW_LIMIT,
                    )}
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
            ) : showAllFrames && folders.length > FOLDER_CARD_LIMIT ? (
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
                {rows.map((row, rowIndex) => {
                  const offset = rows
                    .slice(0, rowIndex)
                    .reduce((count, prior) => count + prior.items.length, 0);
                  return (
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
                      {row.items.map(({ fragment, ratio }, index) => (
                        <V7FrameCard
                          assetSources={assetSourcesFor(fragment)}
                          className={`v7-vault-recent-card ${enterClass}`.trim()}
                          folderName={folderNameFor(fragment)}
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
                              "--v7-stagger-index": staggerIndex(offset + index),
                            } as RecentCardStyle
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : ready ? (
              <div className="v7-vault-note v7-vault-recent-empty" role="status">
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
