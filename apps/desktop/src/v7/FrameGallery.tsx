import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ImageOff } from "lucide-react";
import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "../lib/assets";
import type { BrowsingDensity } from "../features/library/BrowsingModeControl";
import { registerSelectableRects } from "../features/selection/selection-geometry";
import { GalleryEmptyState } from "./GalleryEmptyState";
import {
  columnCountFor,
  columnWidthFor,
  gridRowHeightFor,
  MASONRY_GAP,
  placeMasonry,
  type MasonryLayout,
  type MasonryPlacement,
} from "./masonry-layout";
import {
  measureGalleryTop,
  toWindow,
  useGalleryWindow,
} from "./useGalleryWindow";
import {
  scrollTopToReveal,
  windowRange,
  windowedIndices,
} from "./virtual-window";
import "../styles/v7-gallery.css";

export type V7GalleryLayout = "masonry" | "grid";

export type V7AssetSourcesFor = (fragment: Fragment) => AssetSource[];
export type V7FolderNameFor = (fragment: Fragment) => string;
export type V7AssetFallback = (relativePath: string) => Promise<string | null>;

export type FrameGalleryProps = {
  fragments: Fragment[];
  assetSourcesFor: V7AssetSourcesFor;
  density?: BrowsingDensity;
  folderNameFor: V7FolderNameFor;
  layout: V7GalleryLayout;
  resultCount?: number;
  selectedIds: Set<string>;
  /** Name of the open Frame, used by the empty state copy. */
  frameName?: string | null;
  hasActiveFilters?: boolean;
  loading?: boolean;
  /** Message shown when the first page failed to load. */
  error?: string | null;
  onAssetFallback?: V7AssetFallback;
  onClearFilters?: () => void;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onOpen: (fragment: Fragment) => void;
  onRetry?: () => void;
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
  "--v7-enter-delay"?: string;
};

export type V7FrameCardProps = {
  assetSources: AssetSource[];
  className?: string;
  /** Short boxes keep their title hidden until hovered so the image shows whole. */
  compact?: boolean;
  /** Grid cells crop to a uniform box; masonry boxes match the image. */
  cropped?: boolean;
  /** Milliseconds to wait before the card fades in after a page append. */
  enterDelay?: number | null;
  folderName: string;
  fragment: Fragment;
  index?: number;
  onAssetFallback?: V7AssetFallback;
  onContextMenu: (fragment: Fragment, event: MouseEvent<HTMLElement>) => void;
  onOpen: (fragment: Fragment) => void;
  onSelect: (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) => void;
  selected: boolean;
  setSize?: number;
  style?: V7FrameCardStyle;
  variant?: "gallery" | "vault";
};

type AssetLoadState = "pending" | "loaded" | "instant";

type AppendMarker = {
  from: number;
  until: number;
  length: number;
  firstId: string | undefined;
};

/** Column math before measurement; the layout effect corrects it before paint. */
const ASSUMED_WIDTH = 1072;
const ENTER_STAGGER_MS = 20;
const ENTER_STAGGER_CAP = 8;
const ENTER_WINDOW_MS = 1000;
/** Below this height the title bar would hide most of the image. */
const COMPACT_CARD_HEIGHT = 128;
const EMPTY_INDICES: readonly number[] = [];
const EMPTY_LAYOUT = placeMasonry([], {
  mode: "masonry",
  columnCount: 1,
  columnWidth: ASSUMED_WIDTH,
  gap: MASONRY_GAP,
});

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

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

export function toneFor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % 7;
}

function titleFor(fragment: Fragment) {
  return fragment.title?.trim() || "Untitled Fragment";
}

const placementStyles = new WeakMap<MasonryPlacement, V7FrameCardStyle>();

/** Placement objects are reused across appends, so their styles can be too. */
function placementStyle(
  placement: MasonryPlacement,
  mode: V7GalleryLayout,
): V7FrameCardStyle {
  let style = placementStyles.get(placement);
  if (!style) {
    style =
      mode === "grid"
        ? {
            left: placement.left,
            top: placement.top,
            width: placement.width,
            height: placement.height,
          }
        : {
            left: placement.left,
            top: placement.top,
            width: placement.width,
            aspectRatio: `${placement.ratio}`,
          };
    placementStyles.set(placement, style);
  }
  return style;
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
  const [loadState, setLoadState] = useState<AssetLoadState>("pending");
  const imageRef = useRef<HTMLImageElement>(null);
  const attemptedFallbacks = useRef(new Set<string>());
  const assetKey = assetSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const resetKey = `${fragment.id}\u0001${assetKey}`;
  const [appliedKey, setAppliedKey] = useState(resetKey);

  if (appliedKey !== resetKey) {
    setAppliedKey(resetKey);
    setSourceIndex(0);
    setFallbackUrl(null);
    setFailed(assetSources.length === 0);
    setLoadState("pending");
    attemptedFallbacks.current.clear();
  }

  const source = assetSources[sourceIndex];
  const displayUrl = fallbackUrl ?? source?.url ?? "";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image && image.complete && image.naturalWidth > 0) {
      setLoadState("instant");
    }
  }, [displayUrl]);

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
      data-loaded={loadState}
      decoding="async"
      draggable={false}
      loading="lazy"
      onError={() => void handleError()}
      onLoad={() =>
        setLoadState((current) => (current === "instant" ? current : "loaded"))
      }
      ref={imageRef}
      src={displayUrl}
    />
  );
}

