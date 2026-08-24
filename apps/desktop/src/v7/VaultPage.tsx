import type { CSSProperties, MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
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
} from "./FrameGallery";
import { PaginationFooter } from "./PaginationFooter";

type FrameCountSource =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

function isFrameCountMap(
  value: FrameCountSource,
): value is ReadonlyMap<string, number> {
  return typeof (value as ReadonlyMap<string, number>).get === "function";
}

export type VaultPageProps = {
  assetSourcesFor: V7AssetSourcesFor;
  density?: BrowsingDensity;
  folderNameFor: V7FolderNameFor;
  frameCounts?: FrameCountSource;
  frames: Frame[];
  fragments: Fragment[];
  hasMore?: boolean;
  loading?: boolean;
  selectedIds: Set<string>;
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

type WeightedCardStyle = CSSProperties & {
  "--v7-card-weight": number;
};

const FIRST_ROW_WEIGHTS = [1.25, 0.8, 1.35] as const;
const SECOND_ROW_WEIGHTS = [1.1, 0.75, 1.2, 0.95] as const;

function vaultRows(fragments: Fragment[], paginated: boolean) {
  if (!paginated) {
    return [fragments.slice(0, 3), fragments.slice(3, 7)].filter(
      (row) => row.length > 0,
    );
  }

  const rows: Fragment[][] = [];
  let offset = 0;
  while (offset < fragments.length) {
    const rowSize = rows.length % 2 === 0 ? 3 : 4;
    rows.push(fragments.slice(offset, offset + rowSize));
    offset += rowSize;
  }
  return rows;
}

function frameCountFor(
  frame: Frame,
  fragments: Fragment[],
  frameCounts?: FrameCountSource,
) {
  if (frameCounts) {
    if (isFrameCountMap(frameCounts)) {
      return frameCounts.get(frame.id) ?? 0;
    }
    return frameCounts[frame.id] ?? 0;
  }

  return fragments.reduce(
    (count, fragment) => count + Number(fragment.frameId === frame.id),
    0,
  );
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

export function VaultPage({
  assetSourcesFor,
  density = "comfortable",
  folderNameFor,
  frameCounts,
  frames,
  fragments,
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
  const visibleFolders = frames.slice(0, 4);
  const rows = vaultRows(fragments, Boolean(onLoadMore));
  const visibleFrameCount = rows.reduce((count, row) => count + row.length, 0);

  return (
    <FrameCanvas
      className="v7-vault-page"
      density={density}
      onPointerDown={onPointerDown}
    >
      <section
        className="v7-vault-fragments"
        aria-labelledby="v7-fragments-title"
      >
        <header className="v7-section-header">
          <h2 id="v7-fragments-title">Fragments</h2>
          <SectionAction onClick={onBrowseAll}>View all</SectionAction>
        </header>

        <div className="v7-folder-card-row">
          {visibleFolders.map((frame) => {
            const folderFrames = fragments.filter(
              (fragment) => fragment.frameId === frame.id,
            );
            const count = frameCountFor(frame, fragments, frameCounts);

            return (
              <button
                aria-label={`Open ${frame.name}, ${count} Frames`}
                className="v7-folder-card"
                key={frame.id}
                onClick={() => onOpenFolder(frame)}
                type="button"
              >
                <span className="v7-folder-collage" aria-hidden="true">
                  <span className="v7-folder-tile v7-folder-tile-main">
                    {folderFrames[0] ? (
                      <V7AssetImage
                        assetSources={assetSourcesFor(folderFrames[0])}
                        className="v7-folder-image"
                        decorative
                        fragment={folderFrames[0]}
                        onAssetFallback={onAssetFallback}
                        tone={0}
                      />
                    ) : (
                      <span
                        className="v7-folder-image v7-asset-fallback"
                        data-tone="0"
                      />
                    )}
                  </span>
                  <span className="v7-folder-tile-stack">
                    {[1, 2].map((slot) => {
                      const preview = folderFrames[slot];
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
                  <strong>{frame.name}</strong>
                  <span>{count.toLocaleString()} Frames</span>
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
            <span>Frames from across your Vault</span>
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
                  key={row[0]?.id ?? rowIndex}
                >
                  {row.map((fragment, index) => (
                    <V7FrameCard
                      assetSources={assetSourcesFor(fragment)}
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
                          "--v7-card-weight": weights[index] ?? 1,
                        } as WeightedCardStyle
                      }
                      variant="vault"
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="v7-gallery-empty" role="status">
            <strong>No Frames in your Vault yet</strong>
            <span>Import an image to start your visual library.</span>
          </div>
        )}
        <PaginationFooter
          hasMore={hasMore}
          loadedCount={visibleFrameCount}
          loading={loading}
          onLoadMore={onLoadMore}
          totalCount={total}
        />
      </section>
    </FrameCanvas>
  );
}
