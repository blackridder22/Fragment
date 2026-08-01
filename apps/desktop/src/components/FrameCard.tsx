import type { Fragment, Frame } from "@fragment/shared";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { AssetSource } from "../lib/assets";

type FrameCardProps = {
  frame: Frame;
  fragments: Fragment[];
  assetFor: (fragment: Fragment) => AssetSource;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  readonly?: boolean;
  protectedFrame?: boolean;
};

export function FrameCard({
  frame,
  fragments,
  assetFor,
  onOpen,
  onRename,
  onDelete,
  onAssetFallback,
  protectedFrame = false,
  readonly = false,
}: FrameCardProps) {
  const covers = fragments.slice(0, 4);
  const draggable = !readonly && !protectedFrame;
  return (
    <article
      className="frame-card"
      data-draggable={draggable}
      data-frame-drag-id={draggable ? frame.id : undefined}
      onDoubleClick={onOpen}
    >
      <button className="frame-card-cover" onClick={onOpen} type="button">
        {covers.length > 0 ? (
          <div className="frame-collage">
            {covers.map((fragment) => {
              const asset = assetFor(fragment);
              return (
                <img
                  alt={fragment.title ?? "Fragment thumbnail"}
                  data-transparent={isTransparentAsset(fragment)}
                  draggable={false}
                  key={fragment.id}
                  loading="lazy"
                  onError={() => {
                    if (asset.relativePath) {
                      void onAssetFallback?.(asset.relativePath);
                    }
                  }}
                  src={asset.url}
                />
              );
            })}
          </div>
        ) : (
          <div className="empty-cover" aria-hidden="true">
            <MoreHorizontal size={28} />
          </div>
        )}
      </button>
      <div className="frame-card-footer">
        <button className="frame-title-button" onClick={onOpen} type="button">
          <strong>{frame.name}</strong>
          <span>
            {fragments.length} Fragments
            {protectedFrame ? " · Protected" : ""}
          </span>
        </button>
        {protectedFrame ? (
          <span className="frame-protected-badge">System</span>
        ) : null}
        {!readonly && !protectedFrame ? (
          <div className="frame-card-actions">
            <button
              className="icon-button small"
              onClick={onRename}
              title="Rename Frame"
              type="button"
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button small danger"
              onClick={onDelete}
              title="Delete Frame"
              type="button"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function isTransparentAsset(fragment: Fragment) {
  const mimeType = fragment.mimeType?.toLowerCase() ?? "";
  const originalPath = fragment.originalPath.toLowerCase();
  return (
    mimeType.includes("png") ||
    (!fragment.id.startsWith("demo-") && originalPath.endsWith(".png"))
  );
}
