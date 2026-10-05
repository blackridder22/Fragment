import type { Fragment } from "@fragment/shared";
import { ImageOff } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { SvgPreview } from "../features/fragments/SvgPreview";
import type { AssetSource } from "../lib/assets";
import {
  FIT_VIEW,
  MAX_ZOOM,
  clampPan,
  clampZoom,
  displayPercent,
  fitWithin,
  nativeZoom,
  wheelZoomFactor,
  zoomAt,
  type Point,
  type Size,
  type ViewState,
} from "./preview-geometry";
import {
  prefersReducedMotion,
  readDurationToken,
  type Rect,
} from "./preview-motion";
import type { PreviewPerfSession } from "./preview-perf";
import type { PreviewPrefetcher } from "./preview-prefetch";

export type FocusedPreviewStageProps = {
  fragment: Fragment;
  title: string;
  assetRoot: string;
  assetSources: AssetSource[];
  thumbnailSources: AssetSource[];
  prefetchSources: string[];
  prefetcher: PreviewPrefetcher;
  perfRef: MutableRefObject<PreviewPerfSession | null>;
  originRect: Rect | null;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
};

type LoadPhase = {
  url: string;
  state: "ready" | "settled";
  instant: boolean;
};

type GestureLike = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

const ZOOM_EPSILON = 0.001;

function positiveSize(
  width: number | null | undefined,
  height: number | null | undefined,
): Size | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * The image area of the focused preview. Paints the already decoded gallery
 * thumbnail at the final size immediately, loads the preview behind it and
 * cross-fades once it has decoded, then warms the neighbouring previews. Raster
 * images also support wheel or pinch zoom with drag-to-pan.
 */
