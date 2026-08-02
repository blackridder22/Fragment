import type { MouseEvent } from "react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../lib/assets";
import { FragmentCard } from "./FragmentCard";
import type {
  BrowsingDensity,
  BrowsingLayout,
} from "../features/library/BrowsingModeControl";

type MasonryGridProps = {
  fragments: Fragment[];
  assetSourcesFor: (fragment: Fragment) => AssetSource[];
  selectionActive?: boolean;
  selectedIds: Set<string>;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onOpen: (fragment: Fragment) => void;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  layout: BrowsingLayout;
  density: BrowsingDensity;
};

export function MasonryGrid({
  fragments,
  assetSourcesFor,
  selectionActive = false,
  selectedIds,
  onAssetFallback,
  onOpen,
  onSelect,
  onContextMenu,
  layout,
  density,
}: MasonryGridProps) {
  return (
    <div className="masonry-grid" data-density={density} data-layout={layout}>
      {fragments.map((fragment) => (
        <FragmentCard
          assetSources={assetSourcesFor(fragment)}
          fragment={fragment}
          key={fragment.id}
          selectionActive={selectionActive}
          onAssetFallback={onAssetFallback}
          onOpen={() => onOpen(fragment)}
          selected={selectedIds.has(fragment.id)}
          onSelect={(event) => onSelect(fragment, event)}
          onContextMenu={(event) => onContextMenu(fragment, event)}
        />
      ))}
    </div>
  );
}
