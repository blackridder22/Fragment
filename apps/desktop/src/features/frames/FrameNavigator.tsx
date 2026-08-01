import {
  Aperture,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  Images,
  Inbox,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Frame } from "@fragment/shared";
import type { RailView } from "../../components/IconRail";
import { flattenFrameTree } from "./frame-tree";

type FrameNavigatorProps = {
  activeView: RailView;
  collapsed: boolean;
  defaultFrameId: string | null;
  directCounts: ReadonlyMap<string, number>;
  dropTarget: string | null;
  expandedIds: ReadonlySet<string>;
  frames: Frame[];
  pinnedIds: ReadonlySet<string>;
  recursiveCounts: ReadonlyMap<string, number>;
  selectedFrameId: string | null;
  trashDropState: "idle" | "armed" | "success";
  width: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onCreateFrame: (parentId: string | null) => void;
  onDeleteFrame: (frame: Frame) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onRenameFrame: (frame: Frame, name: string) => Promise<void>;
  onSelectFrame: (frameId: string | null) => void;
  onToggleExpanded: (frameId: string) => void;
  onTogglePinned: (frameId: string) => void;
  onViewChange: (view: RailView) => void;
  onWidthChange: (width: number) => void;
};

type ContextMenuState = { frame: Frame; x: number; y: number } | null;

const primaryItems: Array<{
  id: RailView;
  label: string;
  icon: typeof Aperture;
}> = [
  { id: "home", label: "Vault", icon: Aperture },
  { id: "frames", label: "Frames", icon: Images },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "settings", label: "Settings", icon: Settings },
];