export function FocusedPreviewStage({
  fragment,
  title,
  assetRoot,
  assetSources,
  thumbnailSources,
  prefetchSources,
  prefetcher,
  perfRef,
  originRect,
  onAssetFallback,
}: FocusedPreviewStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const attemptedFallbacks = useRef(new Set<string>());
  const prefetchSourcesRef = useRef<string[]>(prefetchSources);
  const dragRef = useRef<{
    pointerId: number;
    origin: Point;
    pan: Point;
  } | null>(null);
  const gestureZoomRef = useRef<number | null>(null);
  const flipDone = useRef(false);

  const [assetIndex, setAssetIndex] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(assetSources.length === 0);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [phase, setPhase] = useState<LoadPhase | null>(null);
  const [lastReadyUrl, setLastReadyUrl] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState<Size | null>(null);
  const [view, setView] = useState<ViewState>(FIT_VIEW);
  const [animateView, setAnimateView] = useState(false);
  const [dragging, setDragging] = useState(false);

  const assetKey = useMemo(
    () =>
      assetSources
        .map((source) => `${source.url}\u0000${source.relativePath ?? ""}`)
        .join("\u0001"),
    [assetSources],
  );
  const isSvg = fragment.mimeType === "image/svg+xml" && Boolean(assetRoot);
  const activeSource = assetSources[assetIndex];
  const previewUrl = fallbackUrl ?? activeSource?.url ?? "";
  const thumbUrl =
    thumbnailSources.find((source) => source.url && source.url !== previewUrl)
      ?.url ?? null;
  const imageSize = positiveSize(fragment.width, fragment.height);
  const fit = stageSize ? fitWithin(stageSize, imageSize) : null;
  const native = fit ? nativeZoom(fit, imageSize) : 1;
  const maxZoom = Math.max(MAX_ZOOM, native);
  const percent = fit ? displayPercent(fit, imageSize, view.zoom) : null;
  const zoomed = view.zoom > 1 + ZOOM_EPSILON;

  const current: LoadPhase | null =
    phase && phase.url === previewUrl
      ? phase
      : previewUrl && prefetcher.isReady(previewUrl)
        ? { url: previewUrl, state: "settled", instant: true }
        : null;
  const fullReady = current !== null;
  const showThumb =
    Boolean(thumbUrl) && !thumbFailed && current?.state !== "settled";
  // Keeps the last decoded preview on screen while the next one loads, so
  // arrow navigation never paints an empty stage even without a thumbnail.
  const previousUrl =
    !fullReady && lastReadyUrl && lastReadyUrl !== previewUrl
      ? lastReadyUrl
      : null;

  const viewRef = useRef(view);
  const fitRef = useRef(fit);
  const stageSizeRef = useRef(stageSize);
  const maxZoomRef = useRef(maxZoom);
  useLayoutEffect(() => {
    viewRef.current = view;
    fitRef.current = fit;
    stageSizeRef.current = stageSize;
    maxZoomRef.current = maxZoom;
    prefetchSourcesRef.current = prefetchSources;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    attemptedFallbacks.current.clear();
    setAssetIndex(0);
    setFallbackUrl(null);
    setUnavailable(assetSources.length === 0);
    setThumbFailed(false);
  }, [assetKey, assetSources.length, fragment.id]);

  useEffect(() => {
    setView(FIT_VIEW);
    setAnimateView(false);
  }, [fragment.id]);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setStageSize((previous) =>
        previous &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stageSize || !fit) return;
    setView((previous) => {
      const pan = clampPan(previous.pan, fit, previous.zoom, stageSize);
      return pan.x === previous.pan.x && pan.y === previous.pan.y
        ? previous
        : { zoom: previous.zoom, pan };
    });
  }, [stageSize?.width, stageSize?.height, fit?.width, fit?.height]);

  // Pin the preview on the stage; a prefetched one paints this frame.
  useEffect(() => {
    if (!previewUrl || isSvg) return;
    prefetcher.markCurrent(previewUrl);
    if (!prefetcher.isReady(previewUrl)) return;
    const frame = requestAnimationFrame(() => {
      perfRef.current?.markFirstPixels("cached");
      perfRef.current?.markPreviewDecoded();
    });
    prefetcher.prefetch(prefetchSourcesRef.current);
    return () => cancelAnimationFrame(frame);
  }, [previewUrl, isSvg, prefetcher, perfRef]);

  const currentUrl = current?.url ?? null;
  const currentState = current?.state ?? null;
  useEffect(() => {
    if (currentUrl && currentState) setLastReadyUrl(currentUrl);
  }, [currentUrl, currentState]);

  // Drop the thumbnail once the cross-fade has finished.
  useEffect(() => {
    if (!currentUrl || currentState !== "ready") return;
    const fade = stageRef.current
      ? readDurationToken(stageRef.current, "--preview-dur-fast")
      : 120;
    const timer = window.setTimeout(() => {
      setPhase((previous) =>
        previous && previous.url === currentUrl && previous.state === "ready"
          ? { ...previous, state: "settled" }
          : previous,
      );
    }, fade + 40);
    return () => window.clearTimeout(timer);
  }, [currentUrl, currentState]);

  // Stretch: FLIP the image box from the gallery card it was opened from.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (flipDone.current || !originRect || !fit || !box) return;
    flipDone.current = true;
    const duration = readDurationToken(box, "--preview-dur-base");
    if (
      duration <= 0 ||
      prefersReducedMotion() ||
      typeof box.animate !== "function"
    ) {
      return;
    }
    const target = box.getBoundingClientRect();
    if (target.width < 1 || target.height < 1) return;
    const dx = originRect.x - target.left;
    const dy = originRect.y - target.top;
    const sx = originRect.width / target.width;
    const sy = originRect.height / target.height;
    if (![dx, dy, sx, sy].every(Number.isFinite)) return;
    const easing =
      getComputedStyle(box).getPropertyValue("--preview-ease-out").trim() ||
      "cubic-bezier(0.22, 1, 0.36, 1)";
    box.animate(
      [
        {
          transformOrigin: "0 0",
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        },
        {
          transformOrigin: "0 0",
          transform: "translate(0px, 0px) scale(1, 1)",
        },
      ],
      { duration, easing, fill: "none" },
    );
  }, [originRect, fit?.width, fit?.height]);

  const applyView = useCallback(
    (nextZoom: number, pointer: Point, animate: boolean) => {
      const fitSize = fitRef.current;
      const stage = stageSizeRef.current;
      if (!fitSize || !stage) return;
      const next = zoomAt(
        viewRef.current,
        clampZoom(nextZoom, maxZoomRef.current),
        pointer,
      );
      const clamped: ViewState = {
        zoom: next.zoom,
        pan: clampPan(next.pan, fitSize, next.zoom, stage),
      };
      viewRef.current = clamped;
      setView(clamped);
      setAnimateView(animate);
    },
    [],
  );

  const pointerFrom = useCallback(
    (event: { clientX?: number; clientY?: number }) => {
      const element = stageRef.current;
      if (!element || typeof event.clientX !== "number") return { x: 0, y: 0 };
      const rect = element.getBoundingClientRect();
      return {
        x: event.clientX - (rect.left + rect.width / 2),
        y: (event.clientY ?? 0) - (rect.top + rect.height / 2),
      };
    },
    [],
  );

  // Wheel and WebKit pinch gestures need non-passive listeners.
  useEffect(() => {
    const element = stageRef.current;
    if (!element || isSvg) return;
    const onWheel = (event: WheelEvent) => {
      if (!fitRef.current) return;
      event.preventDefault();
      applyView(
        viewRef.current.zoom * wheelZoomFactor(event.deltaY, event.deltaMode),
        pointerFrom(event),
        false,
      );
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureZoomRef.current = viewRef.current.zoom;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureLike;
      if (
        gestureZoomRef.current === null ||
        typeof gesture.scale !== "number"
      ) {
        return;
      }
      applyView(
        gestureZoomRef.current * gesture.scale,
        pointerFrom(gesture),
        false,
      );
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureZoomRef.current = null;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    element.addEventListener("gestureend", onGestureEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.removeEventListener("gestureend", onGestureEnd);
    };
  }, [applyView, isSvg, pointerFrom]);

  function handleThumbLoad() {
    requestAnimationFrame(() => perfRef.current?.markFirstPixels("thumbnail"));
  }

  function handleFullLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const url = previewUrl;
    const wasInstant = current?.instant === true;
    const decoded =
      typeof image.decode === "function" ? image.decode() : Promise.resolve();
    void decoded
      .catch(() => undefined)
      .then(() => {
        if (!mounted.current) return;
        setPhase((previous) =>
          previous && previous.url === url
            ? previous
            : {
                url,
                state: wasInstant ? "settled" : "ready",
                instant: wasInstant,
              },
        );
        perfRef.current?.markPreviewDecoded();
        prefetcher.markCurrent(url);
        prefetcher.prefetch(prefetchSourcesRef.current);
      });
  }

  async function handleFullError() {
    const key = `${fragment.id}:${assetIndex}:${activeSource?.relativePath ?? ""}`;
    if (
      activeSource?.relativePath &&
      onAssetFallback &&
      !attemptedFallbacks.current.has(key)
    ) {
      attemptedFallbacks.current.add(key);
      try {
        const resolved = await onAssetFallback(activeSource.relativePath);
        if (resolved && resolved !== previewUrl && mounted.current) {
          setFallbackUrl(resolved);
          return;
        }
      } catch {
        // Continue through the remaining sources before giving up.
      }
    }
    if (!mounted.current) return;
    if (assetIndex + 1 < assetSources.length) {
      setAssetIndex((index) => index + 1);
      setFallbackUrl(null);
      return;
    }
    setUnavailable(true);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!zoomed || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      pan: viewRef.current.pan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setAnimateView(false);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const fitSize = fitRef.current;
    const stage = stageSizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !fitSize || !stage) {
      return;
    }
    const zoom = viewRef.current.zoom;
    const pan = clampPan(
      {
        x: drag.pan.x + event.clientX - drag.origin.x,
        y: drag.pan.y + event.clientY - drag.origin.y,
      },
      fitSize,
      zoom,
      stage,
    );
    viewRef.current = { zoom, pan };
    setView(viewRef.current);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function toggleZoom(pointer: Point) {
    if (zoomed) applyView(1, { x: 0, y: 0 }, true);
    else if (native > 1 + ZOOM_EPSILON) applyView(native, pointer, true);
  }

  const boxStyle = {
    width: fit ? fit.width : "100%",
    height: fit ? fit.height : "100%",
    transform:
      zoomed || view.pan.x !== 0 || view.pan.y !== 0
        ? `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom})`
        : undefined,
  };

  return (
    <div
      className="v7-focused-image-stage"
      data-dragging={dragging}
      data-zoomed={zoomed}
      onDoubleClick={(event) => {
        if (isSvg || unavailable || !imageSize) return;
        toggleZoom(pointerFrom(event));
      }}
      ref={stageRef}
    >
      {isSvg ? (
        <SvgPreview
          assetRoot={assetRoot}
          fragment={fragment}
          initialUrl={previewUrl}
          key={fragment.id}
          onDecoded={() => perfRef.current?.markPreviewDecoded()}
          onFirstPixels={() => perfRef.current?.markFirstPixels("thumbnail")}
          thumbnailUrl={thumbUrl}
        />
      ) : unavailable ? (
        <div className="v7-focused-image-fallback" role="status">
          <ImageOff aria-hidden="true" size={30} strokeWidth={1.6} />
          <strong>Preview unavailable</strong>
          <span>The original Fragment could not be displayed.</span>
        </div>
      ) : (
        <div
          className="v7-focused-image-box"
          data-animate={animateView}
          data-ready={fullReady}
          onPointerCancel={endDrag}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          ref={boxRef}
          style={boxStyle}
        >
          {previousUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="v7-focused-image-previous"
              decoding="async"
              draggable={false}
              key={previousUrl}
              src={previousUrl}
            />
          ) : null}
          {showThumb && thumbUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="v7-focused-image-thumb"
              decoding="async"
              draggable={false}
              key={thumbUrl}
              onError={() => setThumbFailed(true)}
              onLoad={handleThumbLoad}
              src={thumbUrl}
            />
          ) : null}
          <img
            alt={title}
            className="v7-focused-image-full"
            data-instant={current?.instant ?? false}
            data-ready={fullReady}
            decoding="async"
            draggable={false}
            key={previewUrl}
            onError={() => void handleFullError()}
            onLoad={handleFullLoad}
            src={previewUrl}
          />
        </div>
      )}

      {!isSvg && !unavailable && imageSize ? (
        <div
          aria-label="Zoom"
          className="v7-focused-zoom"
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          role="group"
        >
          <button
            aria-pressed={!zoomed}
            onClick={() => applyView(1, { x: 0, y: 0 }, true)}
            type="button"
          >
            Fit
          </button>
          <button
            aria-pressed={zoomed && Math.abs(view.zoom - native) < 0.01}
            disabled={native <= 1 + ZOOM_EPSILON}
            onClick={() => applyView(native, { x: 0, y: 0 }, true)}
            type="button"
          >
            100%
          </button>
          <output aria-label="Current zoom">
            {percent !== null ? `${percent}%` : "—"}
          </output>
        </div>
      ) : null}
    </div>
  );
}
