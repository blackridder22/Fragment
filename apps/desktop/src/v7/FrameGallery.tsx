import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Check, ImageOff } from "lucide-react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../lib/assets";
import { perfMarkOnce } from "../lib/perf";
import type { GalleryCard } from "../store/library-selectors";
import type { BrowsingDensity } from "../store/library-types";
import "../styles/v7-gallery.css";

export type V7GalleryLayout = "masonry" | "grid";
export type V7AssetFallback = (relativePath: string) => Promise<string | null>;
export type { GalleryCard } from "../store/library-selectors";

export type FrameGalleryProps = {
  /** Page items with asset sources and folder name precomputed by the store. */
  items: GalleryCard[];
  density?: BrowsingDensity;
  layout: V7GalleryLayout;
  resultCount?: number;
  selectedIds: ReadonlySet<string>;
  onAssetFallback?: V7AssetFallback;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onOpen: (fragment: Fragment) => void;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
};

export type FrameCanvasProps = {
  children: ReactNode;
  className: string;
  density?: BrowsingDensity;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
};

type V7AssetImageProps = {
  assetSources: AssetSource[];
  className: string;
  decorative?: boolean;
  fragment: Fragment;
  onAssetFallback?: V7AssetFallback;
  tone?: number;
};

type V7FrameCardStyle = CSSProperties & {
  "--v7-card-height"?: string;
  "--v7-card-weight"?: number;
  "--v7-recent-ratio"?: number;
  "--v7-stagger-index"?: number;
};

export type V7FrameCardProps = {
  assetSources: AssetSource[];
  className?: string;
  folderName: string;
  fragment: Fragment;
  /** Masonry card height in px; a primitive so the memoized card stays stable. */
  height?: number;
  /** Flex weight for the home page rows. */
  weight?: number;
  /** Aspect ratio in a justified "Recently added" row (width / height). */
  ratio?: number;
  /** First-paint stagger slot; omitted after the intro window. */
  stagger?: number;
  onAssetFallback?: V7AssetFallback;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onOpen: (fragment: Fragment) => void;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
  selected: boolean;
  variant?: "gallery" | "vault";
};

export function FrameCanvas({
  children,
  className,
  density = "comfortable",
  onPointerDown,
}: FrameCanvasProps) {
  return (
    <main
      className={`${className} v7-frame-canvas`}
      data-density={density}
      data-frame-canvas="true"
      onPointerDown={onPointerDown}
    >
      {children}
    </main>
  );
}

type MasonryItem = {
  card: GalleryCard;
  height: number;
};

const PAPER_MASONRY_HEIGHTS = [
  [285, 195, 240],
  [200, 299, 222],
  [232, 221, 267],
  [232, 278, 209],
  [236, 214, 270],
] as const;

function toneFor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 7;
}

function titleFor(fragment: Fragment) {
  return fragment.title?.trim() || "Untitled Fragment";
}

const MASONRY_COLUMN_COUNTS: Record<BrowsingDensity, number> = {
  compact: 6,
  comfortable: 5,
  large: 4,
};

const MASONRY_HEIGHT_SCALE: Record<BrowsingDensity, number> = {
  compact: 0.78,
  comfortable: 1,
  large: 1.24,
};

function masonryColumns(items: GalleryCard[], density: BrowsingDensity) {
  const columns: MasonryItem[][] = Array.from(
    { length: MASONRY_COLUMN_COUNTS[density] },
    () => [],
  );

  items.forEach((card, index) => {
    const columnIndex = index % columns.length;
    const rowIndex = Math.floor(index / columns.length);
    const pattern =
      PAPER_MASONRY_HEIGHTS[columnIndex % PAPER_MASONRY_HEIGHTS.length];
    const height = Math.round(
      pattern[rowIndex % pattern.length] * MASONRY_HEIGHT_SCALE[density],
    );
    columns[columnIndex]!.push({ card, height });
  });

  return columns;
}

function markFirstThumbnail() {
  perfMarkOnce("first-thumbnail-load");
}

export function V7AssetImage({
  assetSources,
  className,
  decorative = false,
  fragment,
  onAssetFallback,
  tone = toneFor(fragment.id),
}: V7AssetImageProps) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(assetSources.length === 0);
  const attemptedFallbacks = useRef(new Set<string>());
  const assetKey = assetSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const source = assetSources[sourceIndex];
  const displayUrl = fallbackUrl ?? source?.url ?? "";

  useEffect(() => {
    setSourceIndex(0);
    setFallbackUrl(null);
    setFailed(assetSources.length === 0);
    attemptedFallbacks.current.clear();
  }, [assetKey, assetSources.length, fragment.id]);

  async function handleError() {
    const relativePath = source?.relativePath;
    if (
      relativePath &&
      onAssetFallback &&
      !attemptedFallbacks.current.has(relativePath)
    ) {
      attemptedFallbacks.current.add(relativePath);
      try {
        const resolved = await onAssetFallback(relativePath);
        if (resolved && resolved !== displayUrl) {
          setFallbackUrl(resolved);
          return;
        }
      } catch {
        // Continue through the remaining sources before showing a fallback.
      }
    }

    setFallbackUrl(null);
    if (sourceIndex + 1 < assetSources.length) {
      setSourceIndex((current) => current + 1);
    } else {
      setFailed(true);
    }
  }

  if (failed || !displayUrl) {
    return (
      <span
        aria-hidden={decorative || undefined}
        className={`${className} v7-asset-fallback`}
        data-tone={tone}
      >
        {decorative ? null : <ImageOff aria-hidden="true" size={22} />}
      </span>
    );
  }

  return (
    <img
      alt={decorative ? "" : titleFor(fragment)}
      aria-hidden={decorative || undefined}
      className={className}
      decoding="async"
      draggable={false}
      loading="lazy"
      onError={() => void handleError()}
      onLoad={markFirstThumbnail}
      src={displayUrl}
    />
  );
}

