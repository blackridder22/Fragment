import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Folder,
  FolderPlus,
  Images,
  LayoutGrid,
  ListFilter,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { Frame } from "@fragment/shared";
import type {
  BrowsingDensity,
  BrowsingLayout,
} from "../features/library/BrowsingModeControl";
import type { SortMode } from "../components/TopCommandBar";

export type V7View = "home" | "frames" | "trash" | "settings";

type DesktopShellProps = {
  activeView: V7View;
  children: ReactNode;
  expandedIds: ReadonlySet<string>;
  frameCounts: ReadonlyMap<string, number>;
  frames: Frame[];
  frameTotal: number;
  pageActions?: ReactNode;
  pageSubtitle: string;
  pageTitle: string;
  showPageBar?: boolean;
  query: string;
  searchShortcutLabel?: string;
  selectedFrameId: string | null;
  showFragmentTree: boolean;
  showMockWindowControls: boolean;
  dropTarget?: string | null;
  trashDropState?: "idle" | "armed" | "success";
  trashTotal: number;
  onBack: () => void;
  onCreateFragment: (parentId: string | null) => void;
  onForward?: () => void;
  onImportFrames: () => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onQueryChange: (query: string) => void;
  onSelectFrame: (frameId: string | null) => void;
  onToggleExpanded: (frameId: string) => void;
  onViewChange: (view: V7View) => void;
};

