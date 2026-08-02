import {
  Clipboard,
  ExternalLink,
  Eye,
  FolderPlus,
  Image as ImageIcon,
  Trash2,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { Fragment, Frame } from "@fragment/shared";

export type FragmentContextMenuState = {
  fragment: Fragment;
  fragmentIds: string[];
  x: number;
  y: number;
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
};

export function FragmentContextMenu({
  fragment,
  fragmentIds,
  frames,
  x,
  y,
  canUseNativeActions,
  canTrash,
  onAddToFrame,
  onClose,
  onCopy,
  onOpen,
  onOpenSource,
  onReveal,
  onTrash,
}: FragmentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      className="fragment-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 276)),
        top: Math.max(8, Math.min(y, window.innerHeight - 430)),
      }}
    >
      <header>
        <ImageIcon aria-hidden="true" size={15} />
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
          <Eye aria-hidden="true" size={15} /> Open Preview <kbd>Enter</kbd>
        </button>
      ) : null}
      {fragmentIds.length === 1 ? (
        <button
          disabled={!canUseNativeActions}
          onClick={() => run(onCopy)}
          role="menuitem"
          type="button"
        >
          <Clipboard aria-hidden="true" size={15} /> Copy Image <kbd>⌘C</kbd>
        </button>
      ) : null}
      {fragmentIds.length === 1 && onOpenSource ? (
        <button onClick={() => run(onOpenSource)} role="menuitem" type="button">
          <ExternalLink aria-hidden="true" size={15} /> Open Source
        </button>
      ) : null}
      {fragmentIds.length === 1 ? (
        <button
          disabled={!canUseNativeActions}
          onClick={() => run(onReveal)}
          role="menuitem"
          type="button"
        >
          <Eye aria-hidden="true" size={15} /> Reveal Original
        </button>
      ) : null}
      <div className="fragment-context-divider" />
      <div className="fragment-context-submenu">
        <span><FolderPlus aria-hidden="true" size={14} /> Add to Frame</span>
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
            disabled={!canUseNativeActions}
            onClick={() => run(onTrash)}
            role="menuitem"
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} /> Move to Trash <kbd>⌫</kbd>
          </button>
        </>
      ) : null}
    </div>
  );
}
