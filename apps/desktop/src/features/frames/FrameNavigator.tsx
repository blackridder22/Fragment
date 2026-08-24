import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Search,
  Sparkles,
  X,
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
import { IconRail, type RailView } from "../../components/IconRail";
import { flattenFrameTree } from "./frame-tree";
import type { SmartFrame } from "../filters/filter-model";

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
  selectedSmartFrameId: string | null;
  smartFrames: SmartFrame[];
  trashDropState: "idle" | "armed" | "success";
  width: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onCreateFrame: (parentId: string | null) => void;
  onDeleteFrame: (frame: Frame) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onRenameFrame: (frame: Frame, name: string) => Promise<void>;
  onSelectFrame: (frameId: string | null) => void;
  onSelectSmartFrame: (smartFrameId: string) => void;
  onDeleteSmartFrame: (smartFrame: SmartFrame) => void;
  onToggleExpanded: (frameId: string) => void;
  onTogglePinned: (frameId: string) => void;
  onViewChange: (view: RailView) => void;
  onWidthChange: (width: number) => void;
};

type ContextMenuState = { frame: Frame; x: number; y: number } | null;

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
  selectedSmartFrameId,
  smartFrames,
  trashDropState,
  width,
  onCollapsedChange,
  onCreateFrame,
  onDeleteFrame,
  onPointerDown,
  onRenameFrame,
  onSelectFrame,
  onSelectSmartFrame,
  onDeleteSmartFrame,
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
      aria-label="Fragment Navigator"
      className="frame-sidebar"
      data-collapsed={collapsed}
      onPointerDown={onPointerDown}
      style={{ width: collapsed ? 64 : width }}
    >
      <IconRail
        activeView={activeView}
        dropTarget={dropTarget}
        onViewChange={onViewChange}
        trashDropState={trashDropState}
      />

      {!collapsed ? (
        <section className="frame-navigator" aria-label="Fragment tree">
          <header className="frame-tree-panel-header">
            <div>
              <span>Your library</span>
              <strong>Fragments</strong>
            </div>
            <button
              aria-label="New root Fragment"
              className="frame-nav-icon-button"
              data-no-frame-drag="true"
              onClick={() => onCreateFrame(null)}
              title="New root Fragment"
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
            </button>
          </header>

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
                      aria-label={`${directCounts.get(frame.id) ?? 0} direct, ${recursiveCounts.get(frame.id) ?? 0} including nested Fragments`}
                    >
                      {countLabel(frame.id)}
                    </small>
                  </button>
                ))}
              </section>
            ) : null}

            {smartFrames.length > 0 ? (
              <section className="frame-nav-section smart-frame-section">
                <div className="frame-nav-section-heading">
                  <span>Smart Fragments</span>
                  <Sparkles aria-hidden="true" size={13} />
                </div>
                <div className="smart-frame-list">
                  {smartFrames.map((smartFrame) => (
                    <div
                      className="smart-frame-row"
                      data-active={selectedSmartFrameId === smartFrame.id}
                      key={smartFrame.id}
                    >
                      <button
                        onClick={() => onSelectSmartFrame(smartFrame.id)}
                        title="Dynamic filtered Fragment"
                        type="button"
                      >
                        <Sparkles aria-hidden="true" size={14} />
                        <span>{smartFrame.name}</span>
                      </button>
                      <button
                        aria-label={`Delete ${smartFrame.name}`}
                        className="smart-frame-delete"
                        onClick={() => onDeleteSmartFrame(smartFrame)}
                        title="Delete Smart Fragment"
                        type="button"
                      >
                        <X aria-hidden="true" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="frame-nav-section frame-nav-tree-section">
              <div className="frame-nav-section-heading">
                <span>Fragments</span>
                <button
                  aria-label="New root Fragment"
                  data-no-frame-drag="true"
                  onClick={() => onCreateFrame(null)}
                  title="New root Fragment"
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                </button>
              </div>
              <label className="frame-nav-search">
                <Search aria-hidden="true" size={14} />
                <input
                  aria-label="Search Fragments"
                  data-no-frame-drag="true"
                  onChange={(event) => setFrameQuery(event.target.value)}
                  placeholder="Find a Fragment"
                  value={frameQuery}
                />
              </label>

              <div className="frame-tree" role="tree" aria-label="Fragments">
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
                            onChange={(event) =>
                              setEditingName(event.target.value)
                            }
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
                              handleTreeKeyDown(
                                event,
                                frame,
                                hasChildren,
                                expanded,
                              )
                            }
                            role="treeitem"
                            title={`${direct} direct · ${recursive} including nested Fragments`}
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
                              aria-label={`${direct} direct, ${recursive} including nested Fragments`}
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
                  <p className="frame-tree-empty">No matching Fragments</p>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <div className="sidebar-footer">
        <button
          aria-label={collapsed ? "Show Fragments" : "Hide Fragments"}
          className="rail-button rail-navigator-toggle"
          data-no-frame-drag="true"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? "Show Fragments" : "Hide Fragments"}
          type="button"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={1.9} />
          ) : (
            <PanelLeftClose aria-hidden="true" size={19} strokeWidth={1.9} />
          )}
          <span>{collapsed ? "Show Fragments" : "Hide Fragments"}</span>
        </button>
      </div>

      {!collapsed ? (
        <div
          aria-label="Resize Fragment Navigator"
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
            New nested Fragment
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
