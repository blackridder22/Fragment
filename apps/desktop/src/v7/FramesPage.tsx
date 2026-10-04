import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SourceFilter } from "../components/TopCommandBar";
import {
  activeFilterCount,
  type FragmentFilter,
} from "../features/filters/filter-model";
import type { BrowsingDensity } from "../features/library/BrowsingModeControl";
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
  /** Message shown when a page failed to load; the footer offers a retry. */
  error?: string | null;
  filter?: FragmentFilter;
  /** Name of the open Frame for the empty state copy. */
  frameName?: string | null;
  knownTags?: readonly string[];
  hasMore?: boolean;
  loading?: boolean;
  resultCount: number;
  sourceFilter?: SourceFilter;
  onClearFilters?: () => void;
  onFilterChange?: (filter: FragmentFilter) => void;
  onPointerDown?: FrameCanvasProps["onPointerDown"];
  onLoadMore?: () => void;
  onRetry?: () => void;
  onSourceFilterChange?: (filter: SourceFilter) => void;
};

type PopoverFilter = Exclude<V7FrameFilter, "all">;

type FilterChip = {
  key: string;
  label: string;
  swatch?: string;
  onClear: () => void;
};

const FILTERS: Array<{ key: V7FrameFilter; label: string }> = [
  { key: "all", label: "All Fragments" },
  { key: "fragment", label: "Format" },
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

function formatLabel(mimeType: string) {
  return (
    FORMAT_OPTIONS.find((option) => option.value === mimeType)?.label ??
    mimeType.replace(/^image\//, "").toUpperCase()
  );
}

export function FramesPage({
  paletteIndex,
  colorResultsChanged = false,
  onRefreshColors,
  density = "comfortable",
  error = null,
  filter = {},
  frameName,
  hasMore = false,
  knownTags = [],
  loading = false,
  resultCount,
  sourceFilter = "all",
  onClearFilters,
  onFilterChange,
  onLoadMore,
  onPointerDown,
  onRetry,
  onSourceFilterChange,
  ...galleryProps
}: FramesPageProps) {
  const [openFilter, setOpenFilter] = useState<PopoverFilter | null>(null);
  const filterGroupRef = useRef<HTMLDivElement>(null);
  const menuIdPrefix = useId();
  const activeMimeTypes = filter.mimeTypes ?? [];
  const activeMimeType =
    activeMimeTypes.length === 1 ? activeMimeTypes[0]! : "";
  const activeOrientation = filter.orientation ?? "all";
  const activeTags = filter.tags ?? [];
  const hasFragmentFilter =
    activeMimeTypes.length > 0 || activeOrientation !== "all";
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
    Boolean(filter.color) ||
    activeFilterCount(filter) > 0;

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

  const chips: FilterChip[] = [];
  if (activeMimeType) {
    chips.push({
      key: "format",
      label: formatLabel(activeMimeType),
      onClear: () => patchFilter({ mimeTypes: [] }),
    });
  } else if (activeMimeTypes.length > 1) {
    chips.push({
      key: "format",
      label: activeMimeTypes.map(formatLabel).join(", "),
      onClear: () => patchFilter({ mimeTypes: [] }),
    });
  }
  if (activeOrientation !== "all") {
    chips.push({
      key: "orientation",
      label:
        ORIENTATION_OPTIONS.find((option) => option.value === activeOrientation)
          ?.label ?? activeOrientation,
      onClear: () => patchFilter({ orientation: "all" }),
    });
  }
  if (sourceFilter !== "all") {
    chips.push({
      key: "source",
      label:
        SOURCE_OPTIONS.find((option) => option.value === sourceFilter)?.label ??
        sourceFilter,
      onClear: () => onSourceFilterChange?.("all"),
    });
  }
  if (filter.sourceDomain) {
    chips.push({
      key: "domain",
      label: `Site: ${filter.sourceDomain}`,
      onClear: () => patchFilter({ sourceDomain: null }),
    });
  }
  if (filter.siteContains) {
    chips.push({
      key: "site",
      label: `Site contains “${filter.siteContains}”`,
      onClear: () => patchFilter({ siteContains: null }),
    });
  }
  if (filter.creatorContains) {
    chips.push({
      key: "creator",
      label: `Creator: ${filter.creatorContains}`,
      onClear: () => patchFilter({ creatorContains: null }),
    });
  }
  for (const tag of activeTags) {
    chips.push({
      key: `tag:${tag}`,
      label: tag,
      onClear: () =>
        patchFilter({ tags: activeTags.filter((item) => item !== tag) }),
    });
  }
  if (filter.color) {
    chips.push({
      key: "color",
      label: filter.color.hex,
      swatch: filter.color.hex,
      onClear: () => patchFilter({ color: null }),
    });
  }

  const resultLabel = `${resultCount.toLocaleString()} ${
    hasAnyFilter
      ? resultCount === 1
        ? "match"
        : "matches"
      : resultCount === 1
        ? "Fragment"
        : "Fragments"
  }`;

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
                    aria-label="Filter Fragments by format and orientation"
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

        <span aria-live="polite" className="v7-frame-result-count">
          {resultLabel}
        </span>
      </div>

      {hasAnyFilter ? (
        <div
          aria-label="Active filters"
          className="v7-frame-filter-chips"
          data-canvas-control
        >
          {chips.map((chip) => (
            <span className="v7-filter-chip" key={chip.key}>
              {chip.swatch ? (
                <span
                  aria-hidden="true"
                  className="v7-filter-chip-swatch"
                  style={{ backgroundColor: chip.swatch }}
                />
              ) : null}
              <span>{chip.label}</span>
              <button
                aria-label={`Remove filter ${chip.label}`}
                className="v7-filter-chip-clear"
                onClick={chip.onClear}
                type="button"
              >
                <X aria-hidden="true" size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          <button
            className="v7-filter-clear-all"
            onClick={clearAllFilters}
            type="button"
          >
            Clear filters
          </button>
        </div>
      ) : null}

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
        error={error}
        frameName={frameName}
        hasActiveFilters={hasAnyFilter}
        loading={loading}
        onClearFilters={clearAllFilters}
        onRetry={onRetry}
        resultCount={resultCount}
        {...galleryProps}
      />
      <PaginationFooter
        error={galleryProps.fragments.length > 0 ? error : null}
        hasMore={hasMore}
        loadedCount={galleryProps.fragments.length}
        loading={loading}
        onLoadMore={onLoadMore}
        onRetry={onRetry}
        totalCount={resultCount}
      />
    </FrameCanvas>
  );
}
