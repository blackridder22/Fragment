import type { DragEvent, DragEventHandler, MouseEvent } from "react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../lib/assets";
import { FragmentCard } from "./FragmentCard";

type MasonryGridProps = {
  fragments: Fragment[];
  assetSourcesFor: (fragment: Fragment) => AssetSource[];
  draggable?: boolean;
  selectedIds: Set<string>;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onDragEnd?: DragEventHandler<HTMLElement>;
  onDragStart?: (fragment: Fragment, event: DragEvent<HTMLElement>) => void;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
};

export function MasonryGrid({
  fragments,
  assetSourcesFor,
  draggable = true,
  selectedIds,
  onAssetFallback,
  onDragEnd,
  onDragStart,
  onSelect,
}: MasonryGridProps) {
  return (
    <div className="masonry-grid">
      {fragments.map((fragment) => (
        <FragmentCard
          assetSources={assetSourcesFor(fragment)}
          draggable={draggable && !fragment.id.startsWith("demo-")}
          fragment={fragment}
          key={fragment.id}
          onAssetFallback={onAssetFallback}
          onDragEnd={onDragEnd}
          onDragStart={
            onDragStart ? (event) => onDragStart(fragment, event) : undefined
          }
          selected={selectedIds.has(fragment.id)}
          onSelect={(event) => onSelect(fragment, event)}
        />
      ))}
    </div>
  );
}