export const V7FrameCard = memo(function V7FrameCard({
  assetSources,
  className = "",
  compact = false,
  cropped = false,
  enterDelay,
  folderName,
  fragment,
  index,
  onAssetFallback,
  onContextMenu,
  onOpen,
  onSelect,
  selected,
  setSize,
  style,
  variant = "gallery",
}: V7FrameCardProps) {
  const title = titleFor(fragment);
  const cardStyle: V7FrameCardStyle | undefined =
    enterDelay === null || enterDelay === undefined
      ? style
      : { ...style, "--v7-enter-delay": `${enterDelay}ms` };

  return (
    <article
      aria-label={`${title} in ${folderName}`}
      aria-posinset={index === undefined ? undefined : index + 1}
      aria-setsize={index === undefined ? undefined : setSize}
      className={`fragment-card v7-frame-card ${className}`.trim()}
      data-compact={compact || undefined}
      data-cropped={cropped || undefined}
      data-enter={
        enterDelay === null || enterDelay === undefined ? undefined : "true"
      }
      data-fragment-id={fragment.id}
      data-selected={selected}
      data-tone={toneFor(fragment.id)}
      data-variant={variant}
      onContextMenu={(event) => onContextMenu(fragment, event)}
      role={index === undefined ? undefined : "listitem"}
      style={cardStyle}
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
        title={
          cropped
            ? "Cropped to fit the grid. Open the Fragment to see it whole."
            : undefined
        }
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
  fragments,
  assetSourcesFor,
  density = "comfortable",
  folderNameFor,
  layout: mode,
  resultCount,
  selectedIds,
  frameName,
  hasActiveFilters = false,
  loading = false,
  error = null,
  onAssetFallback,
  onClearFilters,
  onContextMenu,
  onOpen,
  onRetry,
  onSelect,
}: FrameGalleryProps) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<MasonryLayout>(EMPTY_LAYOUT);
  const mountedRef = useRef<readonly number[]>(EMPTY_INDICES);
  const previousLayoutRef = useRef<MasonryLayout | null>(null);
  const hasItems = fragments.length > 0;
  const { metrics, container } = useGalleryWindow(
    galleryRef,
    layoutRef,
    mountedRef,
    hasItems,
  );

  const width = metrics.width > 0 ? metrics.width : ASSUMED_WIDTH;
  const columnCount = columnCountFor(width, density);
  const columnWidth = columnWidthFor(width, columnCount);
  const rowHeight = gridRowHeightFor(density);

  const masonry = useMemo(() => {
    const next = placeMasonry(
      fragments,
      {
        mode,
        columnCount,
        columnWidth,
        gap: MASONRY_GAP,
        rowHeight: mode === "grid" ? rowHeight : undefined,
      },
      previousLayoutRef.current,
    );
    previousLayoutRef.current = next;
    return next;
  }, [columnCount, columnWidth, fragments, mode, rowHeight]);

  const mounted = useMemo(
    () => windowedIndices(masonry.items, windowRange(toWindow(metrics))),
    [masonry, metrics],
  );

  useLayoutEffect(() => {
    layoutRef.current = masonry;
  }, [masonry]);

  useLayoutEffect(() => {
    mountedRef.current = mounted;
  }, [mounted]);

  // Newly appended page items fade in with a short stagger; nothing else moves.
  const [appendMarker, setAppendMarker] = useState<AppendMarker>({
    from: Number.POSITIVE_INFINITY,
    until: 0,
    length: fragments.length,
    firstId: fragments[0]?.id,
  });
  if (
    appendMarker.length !== fragments.length ||
    appendMarker.firstId !== fragments[0]?.id
  ) {
    const appended =
      fragments.length > appendMarker.length &&
      appendMarker.length > 0 &&
      fragments[0]?.id === appendMarker.firstId;
    setAppendMarker({
      from: appended ? appendMarker.length : Number.POSITIVE_INFINITY,
      until: appended ? now() + ENTER_WINDOW_MS : 0,
      length: fragments.length,
      firstId: fragments[0]?.id,
    });
  }

  // Cards are memoized: callbacks and asset source arrays keep their identity.
  const handlers = useRef({ onAssetFallback, onContextMenu, onOpen, onSelect });
  useLayoutEffect(() => {
    handlers.current = { onAssetFallback, onContextMenu, onOpen, onSelect };
  });
  const handleOpen = useCallback(
    (fragment: Fragment) => handlers.current.onOpen(fragment),
    [],
  );
  const handleSelect = useCallback(
    (fragment: Fragment, event: MouseEvent<HTMLButtonElement>) =>
      handlers.current.onSelect(fragment, event),
    [],
  );
  const handleContextMenu = useCallback(
    (fragment: Fragment, event: MouseEvent<HTMLElement>) =>
      handlers.current.onContextMenu(fragment, event),
    [],
  );
  const handleAssetFallback = useCallback(
    (relativePath: string) =>
      handlers.current.onAssetFallback?.(relativePath) ?? Promise.resolve(null),
    [],
  );

  const sourcesCache = useRef(
    new Map<string, { signature: string; sources: AssetSource[] }>(),
  );
  useEffect(() => {
    const ids = new Set(fragments.map((fragment) => fragment.id));
    for (const id of sourcesCache.current.keys()) {
      if (!ids.has(id)) sourcesCache.current.delete(id);
    }
  }, [fragments]);
  const stableSourcesFor = (fragment: Fragment): AssetSource[] => {
    const sources = assetSourcesFor(fragment);
    const signature = sources
      .map((source) => `${source.url}\u0000${source.relativePath ?? ""}`)
      .join("\u0001");
    const cached = sourcesCache.current.get(fragment.id);
    if (cached && cached.signature === signature) {
      return cached.sources;
    }
    sourcesCache.current.set(fragment.id, { signature, sources });
    return sources;
  };

  // The marquee reads geometry from here so unmounted cards stay selectable.
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!container || !gallery) return;
    return registerSelectableRects(container, () => {
      const rect = gallery.getBoundingClientRect();
      return layoutRef.current.items.map((placement) => ({
        id: placement.id,
        left: rect.left + placement.left,
        right: rect.left + placement.left + placement.width,
        top: rect.top + placement.top,
        bottom: rect.top + placement.top + placement.height,
      }));
    });
  }, [container]);

  // Keyboard navigation can select a card that is not mounted; bring it into view.
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!container || !gallery || selectedIds.size !== 1) return;
    const id = selectedIds.values().next().value;
    const placement = layoutRef.current.items.find((item) => item.id === id);
    if (!placement || mountedRef.current.includes(placement.index)) return;
    const top = scrollTopToReveal(placement, {
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      galleryTop: measureGalleryTop(gallery, container),
    });
    if (top !== null) {
      container.scrollTo({ top, behavior: "auto" });
    }
  }, [container, selectedIds]);

  const accessibleCount = resultCount ?? fragments.length;

  if (!hasItems) {
    return (
      <GalleryEmptyState
        error={error}
        frameName={frameName}
        hasActiveFilters={hasActiveFilters}
        loading={loading}
        onClearFilters={onClearFilters}
        onRetry={onRetry}
      />
    );
  }

  const enterActive = appendMarker.until > now();

  return (
    <div
      aria-label={`${accessibleCount.toLocaleString()} Fragments`}
      className="v7-frame-gallery"
      data-density={density}
      data-layout={mode}
      data-virtual="true"
      ref={galleryRef}
      role="list"
      style={{ height: masonry.height }}
    >
      {mounted.map((index) => {
        const placement = masonry.items[index];
        const fragment = fragments[index];
        if (!placement || !fragment) return null;
        const enterDelay =
          enterActive && index >= appendMarker.from
            ? Math.min(index - appendMarker.from, ENTER_STAGGER_CAP - 1) *
              ENTER_STAGGER_MS
            : undefined;
        return (
          <V7FrameCard
            assetSources={stableSourcesFor(fragment)}
            compact={placement.height < COMPACT_CARD_HEIGHT}
            cropped={mode === "grid"}
            enterDelay={enterDelay}
            folderName={folderNameFor(fragment)}
            fragment={fragment}
            index={index}
            key={fragment.id}
            onAssetFallback={onAssetFallback ? handleAssetFallback : undefined}
            onContextMenu={handleContextMenu}
            onOpen={handleOpen}
            onSelect={handleSelect}
            selected={selectedIds.has(fragment.id)}
            setSize={fragments.length}
            style={placementStyle(placement, mode)}
          />
        );
      })}
    </div>
  );
}