export function DesktopShell({
  activeView,
  children,
  expandedIds,
  frameCounts,
  frames,
  frameTotal,
  pageActions,
  pageSubtitle,
  pageTitle,
  showPageBar = true,
  query,
  searchShortcutLabel = "⌘ K",
  selectedFrameId,
  showFragmentTree,
  showMockWindowControls,
  dropTarget = null,
  trashDropState = "idle",
  trashTotal,
  onBack,
  onCreateFragment,
  onForward,
  onImportFrames,
  onPointerDown,
  onQueryChange,
  onSelectFrame,
  onToggleExpanded,
  onViewChange,
}: DesktopShellProps) {
  const [addOpen, setAddOpen] = useState(false);
  const rows = useMemo(
    () => flattenFrameRows(frames, expandedIds),
    [expandedIds, frames],
  );

  return (
    <div
      className="v7-app"
      style={{ "--app-sidebar-width": "241px" } as CSSProperties}
    >
      <header className="v7-window-bar" data-tauri-drag-region>
        <div className="v7-window-identity" data-tauri-drag-region>
          {showMockWindowControls ? (
            <div className="v7-window-lights" aria-hidden="true">
              <span className="v7-window-light v7-window-light-close" />
              <span className="v7-window-light v7-window-light-minimize" />
              <span className="v7-window-light v7-window-light-zoom" />
            </div>
          ) : (
            <span className="v7-native-lights-space" aria-hidden="true" />
          )}
          <strong>Fragment</strong>
        </div>

        <div className="v7-global-commands" data-tauri-drag-region>
          <nav className="v7-history-controls" aria-label="Navigation history">
            <button aria-label="Back" onClick={onBack} type="button">
              <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <button
              aria-label="Forward"
              disabled={!onForward}
              onClick={onForward}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </nav>

          <label className="v7-global-search">
            <Search aria-hidden="true" size={14} strokeWidth={1.8} />
            <input
              aria-label="Search Frames, Fragments, and tags"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search Frames, Fragments, tags…"
              value={query}
            />
            <kbd>{searchShortcutLabel}</kbd>
          </label>

          <div className="v7-window-actions">
            <div className="v7-add-control">
              <button
                aria-expanded={addOpen}
                className="v7-primary-button"
                onClick={() => setAddOpen((open) => !open)}
                type="button"
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
                <span>Add</span>
                <ChevronDown aria-hidden="true" size={12} strokeWidth={1.8} />
              </button>
              {addOpen ? (
                <div className="v7-add-menu" role="menu">
                  <button
                    onClick={() => {
                      setAddOpen(false);
                      onCreateFragment(selectedFrameId);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="v7-add-menu-icon" aria-hidden="true">
                      <FolderPlus size={16} />
                    </span>
                    <span>
                      <strong>New Fragment</strong>
                      <small>Create a folder for Frames</small>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setAddOpen(false);
                      onImportFrames();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="v7-add-menu-icon" aria-hidden="true">
                      <Images size={16} />
                    </span>
                    <span>
                      <strong>Import Frames</strong>
                      <small>Add images from this Mac</small>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="v7-app-body">
        <aside className="v7-sidebar" onPointerDown={onPointerDown}>
          <nav className="v7-primary-nav" aria-label="Primary navigation">
            <SidebarNavRow
              active={activeView === "home"}
              dropState={dropTarget === "frame-root" ? "armed" : "idle"}
              dropTarget="frame-root"
              icon={<Folder aria-hidden="true" size={16} strokeWidth={1.7} />}
              label="Your Vault"
              onClick={() => onViewChange("home")}
            />
            <SidebarNavRow
              active={activeView === "frames"}
              count={frameTotal}
              icon={<Images aria-hidden="true" size={16} strokeWidth={1.7} />}
              label="Frames"
              onClick={() => onViewChange("frames")}
            />
            <SidebarNavRow
              active={activeView === "trash"}
              count={trashTotal}
              dropState={trashDropState}
              dropTarget="trash"
              icon={<Trash2 aria-hidden="true" size={16} strokeWidth={1.7} />}
              label="Trash"
              onClick={() => onViewChange("trash")}
            />
            <SidebarNavRow
              active={activeView === "settings"}
              icon={<Settings aria-hidden="true" size={16} strokeWidth={1.7} />}
              label="Settings"
              onClick={() => onViewChange("settings")}
            />
          </nav>

          {showFragmentTree ? (
            <section className="v7-fragment-nav" aria-label="Fragments">
              <header>
                <span>Fragments</span>
                <button
                  aria-label="New Fragment"
                  onClick={() => onCreateFragment(null)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={13} strokeWidth={1.5} />
                </button>
              </header>
              <div className="v7-fragment-tree">
                {rows.map(({ frame, depth, hasChildren }) => (
                  <button
                    aria-current={
                      selectedFrameId === frame.id ? "page" : undefined
                    }
                    className="v7-fragment-row"
                    data-active={selectedFrameId === frame.id}
                    data-drop-state={
                      dropTarget === `frame-tree:${frame.id}` ? "armed" : "idle"
                    }
                    data-drop-target={`frame-tree:${frame.id}`}
                    data-frame-drag-id={frame.id}
                    key={frame.id}
                    onClick={() => onSelectFrame(frame.id)}
                    style={{ paddingLeft: `${8 + depth * 18}px` }}
                    type="button"
                  >
                    <span
                      className="v7-tree-chevron"
                      data-no-frame-drag
                      onClick={(event) => {
                        if (!hasChildren) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleExpanded(frame.id);
                      }}
                    >
                      {hasChildren ? (
                        <ChevronRight
                          aria-hidden="true"
                          data-expanded={expandedIds.has(frame.id)}
                          size={13}
                          strokeWidth={1.7}
                        />
                      ) : null}
                    </span>
                    <span className="v7-folder-icon" data-depth={depth}>
                      <Folder
                        aria-hidden="true"
                        fill="currentColor"
                        size={16}
                        strokeWidth={0}
                      />
                    </span>
                    <span className="v7-fragment-name">{frame.name}</span>
                    <span className="v7-fragment-count">
                      {frameCounts.get(frame.id) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </aside>

        <main className="v7-workspace">
          {showPageBar ? (
            <header className="v7-page-bar">
              <div className="v7-page-title">
                <h1>{pageTitle}</h1>
                <span>{pageSubtitle}</span>
              </div>
              {pageActions ? (
                <div className="v7-page-actions">{pageActions}</div>
              ) : null}
            </header>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

type SidebarNavRowProps = {
  active: boolean;
  count?: number;
  dropState?: "idle" | "armed" | "success";
  dropTarget?: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function SidebarNavRow({
  active,
  count,
  dropState,
  dropTarget,
  icon,
  label,
  onClick,
}: SidebarNavRowProps) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className="v7-sidebar-row"
      data-active={active}
      data-drop-state={dropState}
      data-drop-target={dropTarget}
      onClick={onClick}
      type="button"
    >
      <span className="v7-sidebar-icon">{icon}</span>
      <span className="v7-sidebar-label">{label}</span>
      <span className="v7-sidebar-count">
        {count && count > 0 ? count : ""}
      </span>
      {active ? <span className="v7-active-rail" aria-hidden="true" /> : null}
    </button>
  );
}

type LibraryToolbarProps = {
  density: BrowsingDensity;
  layout: BrowsingLayout;
  sortMode: SortMode;
  onDensityChange: (density: BrowsingDensity) => void;
  onLayoutChange: (layout: BrowsingLayout) => void;
  onSortChange: (mode: SortMode) => void;
};

const densityValues: BrowsingDensity[] = ["compact", "comfortable", "large"];
const sortValues: SortMode[] = ["newest", "oldest", "name", "largest"];

export function LibraryToolbar({
  density,
  layout,
  sortMode,
  onDensityChange,
  onLayoutChange,
  onSortChange,
}: LibraryToolbarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const densityIndex = Math.max(0, densityValues.indexOf(density));
  const commitDensity = (value: string) => {
    const nextDensity = densityValues[Number(value)] ?? "comfortable";
    if (nextDensity !== density) onDensityChange(nextDensity);
  };
  const commitDensityAtPointer = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const progress = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width),
    );
    const nextIndex = Math.round(progress * (densityValues.length - 1));
    const nextDensity = densityValues[nextIndex] ?? "comfortable";
    if (nextDensity !== density) onDensityChange(nextDensity);
  };

  return (
    <>
      <label
        className="v7-density-control"
        aria-label="Canvas zoom"
        title="Canvas zoom"
      >
        <SlidersHorizontal aria-hidden="true" size={14} strokeWidth={1.7} />
        <input
          aria-label="Canvas zoom"
          max={2}
          min={0}
          onChange={(event) => commitDensity(event.currentTarget.value)}
          onClick={(event) => commitDensity(event.currentTarget.value)}
          onInput={(event) => commitDensity(event.currentTarget.value)}
          onKeyUp={(event) => commitDensity(event.currentTarget.value)}
          onPointerDown={commitDensityAtPointer}
          step={1}
          type="range"
          value={densityIndex}
        />
      </label>
      <div className="v7-layout-switch" aria-label="Frame layout" role="group">
        <button
          aria-label="Masonry view"
          aria-pressed={layout !== "grid"}
          data-active={layout !== "grid"}
          onClick={() => onLayoutChange("masonry")}
          type="button"
        >
          <Columns3 aria-hidden="true" size={14} strokeWidth={1.7} />
        </button>
        <button
          aria-label="Grid view"
          aria-pressed={layout === "grid"}
          data-active={layout === "grid"}
          onClick={() => onLayoutChange("grid")}
          type="button"
        >
          <LayoutGrid aria-hidden="true" size={14} strokeWidth={1.7} />
        </button>
      </div>
      <div className="v7-sort-control">
        <button
          aria-expanded={sortOpen}
          onClick={() => setSortOpen((open) => !open)}
          type="button"
        >
          <ListFilter aria-hidden="true" size={14} strokeWidth={1.7} />
          <span>Sort</span>
          <ChevronDown aria-hidden="true" size={12} strokeWidth={1.7} />
        </button>
        {sortOpen ? (
          <div className="v7-sort-menu" role="menu">
            {sortValues.map((mode) => (
              <button
                data-active={sortMode === mode}
                key={mode}
                onClick={() => {
                  onSortChange(mode);
                  setSortOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                {mode === "newest"
                  ? "Newest"
                  : mode === "oldest"
                    ? "Oldest"
                    : mode === "name"
                      ? "Name"
                      : "Largest"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function flattenFrameRows(
  frames: Frame[],
  expandedIds: ReadonlySet<string>,
): Array<{ frame: Frame; depth: number; hasChildren: boolean }> {
  const byParent = new Map<string | null, Frame[]>();
  for (const frame of frames) {
    const siblings = byParent.get(frame.parentId) ?? [];
    siblings.push(frame);
    byParent.set(frame.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
  }
  const rows: Array<{ frame: Frame; depth: number; hasChildren: boolean }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const frame of byParent.get(parentId) ?? []) {
      const children = byParent.get(frame.id) ?? [];
      rows.push({ frame, depth, hasChildren: children.length > 0 });
      if (children.length > 0 && expandedIds.has(frame.id)) {
        visit(frame.id, depth + 1);
      }
    }
  };
  visit(null, 0);
  return rows;
}
