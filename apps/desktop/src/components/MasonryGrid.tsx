import type { MouseEvent } from "react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../lib/assets";
import { FragmentCard } from "./FragmentCard";

type MasonryGridProps = {
  fragments: Fragment[];
  assetSourcesFor: (fragment: Fragment) => AssetSource[];
  selectionActive?: boolean;
  selectedIds: Set<string>;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
};

export function MasonryGrid({
  fragments,
  assetSourcesFor,
  selectionActive = false,
  selectedIds,
  onAssetFallback,
  onSelect,
}: MasonryGridProps) {
  return (
    <div className="masonry-grid">
      {fragments.map((fragment) => (
        <FragmentCard
          assetSources={assetSourcesFor(fragment)}
          fragment={fragment}
          key={fragment.id}
          selectionActive={selectionActive}
          onAssetFallback={onAssetFallback}
          selected={selectedIds.has(fragment.id)}
          onSelect={(event) => onSelect(fragment, event)}
        />
      ))}
    </div>
  );
}
