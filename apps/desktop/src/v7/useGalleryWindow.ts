import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { MasonryLayout } from "./masonry-layout";
import {
  overscanFor,
  sameIndices,
  windowRange,
  windowedIndices,
  type ViewportWindow,
} from "./virtual-window";

export type GalleryMetrics = {
  /** Inner width of the gallery element. */
  width: number;
  scrollTop: number;
  viewportHeight: number;
  /** Distance from the top of the scroll content to the gallery. */
  galleryTop: number;
};

const INITIAL_VIEWPORT_HEIGHT = 900;

export const INITIAL_METRICS: GalleryMetrics = {
  width: 0,
  scrollTop: 0,
  viewportHeight: 0,
  galleryTop: 0,
};

export function findScrollContainer(element: HTMLElement): HTMLElement {
  const canvas = element.closest<HTMLElement>('[data-frame-canvas="true"]');
  if (canvas) return canvas;
  let parent = element.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return element.parentElement ?? element;
}

export function measureGalleryTop(
  gallery: HTMLElement,
  container: HTMLElement,
) {
  if (gallery.offsetParent === container) {
    return gallery.offsetTop;
  }
  return (
    gallery.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

/** Metrics before the first measurement assume a typical viewport. */
export function toWindow(metrics: GalleryMetrics): ViewportWindow {
  const viewportHeight =
    metrics.viewportHeight > 0
      ? metrics.viewportHeight
      : INITIAL_VIEWPORT_HEIGHT;
  return {
    scrollTop: metrics.scrollTop,
    viewportHeight,
    galleryTop: metrics.galleryTop,
    overscan: overscanFor(viewportHeight),
  };
}

function sameMetrics(left: GalleryMetrics, right: GalleryMetrics) {
  return (
    left.width === right.width &&
    left.scrollTop === right.scrollTop &&
    left.viewportHeight === right.viewportHeight &&
    left.galleryTop === right.galleryTop
  );
}

/**
 * Tracks the scroll container around the gallery. Scrolling only causes a
 * re-render when the set of mounted cards would change; resizes always do.
 */
export function useGalleryWindow(
  galleryRef: RefObject<HTMLDivElement | null>,
  layoutRef: RefObject<MasonryLayout>,
  mountedRef: RefObject<readonly number[]>,
  active: boolean,
) {
  const [metrics, setMetrics] = useState<GalleryMetrics>(INITIAL_METRICS);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const metricsRef = useRef(metrics);

  useLayoutEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useLayoutEffect(() => {
    const gallery = galleryRef.current;
    if (!active || !gallery) {
      setContainer(null);
      return;
    }
    const scroller = findScrollContainer(gallery);
    setContainer(scroller);

    const read = (): GalleryMetrics => ({
      width: gallery.clientWidth,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      galleryTop: measureGalleryTop(gallery, scroller),
    });
    const measure = () => {
      const next = read();
      setMetrics((current) => (sameMetrics(current, next) ? current : next));
    };
    measure();

    let frame = 0;
    const handleScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next: GalleryMetrics = {
          ...metricsRef.current,
          scrollTop: scroller.scrollTop,
          galleryTop: measureGalleryTop(gallery, scroller),
        };
        const indices = windowedIndices(
          layoutRef.current.items,
          windowRange(toWindow(next)),
        );
        if (!sameIndices(indices, mountedRef.current)) {
          setMetrics(next);
        }
      });
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(gallery);
    observer?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [active, galleryRef, layoutRef, mountedRef]);

  return { metrics, container };
}
