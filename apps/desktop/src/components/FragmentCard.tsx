import { useEffect, useState, type MouseEvent } from "react";
import type { Fragment } from "@fragment/shared";
import { Check, ImageOff, Maximize2 } from "lucide-react";
import type { AssetSource } from "../lib/assets";

type FragmentCardProps = {
  fragment: Fragment;
  assetSources: AssetSource[];
  selected: boolean;
  selectionActive?: boolean;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function FragmentCard({
  fragment,
  assetSources,
  selectionActive = false,
  selected,
  onAssetFallback,
  onSelect,
}: FragmentCardProps) {
  const [displayIndex, setDisplayIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(assetSources.length === 0);
  const assetKey = assetSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const displaySource = assetSources[displayIndex];
  const displayUrl = displaySource?.url ?? "";

  useEffect(() => {
    setDisplayIndex(0);
    setImageFailed(assetSources.length === 0);
  }, [assetKey, assetSources.length]);

  async function handleImageError() {
    if (displaySource?.relativePath && onAssetFallback) {
      const fallbackUrl = await onAssetFallback(displaySource.relativePath);
      if (fallbackUrl) {
        return;
      }
    }
    if (displayIndex + 1 < assetSources.length) {
      setDisplayIndex((current) => current + 1);
      return;
    }
    setImageFailed(true);
  }

  const aspectRatio =
    fragment.width && fragment.height
      ? `${fragment.width} / ${fragment.height}`
      : undefined;
  const transparentAsset = isTransparentAsset(fragment);

  return (
    <article
      className="fragment-card"
      data-fragment-id={fragment.id}
      data-selected={selected}
      data-transparent={transparentAsset}
    >
      <button
        aria-label={`${selected ? "Deselect" : selectionActive ? "Select" : "Open"} ${fragment.title ?? "Fragment"}`}
        aria-pressed={selected}
        className="fragment-image-button"
        data-fragment-id={fragment.id}
        onClick={onSelect}
        style={aspectRatio ? { aspectRatio } : undefined}
        type="button"
      >
        {imageFailed ? (
          <span className="fragment-image-fallback" style={{ aspectRatio }}>
            <ImageOff size={22} />
            <strong>{fragment.title ?? "Fragment"}</strong>
          </span>
        ) : (
          <img
            alt={fragment.title ?? "Saved Fragment"}
            decoding="async"
            draggable={false}
            loading="lazy"
            onError={handleImageError}
            src={displayUrl}
            style={{ aspectRatio }}
          />
        )}
        <span className="fragment-hover">
          <span>
            <Maximize2 size={16} />
            Open
          </span>
        </span>
        <span className="fragment-select-indicator" aria-hidden="true">
          <Check size={14} />
        </span>
      </button>
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
