import { createPortal } from "react-dom";
import { Images } from "lucide-react";
import type { PointerDragSession } from "./usePointerDragSession";

type DragGhostProps = {
  session: PointerDragSession | null;
};

export function DragGhost({ session }: DragGhostProps) {
  if (!session) {
    return null;
  }
  const { payload, x, y } = session;
  const count = payload.kind === "fragments" ? payload.ids.length : 1;
  return createPortal(
    <div
      aria-hidden="true"
      className="drag-ghost"
      style={{ transform: `translate3d(${x + 12}px, ${y + 12}px, 0)` }}
    >
      <div className="drag-ghost-stack">
        {payload.imageUrls.slice(0, 3).map((url, index) => (
          <img
            alt=""
            className="drag-ghost-image"
            key={`${url}-${index}`}
            src={url}
          />
        ))}
        {payload.imageUrls.length === 0 ? (
          <span className="drag-ghost-placeholder">
            <Images size={22} />
          </span>
        ) : null}
      </div>
      <strong>{payload.label}</strong>
      {count > 1 ? <span className="drag-ghost-badge">{count}</span> : null}
    </div>,
    document.body,
  );
}