export function FrameNavigator({
  activeView,
  collapsed,
  defaultFrameId,
  directCounts,
  dropTarget,
  expandedIds,
  frames,
  pinnedIds,
  recursiveCounts,
  selectedFrameId,
  trashDropState,
  width,
  onCollapsedChange,
  onCreateFrame,
  onDeleteFrame,
  onPointerDown,
  onRenameFrame,
  onSelectFrame,
  onToggleExpanded,
  onTogglePinned,
  onViewChange,
  onWidthChange,
}: FrameNavigatorProps) {
  const [frameQuery, setFrameQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const cancelRenameRef = useRef(false);
  const rows = useMemo(
    () => flattenFrameTree(frames, expandedIds, frameQuery),
    [expandedIds, frameQuery, frames],
  );
  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );
  const pinnedFrames = [...pinnedIds]
    .map((id) => frameById.get(id))
    .filter((frame): frame is Frame => Boolean(frame));

  function countLabel(frameId: string) {
    const direct = directCounts.get(frameId) ?? 0;
    const recursive = recursiveCounts.get(frameId) ?? direct;
    return direct === recursive ? String(direct) : `${direct}/${recursive}`;
  }

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        contextMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [contextMenu]);

  function beginRename(frame: Frame) {
    if (frame.id === defaultFrameId) return;
    cancelRenameRef.current = false;
    setEditingId(frame.id);
    setEditingName(frame.name);
    setContextMenu(null);
  }

  async function commitRename(frame: Frame) {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === frame.name) return;
    await onRenameFrame(frame, name);
  }

  function handleTreeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    frame: Frame,
    hasChildren: boolean,
    expanded: boolean,
  ) {
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginRename(frame);
      return;
    }
    if (event.key === "ArrowRight" && hasChildren && !expanded) {
      event.preventDefault();
      onToggleExpanded(frame.id);
      return;
    }
    if (event.key === "ArrowLeft" && hasChildren && expanded) {
      event.preventDefault();
      onToggleExpanded(frame.id);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".frame-tree-main"),
      );
      const index = items.indexOf(event.currentTarget);
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[index + offset]?.focus();
    }
  }

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (collapsed || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: globalThis.PointerEvent) => {
      onWidthChange(
        Math.min(380, Math.max(220, startWidth + moveEvent.clientX - startX)),
      );
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      delete document.body.dataset.resizeActive;
    };
    document.body.dataset.resizeActive = "true";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }

  return (
    <aside
      aria-label="Frame Navigator"
      className="frame-navigator"
      data-collapsed={collapsed}
      onPointerDown={onPointerDown}
      style={{ width: collapsed ? 68 : width }}
    >
      <div className="frame-nav-brand">
        <img src="/Fragment.png" alt="" aria-hidden="true" />
        <div className="frame-nav-copy">
          <strong>Fragment</strong>
          <span>Auto Scale Agency</span>
        </div>
        <button
          aria-label={
            collapsed ? "Expand Frame Navigator" : "Collapse Frame Navigator"
          }
          className="frame-nav-icon-button"
          data-no-frame-drag="true"
          onClick={() => onCollapsedChange(!collapsed)}
          title={
            collapsed ? "Expand Frame Navigator" : "Collapse Frame Navigator"
          }
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
      </div>

      <nav className="frame-nav-primary" aria-label="Library">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isTrash = item.id === "trash";
          const isVault = item.id === "home";
          return (
            <button
              aria-current={activeView === item.id ? "page" : undefined}
              aria-label={item.label}
              className="frame-nav-primary-item"
              data-active={activeView === item.id}
              data-drop-state={
                isTrash
                  ? trashDropState
                  : isVault && dropTarget === "frame-root"
                    ? "armed"
                    : undefined
              }
              data-drop-target={
                isTrash ? "trash" : isVault ? "frame-root" : undefined
              }
              data-no-frame-drag="true"
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={item.label}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="frame-nav-expanded-content">
        {pinnedFrames.length > 0 ? (
          <section className="frame-nav-section frame-nav-quick-access">
            <div className="frame-nav-section-heading">
              <span>Quick Access</span>
            </div>
            {pinnedFrames.map((frame) => (
              <button
                className="frame-quick-row"
                data-active={
                  activeView === "home" && selectedFrameId === frame.id
                }
                data-drop-state={
                  dropTarget === `frame-tree:${frame.id}` ? "armed" : "idle"
                }
                data-drop-target={`frame-tree:${frame.id}`}
                data-frame-drag-id={frame.id}
                key={frame.id}
                onClick={() => onSelectFrame(frame.id)}
                type="button"
              >
                <Pin aria-hidden="true" size={13} />
                <span>{frame.name}</span>
                <small
                  aria-label={`${directCounts.get(frame.id) ?? 0} direct, ${recursiveCounts.get(frame.id) ?? 0} including Sub-frames`}
                >
                  {countLabel(frame.id)}
                </small>
              </button>
            ))}
          </section>
        ) : null}

        <section className="frame-nav-section frame-nav-tree-section">
          <div className="frame-nav-section-heading">
            <span>Frames</span>
            <button
              aria-label="New root Frame"
              data-no-frame-drag="true"
              onClick={() => onCreateFrame(null)}
              title="New root Frame"
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          <label className="frame-nav-search">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label="Search Frames"
              data-no-frame-drag="true"
              onChange={(event) => setFrameQuery(event.target.value)}
              placeholder="Find a Frame"
              value={frameQuery}
            />
          </label>

          <div className="frame-tree" role="tree" aria-label="Frames">
            {rows.map(
              ({ frame, depth, expanded, hasChildren, matchesQuery }) => {
                const protectedFrame = frame.id === defaultFrameId;
                const direct = directCounts.get(frame.id) ?? 0;
                const recursive = recursiveCounts.get(frame.id) ?? direct;
                const editing = editingId === frame.id;
                return (
                  <div
                    className="frame-tree-row"
                    data-active={
                      activeView === "home" && selectedFrameId === frame.id
                    }
                    data-frame-drag-id={frame.id}
                    data-match={matchesQuery}
                    key={frame.id}
                    style={{ "--frame-depth": depth } as CSSProperties}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        frame,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="frame-drop-line frame-drop-line-before"
                      data-drop-state={
                        dropTarget === `frame-before:${frame.id}`
                          ? "armed"
                          : "idle"
                      }
                      data-drop-target={`frame-before:${frame.id}`}
                    />
                    <button
                      aria-expanded={hasChildren ? expanded : undefined}
                      aria-label={
                        hasChildren
                          ? `${expanded ? "Collapse" : "Expand"} ${frame.name}`
                          : undefined
                      }
                      className="frame-tree-chevron"
                      data-no-frame-drag="true"
                      disabled={!hasChildren}
                      onClick={() => onToggleExpanded(frame.id)}
                      tabIndex={-1}
                      type="button"
                    >
                      {hasChildren ? (
                        expanded ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )
                      ) : (
                        <span />
                      )}
                    </button>
                    {editing ? (
                      <input
                        aria-label={`Rename ${frame.name}`}
                        autoFocus
                        className="frame-tree-rename"
                        data-no-frame-drag="true"
                        onBlur={() => void commitRename(frame)}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenameRef.current = true;
                            setEditingId(null);
                          }
                        }}
                        onFocus={(event) => event.currentTarget.select()}
                        value={editingName}
                      />
                    ) : (
                      <button
                        aria-level={depth + 1}
                        className="frame-tree-main"
                        data-drop-state={
                          dropTarget === `frame-tree:${frame.id}`
                            ? "armed"
                            : "idle"
                        }
                        data-drop-target={`frame-tree:${frame.id}`}
                        onClick={() => onSelectFrame(frame.id)}
                        onDoubleClick={() => beginRename(frame)}
                        onKeyDown={(event) =>
                          handleTreeKeyDown(event, frame, hasChildren, expanded)
                        }
                        role="treeitem"
                        title={`${direct} direct · ${recursive} including Sub-frames`}
                        type="button"
                      >
                        {protectedFrame ? (
                          <Inbox aria-hidden="true" size={15} />
                        ) : expanded && hasChildren ? (
                          <FolderOpen aria-hidden="true" size={15} />
                        ) : (
                          <Folder aria-hidden="true" size={15} />
                        )}
                        <span>{frame.name}</span>
                        <small
                          aria-label={`${direct} direct, ${recursive} including Sub-frames`}
                        >
                          {countLabel(frame.id)}
                        </small>
                      </button>
                    )}
                    <button
                      aria-label={`More actions for ${frame.name}`}
                      className="frame-tree-more"
                      data-no-frame-drag="true"
                      onClick={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          frame,
                          x: rect.right,
                          y: rect.bottom,
                        });
                      }}
                      type="button"
                    >
                      <MoreHorizontal aria-hidden="true" size={14} />
                    </button>
                    <span
                      aria-hidden="true"
                      className="frame-drop-line frame-drop-line-after"
                      data-drop-state={
                        dropTarget === `frame-after:${frame.id}`
                          ? "armed"
                          : "idle"
                      }
                      data-drop-target={`frame-after:${frame.id}`}
                    />
                  </div>
                );
              },
            )}
            {rows.length === 0 ? (
              <p className="frame-tree-empty">No matching Frames</p>
            ) : null}
          </div>
        </section>
      </div>

      <button
        className="frame-nav-collapse-footer"
        data-no-frame-drag="true"
        onClick={() => onCollapsedChange(!collapsed)}
        type="button"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        <span>{collapsed ? "" : "Collapse Navigator"}</span>
      </button>

      {!collapsed ? (
        <div
          aria-label="Resize Frame Navigator"
          className="frame-nav-resizer"
          data-no-frame-drag="true"
          onPointerDown={beginResize}
          role="separator"
        />
      ) : null}

      {contextMenu ? (
        <div
          className="frame-context-menu"
          ref={contextMenuRef}
          role="menu"
          style={{
            left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 228)),
            top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 176)),
          }}
        >
          <strong>{contextMenu.frame.name}</strong>
          <button
            onClick={() => {
              onCreateFrame(contextMenu.frame.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            New Sub-frame
          </button>
          {contextMenu.frame.id !== defaultFrameId ? (
            <button
              onClick={() => beginRename(contextMenu.frame)}
              role="menuitem"
              type="button"
            >
              Rename
            </button>
          ) : null}
          <button
            onClick={() => {
              onTogglePinned(contextMenu.frame.id);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            {pinnedIds.has(contextMenu.frame.id)
              ? "Remove from Quick Access"
              : "Pin to Quick Access"}
          </button>
          {contextMenu.frame.id !== defaultFrameId ? (
            <button
              className="danger"
              onClick={() => {
                onDeleteFrame(contextMenu.frame);
                setContextMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              Move to Trash
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
