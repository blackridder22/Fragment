import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FragmentFilter } from "../features/filters/filter-model";
import type { BrowsingDensity, SourceFilter } from "../store/library-types";
import {
  FrameCanvas,
  FrameGallery,
  type FrameGalleryProps,
  type FrameCanvasProps,
} from "./FrameGallery";
import { PaginationFooter } from "./PaginationFooter";
import { ColorFilterControl } from "../features/colors/ColorFilterControl";
import type { PaletteIndexStatus } from "@fragment/shared";

type V7FrameFilter = "all" | "fragment" | "source" | "tags";

export type FramesPageProps = FrameGalleryProps & {
  paletteIndex?: PaletteIndexStatus | null;
  colorResultsChanged?: boolean;
  onRefreshColors?: () => void;
  density?: BrowsingDensity;
  filter?: FragmentFilter;
  knownTags?: readonly string[];
  hasMore?: boolean;
  loading?: boolean;
  resultCount: number;
  sourceFilter?: SourceFilter;
  onClearFilters?: () => void;
  onFilterChange?: (filter: FragmentFilter) => void;
  onPointerDown?: FrameCanvasProps["onPointerDown"];
  onLoadMore?: () => void;
  onSourceFilterChange?: (filter: SourceFilter) => void;
};

type PopoverFilter = Exclude<V7FrameFilter, "all">;

const FILTERS: Array<{ key: V7FrameFilter; label: string }> = [
  { key: "all", label: "All Fragments" },
  { key: "fragment", label: "Fragment" },
  { key: "source", label: "Source" },
  { key: "tags", label: "Tags" },
];

const FORMAT_OPTIONS = [
  { label: "Any format", value: "" },
  { label: "PNG", value: "image/png" },
  { label: "JPEG", value: "image/jpeg" },
  { label: "WebP", value: "image/webp" },
  { label: "GIF", value: "image/gif" },
  { label: "SVG", value: "image/svg+xml" },
] as const;

const ORIENTATION_OPTIONS = [
  { label: "Any orientation", value: "all" },
  { label: "Landscape", value: "landscape" },
  { label: "Portrait", value: "portrait" },
  { label: "Square", value: "square" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: NonNullable<FragmentFilter["orientation"]>;
}>;

const SOURCE_OPTIONS: ReadonlyArray<{ label: string; value: SourceFilter }> = [
  { label: "Any source", value: "all" },
  { label: "From the web", value: "source" },
  { label: "Local files", value: "local" },
  { label: "PNG images", value: "png" },
];

function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className="v7-filter-menu-check"
      data-checked={checked}
      aria-hidden="true"
    >
      {checked ? <Check size={13} strokeWidth={2.2} /> : null}
    </span>
  );
}

function FilterMenuItem({
  checked,
  children,
  onClick,
  role = "menuitemradio",
}: {
  checked: boolean;
  children: string;
  onClick: () => void;
  role?: "menuitemradio" | "menuitemcheckbox";
}) {
  return (
    <button
      aria-checked={checked}
      className="v7-filter-menu-item"
      data-checked={checked}
      onClick={onClick}
      role={role}
      type="button"
    >
      <MenuCheck checked={checked} />
      <span>{children}</span>
    </button>
  );
}

