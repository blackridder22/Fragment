import type { MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { Fragment, Frame } from "@fragment/shared";
import type { BrowsingDensity } from "../store/library-types";
import {
  V7AssetImage,
  V7FrameCard,
  FrameCanvas,
  type FrameCanvasProps,
  type GalleryCard,
  type V7AssetFallback,
} from "./FrameGallery";
import { PaginationFooter } from "./PaginationFooter";

export type VaultPageProps = {
  density?: BrowsingDensity;
  /** Top-level Frames shown as folder cards. */
  folders: Frame[];
  /** Up to three collage items per Frame id. */
  folderCovers: ReadonlyMap<string, GalleryCard[]>;
  frameCounts: ReadonlyMap<string, number>;
  /** Recently added Fragments, precomputed by the store. */
  items: GalleryCard[];
  hasMore?: boolean;
  loading?: boolean;
  selectedIds: ReadonlySet<string>;
  total?: number;
  onAssetFallback?: V7AssetFallback;
  onBrowseAll: () => void;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onOpen: (fragment: Fragment) => void;
  onOpenFolder: (frame: Frame) => void;
  onLoadMore?: () => void;
  onPointerDown?: FrameCanvasProps["onPointerDown"];
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
};

const FIRST_ROW_WEIGHTS = [1.25, 0.8, 1.35] as const;
const SECOND_ROW_WEIGHTS = [1.1, 0.75, 1.2, 0.95] as const;
const EMPTY_COVERS: GalleryCard[] = [];

function vaultRows(items: GalleryCard[], paginated: boolean) {
  if (!paginated) {
    return [items.slice(0, 3), items.slice(3, 7)].filter(
      (row) => row.length > 0,
    );
  }

  const rows: GalleryCard[][] = [];
  let offset = 0;
  while (offset < items.length) {
    const rowSize = rows.length % 2 === 0 ? 3 : 4;
    rows.push(items.slice(offset, offset + rowSize));
    offset += rowSize;
  }
  return rows;
}

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

export function VaultPage({
  density = "comfortable",
  folders,
  folderCovers,
  frameCounts,
  items,
  hasMore = false,
  loading = false,
  selectedIds,
  total,
  onAssetFallback,
  onBrowseAll,
  onContextMenu,
  onOpen,
  onOpenFolder,
  onLoadMore,
  onPointerDown,
  onSelect,
}: VaultPageProps) {
  const visibleFolders = folders.slice(0, 4);
  const rows = vaultRows(items, Boolean(onLoadMore));
  const visibleCount = rows.reduce((count, row) => count + row.length, 0);

  return (
    <FrameCanvas
      className="v7-vault-page"
      density={density}
      onPointerDown={onPointerDown}
    >
      <section className="v7-vault-fragments" aria-labelledby="v7-frames-title">
        <header className="v7-section-header">
          <h2 id="v7-frames-title">Frames</h2>
          <SectionAction onClick={onBrowseAll}>View all</SectionAction>
        </header>

        <div className="v7-folder-card-row">
          {visibleFolders.map((frame) => {
            const covers = folderCovers.get(frame.id) ?? EMPTY_COVERS;
            const count = frameCounts.get(frame.id) ?? 0;

            return (
              <button
                aria-label={`Open ${frame.name}, ${count.toLocaleString()} ${count === 1 ? "Fragment" : "Fragments"}`}
                className="v7-folder-card"
                key={frame.id}
                onClick={() => onOpenFolder(frame)}
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
                    {[1, 2].map((slot) => (
                      <CollageTile
                        card={covers[slot]}
                        className="v7-folder-tile"
                        key={slot}
                        onAssetFallback={onAssetFallback}
                        tone={slot + 1}
                      />
                    ))}
                  </span>
                </span>

                <span className="v7-folder-card-meta">
                  <strong>{frame.name}</strong>
                  <span>
                    {count.toLocaleString()}{" "}
                    {count === 1 ? "Fragment" : "Fragments"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="v7-vault-recent" aria-labelledby="v7-recent-title">
        <header className="v7-recent-header">
          <span className="v7-recent-heading-copy">
            <h2 id="v7-recent-title">Recently added</h2>
            <span>Fragments from across your Vault</span>
          </span>
          <SectionAction onClick={onBrowseAll}>Browse all</SectionAction>
        </header>

        {rows.length > 0 ? (
          <div className="v7-vault-frame-gallery">
            {rows.map((row, rowIndex) => {
              const weights =
                rowIndex % 2 === 0 ? FIRST_ROW_WEIGHTS : SECOND_ROW_WEIGHTS;
              return (
                <div
                  className="v7-vault-frame-row"
                  key={row[0]?.fragment.id ?? rowIndex}
                >
                  {row.map((card, index) => (
                    <V7FrameCard
                      assetSources={card.assetSources}
                      folderName={card.folderName}
                      fragment={card.fragment}
                      key={card.fragment.id}
                      onAssetFallback={onAssetFallback}
                      onContextMenu={onContextMenu}
                      onOpen={onOpen}
                      onSelect={onSelect}
                      selected={selectedIds.has(card.fragment.id)}
                      variant="vault"
                      weight={weights[index] ?? 1}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="v7-gallery-empty" role="status">
            <strong>No Fragments in your Vault yet</strong>
            <span>Import an image to start your visual library.</span>
          </div>
        )}
        <PaginationFooter
          hasMore={hasMore}
          loadedCount={visibleCount}
          loading={loading}
          onLoadMore={onLoadMore}
          totalCount={total}
        />
      </section>
    </FrameCanvas>
  );
}
