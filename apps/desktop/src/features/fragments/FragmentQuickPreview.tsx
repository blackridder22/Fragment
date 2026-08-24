import { ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../../lib/assets";
import { formatLabel, sourceDomain } from "./fragment-metadata";

type FragmentQuickPreviewProps = {
  assetSources: AssetSource[];
  fragment: Fragment;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onClose: () => void;
};

export function FragmentQuickPreview({
  assetSources,
  fragment,
  onAssetFallback,
  onClose,
}: FragmentQuickPreviewProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(assetSources.length === 0);
  const source = assetSources[index];

  useEffect(() => {
    setIndex(0);
    setFailed(assetSources.length === 0);
  }, [assetSources, fragment.id]);

  async function handleError() {
    if (source?.relativePath && onAssetFallback) {
      const fallback = await onAssetFallback(source.relativePath);
      if (fallback) return;
    }
    if (index + 1 < assetSources.length) setIndex((current) => current + 1);
    else setFailed(true);
  }

  return (
    <div
      className="quick-preview-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label={`Quick Preview: ${fragment.title ?? "Frame"}`}
        className="quick-preview"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{fragment.title ?? "Untitled Frame"}</strong>
            <span>
              {formatLabel(fragment.mimeType, fragment.originalPath)}
              {fragment.width && fragment.height
                ? ` · ${fragment.width} × ${fragment.height}`
                : ""}
              {sourceDomain(fragment.sourceUrl ?? fragment.pageUrl)
                ? ` · ${sourceDomain(fragment.sourceUrl ?? fragment.pageUrl)}`
                : ""}
            </span>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="quick-preview-image">
          {failed ? (
            <span>
              <ImageOff aria-hidden="true" size={28} />
              Preview unavailable
            </span>
          ) : (
            <img
              alt={fragment.title ?? "Frame preview"}
              onError={() => void handleError()}
              src={source?.url ?? ""}
            />
          )}
        </div>
        <footer>Release Space to close · Enter opens full preview</footer>
      </section>
    </div>
  );
}