/**
 * One card. Memoized: it re-renders only when its own primitive props or the
 * stable item references change, never because the gallery around it did.
 */
export const V7FrameCard = memo(function V7FrameCard({
  assetSources,
  className = "",
  folderName,
  fragment,
  height,
  weight,
  ratio,
  stagger,
  onAssetFallback,
  onContextMenu,
  onOpen,
  onSelect,
  selected,
  variant = "gallery",
}: V7FrameCardProps) {
  const title = titleFor(fragment);
  const style = useMemo<V7FrameCardStyle | undefined>(() => {
    if (
      height === undefined &&
      weight === undefined &&
      ratio === undefined &&
      stagger === undefined
    ) {
      return undefined;
    }
    const next: V7FrameCardStyle = {};
    if (height !== undefined) next["--v7-card-height"] = `${height}px`;
    if (weight !== undefined) next["--v7-card-weight"] = weight;
    if (ratio !== undefined) next["--v7-recent-ratio"] = ratio;
    if (stagger !== undefined) next["--v7-stagger-index"] = stagger;
    return next;
  }, [height, weight, ratio, stagger]);

  return (
    <article
      aria-label={`${title} in ${folderName}`}
      className={`fragment-card v7-frame-card ${className}`.trim()}
      data-fragment-id={fragment.id}
      data-selected={selected}
      data-tone={toneFor(fragment.id)}
      data-variant={variant}
      onContextMenu={(event) => onContextMenu(fragment, event)}
      style={style}
    >
      <button
        aria-label={`${selected ? "Selected: " : ""}${title}. Click to preview; Shift-click to ${selected ? "deselect" : "select"}.`}
        aria-pressed={selected}
        className="v7-frame-card-action"
        data-fragment-id={fragment.id}
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            onSelect(fragment, event);
            return;
          }
          onOpen(fragment);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onOpen(fragment);
          }
        }}
        type="button"
      >
        <V7AssetImage
          assetSources={assetSources}
          className="v7-frame-image"
          fragment={fragment}
          onAssetFallback={onAssetFallback}
        />

        <span className="v7-frame-meta">
          <strong className="v7-frame-meta-title">{title}</strong>
          <span className="v7-frame-meta-folder">{folderName}</span>
        </span>

        <span aria-hidden="true" className="v7-frame-selected-indicator">
          <Check size={14} strokeWidth={2.25} />
        </span>
      </button>
    </article>
  );
});

export function FrameGallery({
  items,
  density = "comfortable",
  layout,
  resultCount,
  selectedIds,
  onAssetFallback,
  onContextMenu,
  onOpen,
  onSelect,
}: FrameGalleryProps) {
  const columns = useMemo(
    () => (layout === "masonry" ? masonryColumns(items, density) : []),
    [density, items, layout],
  );
  const accessibleCount = resultCount ?? items.length;

  if (items.length === 0) {
    return (
      <div className="v7-gallery-empty" role="status">
        <ImageOff aria-hidden="true" size={24} />
        <strong>No Fragments yet</strong>
        <span>Import an image or save one from Capture Mode.</span>
      </div>
    );
  }

  return (
    <div
      aria-label={`${accessibleCount.toLocaleString()} Fragments`}
      className="v7-frame-gallery"
      data-density={density}
      data-layout={layout}
      role="list"
    >
      {layout === "masonry"
        ? columns.map((column, columnIndex) => (
            <div
              className="v7-masonry-column"
              key={`column-${columnIndex}`}
              role="presentation"
            >
              {column.map(({ card, height }) => (
                <V7FrameCard
                  assetSources={card.assetSources}
                  folderName={card.folderName}
                  fragment={card.fragment}
                  height={height}
                  key={card.fragment.id}
                  onAssetFallback={onAssetFallback}
                  onContextMenu={onContextMenu}
                  onOpen={onOpen}
                  onSelect={onSelect}
                  selected={selectedIds.has(card.fragment.id)}
                />
              ))}
            </div>
          ))
        : items.map((card) => (
            <V7FrameCard
              assetSources={card.assetSources}
              folderName={card.folderName}
              fragment={card.fragment}
              key={card.fragment.id}
              onAssetFallback={onAssetFallback}
              onContextMenu={onContextMenu}
              onOpen={onOpen}
              onSelect={onSelect}
              selected={selectedIds.has(card.fragment.id)}
            />
          ))}
    </div>
  );
}
