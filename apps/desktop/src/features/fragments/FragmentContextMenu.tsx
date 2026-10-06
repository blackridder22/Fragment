import {
  Clipboard,
  Command,
  Delete,
  ExternalLink,
  Eye,
  FolderPlus,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Fragment, Frame } from "@fragment/shared";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  matchesShortcut,
  type ShortcutBinding,
} from "../shortcuts/shortcut-model";
import {
  clampContextMenuPosition,
  type ContextMenuPosition,
} from "./context-menu-position";

export type FragmentContextMenuState = {
  fragment: Fragment;
  fragmentIds: string[];
  x: number;
  y: number;
  layer?: "base" | "overlay";
};

type FragmentContextMenuProps = FragmentContextMenuState & {
  frames: Frame[];
  canUseNativeActions: boolean;
  canTrash: boolean;
  onAddToFrame: (frameId: string) => void;
  onClose: () => void;
  onCopy: () => void;
  onOpen: () => void;
  onOpenSource?: () => void;
  onReveal: () => void;
  onTrash: () => void;
  closeShortcut?: ShortcutBinding;
};

export function FragmentContextMenu({
  fragment,
  fragmentIds,
  frames,
  x,
  y,
  layer = "base",
  canUseNativeActions,
  canTrash,
  onAddToFrame,
  onClose,
  onCopy,
  onOpen,
  onOpenSource,
  onReveal,
  onTrash,
  closeShortcut = DEFAULT_SHORTCUT_BINDINGS.closeOverlay,
}: FragmentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const positionMenu = () => {
      const bounds = menu.getBoundingClientRect();
      setPosition(
        clampContextMenuPosition({
          x,
          y,
          menuWidth: bounds.width,
          menuHeight: bounds.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        }),
      );
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(positionMenu);
    resizeObserver?.observe(menu);

    return () => {
      window.removeEventListener("resize", positionMenu);
      resizeObserver?.disconnect();
    };
  }, [x, y]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      if (
        layer === "overlay" &&
        event.target instanceof Element &&
        event.target.closest(".v7-focused-more")
      ) {
        return;
      }
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (matchesShortcut(event, closeShortcut)) {
        event.preventDefault();
        onClose();
      }
    };
    const closeOnScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      onClose();
    };

    const capturePointer = layer === "base";
    window.addEventListener("pointerdown", close, capturePointer);
    window.addEventListener("keydown", escape);
    if (layer === "base") {
      window.addEventListener("scroll", closeOnScroll, true);
    }
    return () => {
      window.removeEventListener("pointerdown", close, capturePointer);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [closeShortcut, layer, onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      className="fragment-context-menu"
      data-layer={layer}
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: position?.left ?? x,
        top: position?.top ?? y,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <header>
        <ImageIcon aria-hidden="true" size={16} />
        <div>
          <strong>
            {fragmentIds.length > 1
              ? `${fragmentIds.length} Fragments`
              : (fragment.title ?? "Untitled Fragment")}
          </strong>
          <span>{fragmentIds.length > 1 ? "Selection" : "Fragment"}</span>
        </div>
      </header>
      {fragmentIds.length === 1 ? (
        <button onClick={() => run(onOpen)} role="menuitem" type="button">
          <Eye aria-hidden="true" size={16} /> Open Preview <kbd>Enter</kbd>
        </button>
      ) : null}
      {fragmentIds.length === 1 ? (
        <button
          disabled={!canUseNativeActions}
          onClick={() => run(onCopy)}
          role="menuitem"
          type="button"
        >
          <Clipboard aria-hidden="true" size={16} /> Copy Image
          <kbd aria-label="Command C">
            <Command aria-hidden="true" size={12} />
            <span>C</span>
          </kbd>
        </button>
      ) : null}
      {fragmentIds.length === 1 && onOpenSource ? (
        <button onClick={() => run(onOpenSource)} role="menuitem" type="button">
          <ExternalLink aria-hidden="true" size={16} /> Open Source
        </button>
      ) : null}
      {fragmentIds.length === 1 ? (
        <button
          disabled={!canUseNativeActions}
          onClick={() => run(onReveal)}
          role="menuitem"
          type="button"
        >
          <Eye aria-hidden="true" size={16} /> Reveal Original
        </button>
      ) : null}
      <div className="fragment-context-divider" />
      <div className="fragment-context-submenu">
        <span>
          <FolderPlus aria-hidden="true" size={14} /> Add to Frame
        </span>
        <div>
          {frames.map((frame) => (
            <button
              key={frame.id}
              onClick={() => run(() => onAddToFrame(frame.id))}
              role="menuitem"
              type="button"
            >
              {frame.name}
            </button>
          ))}
        </div>
      </div>
      {canTrash ? (
        <>
          <div className="fragment-context-divider" />
          <button
            className="danger"
            onClick={() => run(onTrash)}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} /> Move to Trash
            <kbd aria-label="Delete">
              <Delete aria-hidden="true" size={16} />
            </kbd>
          </button>
        </>
      ) : null}
    </div>
  );
}
