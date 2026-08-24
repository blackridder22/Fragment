import type { ReactNode } from "react";
import { CheckSquare, SlidersHorizontal } from "lucide-react";

export type SortMode = "newest" | "oldest" | "name" | "largest";
export type SourceFilter = "all" | "source" | "local" | "png";

type TopCommandBarProps = {
  onSortChange: (value: SortMode) => void;
  onSourceFilterChange: (value: SourceFilter) => void;
  onSelectAll?: () => void;
  onOpenFilters: () => void;
  filterCount: number;
  showLibraryTools: boolean;
  sourceFilter: SourceFilter;
  sortMode: SortMode;
  subtitle: string;
  title: string;
  viewControls?: ReactNode;
};

export function TopCommandBar({
  onSortChange,
  onSourceFilterChange,
  onSelectAll,
  onOpenFilters,
  filterCount,
  showLibraryTools,
  sourceFilter,
  sortMode,
  subtitle,
  title,
  viewControls,
}: TopCommandBarProps) {
  return (
    <header className="top-command-bar" data-library-tools={showLibraryTools}>
      <div className="top-title">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      {showLibraryTools ? (
        <div className="page-command-tools">
          {viewControls}
          <div
            className="library-controls"
            aria-label="Library controls"
            role="group"
          >
            <label>
              <span className="sr-only">Sort</span>
              <select
                aria-label="Sort Frames"
                value={sortMode}
                onChange={(event) =>
                  onSortChange(event.target.value as SortMode)
                }
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="largest">Largest</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Source</span>
              <select
                aria-label="Filter Frames"
                value={sourceFilter}
                onChange={(event) =>
                  onSourceFilterChange(event.target.value as SourceFilter)
                }
              >
                <option value="all">All</option>
                <option value="source">With Source</option>
                <option value="local">Local only</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <button
              className="advanced-filter-button"
              data-active={filterCount > 0}
              onClick={onOpenFilters}
              type="button"
            >
              <SlidersHorizontal aria-hidden="true" size={15} />
              <span>Filters</span>
              {filterCount > 0 ? <small>{filterCount}</small> : null}
            </button>
          </div>
          <div className="command-actions">
            {onSelectAll ? (
              <button
                aria-label="Select all matching Frames"
                className="icon-button command-select-button"
                onClick={onSelectAll}
                title="Select all matching Frames (Command+A)"
                type="button"
              >
                <CheckSquare aria-hidden="true" size={17} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