export function FramesPage({
  paletteIndex,
  colorResultsChanged = false,
  onRefreshColors,
  density = "comfortable",
  filter = {},
  hasMore = false,
  knownTags = [],
  loading = false,
  resultCount,
  sourceFilter = "all",
  onClearFilters,
  onFilterChange,
  onLoadMore,
  onPointerDown,
  onSourceFilterChange,
  ...galleryProps
}: FramesPageProps) {
  const [openFilter, setOpenFilter] = useState<PopoverFilter | null>(null);
  const filterGroupRef = useRef<HTMLDivElement>(null);
  const menuIdPrefix = useId();
  const activeMimeType =
    filter.mimeTypes?.length === 1 ? filter.mimeTypes[0] : "";
  const activeOrientation = filter.orientation ?? "all";
  const activeTags = filter.tags ?? [];
  const hasFragmentFilter =
    Boolean(filter.mimeTypes?.length) || activeOrientation !== "all";
  const hasSourceFilter =
    sourceFilter !== "all" ||
    Boolean(
      filter.sourceDomain || filter.siteContains || filter.creatorContains,
    );
  const hasTagFilter = activeTags.length > 0;
  const hasAnyFilter =
    hasFragmentFilter ||
    hasSourceFilter ||
    hasTagFilter ||
    Boolean(filter.color);

  useEffect(() => {
    if (!openFilter) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!filterGroupRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenFilter(null);
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openFilter]);

  function patchFilter(patch: Partial<FragmentFilter>) {
    onFilterChange?.({ ...filter, ...patch });
  }

  function clearAllFilters() {
    setOpenFilter(null);
    if (onClearFilters) {
      onClearFilters();
      return;
    }
    onFilterChange?.({
      tags: [],
      mimeTypes: [],
      color: null,
      sourceKind: "all",
      orientation: "all",
    });
    onSourceFilterChange?.("all");
  }

  function isPillActive(key: V7FrameFilter) {
    if (key === "all") return !hasAnyFilter;
    if (key === "fragment") return hasFragmentFilter;
    if (key === "source") return hasSourceFilter;
    return hasTagFilter;
  }

  return (
    <FrameCanvas
      className="v7-frames-page"
      density={density}
      onPointerDown={onPointerDown}
    >
      <div
        className="v7-frame-filters"
        data-canvas-control
        aria-label="Fragment filters"
      >
        <div className="v7-frame-filter-group" ref={filterGroupRef}>
          {FILTERS.map((filterItem) => {
            const active = isPillActive(filterItem.key);
            const expanded = openFilter === filterItem.key;
            const menuId = `${menuIdPrefix}-${filterItem.key}`;

            return (
              <div className="v7-frame-filter-control" key={filterItem.key}>
                <button
                  aria-controls={filterItem.key === "all" ? undefined : menuId}
                  aria-expanded={
                    filterItem.key === "all" ? undefined : expanded
                  }
                  aria-haspopup={filterItem.key === "all" ? undefined : "menu"}
                  aria-pressed={active}
                  className="v7-filter-pill"
                  data-active={active}
                  data-expanded={expanded}
                  data-v7-filter={filterItem.key}
                  onClick={() => {
                    if (filterItem.key === "all") {
                      clearAllFilters();
                      return;
                    }
                    const popoverFilter: PopoverFilter = filterItem.key;
                    setOpenFilter((current) =>
                      current === popoverFilter ? null : popoverFilter,
                    );
                  }}
                  type="button"
                >
                  <span>{filterItem.label}</span>
                  {filterItem.key === "tags" && activeTags.length > 0 ? (
                    <span className="v7-filter-pill-count">
                      {activeTags.length}
                    </span>
                  ) : null}
                  {filterItem.key === "all" ? null : (
                    <ChevronDown
                      aria-hidden="true"
                      size={12}
                      strokeWidth={1.8}
                    />
                  )}
                </button>

                {expanded && filterItem.key === "fragment" ? (
                  <div
                    aria-label="Filter Fragments by image properties"
                    className="v7-filter-popover"
                    id={menuId}
                    role="menu"
                  >
                    <section className="v7-filter-menu-section">
                      <span className="v7-filter-menu-label">Format</span>
                      {FORMAT_OPTIONS.map((option) => (
                        <FilterMenuItem
                          checked={activeMimeType === option.value}
                          key={option.value || "any-format"}
                          onClick={() =>
                            patchFilter({
                              mimeTypes: option.value ? [option.value] : [],
                            })
                          }
                        >
                          {option.label}
                        </FilterMenuItem>
                      ))}
                    </section>
                    <span className="v7-filter-menu-divider" />
                    <section className="v7-filter-menu-section">
                      <span className="v7-filter-menu-label">Orientation</span>
                      {ORIENTATION_OPTIONS.map((option) => (
                        <FilterMenuItem
                          checked={activeOrientation === option.value}
                          key={option.value}
                          onClick={() =>
                            patchFilter({ orientation: option.value })
                          }
                        >
                          {option.label}
                        </FilterMenuItem>
                      ))}
                    </section>
                  </div>
                ) : null}

                {expanded && filterItem.key === "source" ? (
                  <div
                    aria-label="Filter Fragments by source"
                    className="v7-filter-popover"
                    id={menuId}
                    role="menu"
                  >
                    <section className="v7-filter-menu-section">
                      <span className="v7-filter-menu-label">Source</span>
                      {SOURCE_OPTIONS.map((option) => (
                        <FilterMenuItem
                          checked={sourceFilter === option.value}
                          key={option.value}
                          onClick={() => {
                            onSourceFilterChange?.(option.value);
                            setOpenFilter(null);
                          }}
                        >
                          {option.label}
                        </FilterMenuItem>
                      ))}
                    </section>
                  </div>
                ) : null}

                {expanded && filterItem.key === "tags" ? (
                  <div
                    aria-label="Filter Fragments by tags"
                    className="v7-filter-popover v7-filter-popover-tags"
                    id={menuId}
                    role="menu"
                  >
                    <section className="v7-filter-menu-section">
                      <span className="v7-filter-menu-label">Tags</span>
                      {knownTags.length > 0 ? (
                        knownTags.slice(0, 16).map((tag) => (
                          <FilterMenuItem
                            checked={activeTags.includes(tag)}
                            key={tag}
                            onClick={() => {
                              const next = new Set(activeTags);
                              if (next.has(tag)) next.delete(tag);
                              else next.add(tag);
                              patchFilter({ tags: [...next] });
                            }}
                            role="menuitemcheckbox"
                          >
                            {tag}
                          </FilterMenuItem>
                        ))
                      ) : (
                        <span className="v7-filter-menu-empty">
                          Add tags to Fragments to filter them here.
                        </span>
                      )}
                    </section>
                    {activeTags.length > 0 ? (
                      <>
                        <span className="v7-filter-menu-divider" />
                        <button
                          className="v7-filter-menu-clear"
                          onClick={() => patchFilter({ tags: [] })}
                          type="button"
                        >
                          Clear selected tags
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <ColorFilterControl
            value={filter.color}
            onChange={(color) => {
              setOpenFilter(null);
              patchFilter({ color });
            }}
          />
        </div>

        <span className="v7-frame-result-count">
          {resultCount.toLocaleString()} results
        </span>
      </div>

      {filter.color &&
      (Boolean(paletteIndex?.pending) || colorResultsChanged) ? (
        <div className="fragment-index-status" role="status">
          {paletteIndex?.pending ? (
            <span>
              Colors are still being extracted ·{" "}
              {paletteIndex.ready + paletteIndex.empty} processed,{" "}
              {paletteIndex.pending} remaining
            </span>
          ) : null}
          {colorResultsChanged ? (
            <>
              <span>More color results available</span>
              <button type="button" onClick={onRefreshColors}>
                Refresh
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <FrameGallery
        density={density}
        resultCount={resultCount}
        {...galleryProps}
      />
      <PaginationFooter
        hasMore={hasMore}
        loadedCount={galleryProps.items.length}
        loading={loading}
        onLoadMore={onLoadMore}
        totalCount={resultCount}
      />
    </FrameCanvas>
  );
}
