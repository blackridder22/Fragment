import {
  CheckSquare,
  Download,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

export type SortMode = "newest" | "oldest" | "name" | "largest";
export type SourceFilter = "all" | "source" | "local" | "png";

type TopCommandBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onCreateFrame: () => void;
  onImport: () => void;
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
};

export function TopCommandBar({
  query,
  onQueryChange,
  onCreateFrame,
  onImport,
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
}: TopCommandBarProps) {
  return (
    <header className="top-command-bar" data-library-tools={showLibraryTools}>
      <div className="top-title">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      {showLibraryTools ? (
        <>
          <label className="search-field">
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="Search your Vault"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search your vault"
            />
            <kbd>⌘K</kbd>
          </label>
          <div
            className="library-controls"
            aria-label="Library controls"
            role="group"
          >
            <label>
              <span>Sort</span>
              <select
                aria-label="Sort Fragments"
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
              <span>Source</span>
              <select
                aria-label="Filter Fragments"
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
                aria-label="Select all matching Fragments"
                className="icon-button command-select-button"
                onClick={onSelectAll}
                title="Select all matching Fragments (Command+A)"
                type="button"
              >
                <CheckSquare aria-hidden="true" size={17} />
              </button>
            ) : null}
            <button
              className="button primary"
              onClick={onCreateFrame}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              <span>New Frame</span>
            </button>
            <button className="button" onClick={onImport} type="button">
              <Download aria-hidden="true" size={17} />
              <span>Import</span>
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
}
