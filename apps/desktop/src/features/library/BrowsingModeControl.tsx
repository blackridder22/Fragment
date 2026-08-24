import { Columns3, Grid3X3, Rows3 } from "lucide-react";

export type BrowsingLayout = "masonry" | "grid" | "list";
export type BrowsingDensity = "compact" | "comfortable" | "large";

type BrowsingModeControlProps = {
  density: BrowsingDensity;
  layout: BrowsingLayout;
  onDensityChange: (density: BrowsingDensity) => void;
  onLayoutChange: (layout: BrowsingLayout) => void;
};

const LAYOUTS = [
  ["masonry", Columns3, "Masonry"],
  ["grid", Grid3X3, "Grid"],
  ["list", Rows3, "List"],
] as const;

export function BrowsingModeControl({
  density,
  layout,
  onDensityChange,
  onLayoutChange,
}: BrowsingModeControlProps) {
  return (
    <div className="browsing-mode-control" aria-label="Browsing mode">
      <div role="group" aria-label="Frame layout">
        {LAYOUTS.map(([value, Icon, label]) => (
          <button
            aria-label={`${label} layout`}
            aria-pressed={layout === value}
            data-active={layout === value}
            key={value}
            onClick={() => onLayoutChange(value)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
          </button>
        ))}
      </div>
      <label>
        <span>Size</span>
        <input
          aria-label="Frame size"
          max="2"
          min="0"
          onChange={(event) =>
            onDensityChange(
              (["compact", "comfortable", "large"] as const)[
                Number(event.target.value)
              ],
            )
          }
          step="1"
          type="range"
          value={density === "compact" ? 0 : density === "comfortable" ? 1 : 2}
        />
      </label>
      <kbd>Space · Quick Preview</kbd>
    </div>
  );
}
