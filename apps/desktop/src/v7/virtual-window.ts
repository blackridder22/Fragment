export const MAX_MOUNTED_CARDS = 150;
const MIN_OVERSCAN = 320;
const MAX_OVERSCAN = 1600;

export type ViewportWindow = {
  /** Scroll offset of the scroll container. */
  scrollTop: number;
  /** Visible height of the scroll container. */
  viewportHeight: number;
  /** Distance from the top of the scroll content to the top of the gallery. */
  galleryTop: number;
  /** Extra pixels rendered above and below the viewport. */
  overscan: number;
};

export type WindowRange = { start: number; end: number };

export type WindowedItem = { index: number; top: number; height: number };

/** About one viewport of overscan, bounded so tiny and huge windows stay sane. */
export function overscanFor(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return MIN_OVERSCAN;
  }
  return Math.min(MAX_OVERSCAN, Math.max(MIN_OVERSCAN, viewportHeight));
}

/** The gallery-local pixel band that should be mounted. */
export function windowRange(window: ViewportWindow): WindowRange {
  const start = window.scrollTop - window.galleryTop - window.overscan;
  const end =
    window.scrollTop -
    window.galleryTop +
    window.viewportHeight +
    window.overscan;
  return { start, end };
}

/**
 * Indices of the items that intersect the range, ascending. When more than
 * `maxMounted` intersect, the items nearest the centre of the range win.
 */
export function windowedIndices(
  items: readonly WindowedItem[],
  range: WindowRange,
  maxMounted = MAX_MOUNTED_CARDS,
): number[] {
  const hits: WindowedItem[] = [];
  for (const item of items) {
    if (item.top < range.end && item.top + item.height > range.start) {
      hits.push(item);
    }
  }
  if (hits.length <= maxMounted) {
    return hits.map((item) => item.index);
  }
  const center = (range.start + range.end) / 2;
  return hits
    .map((item) => ({
      index: item.index,
      distance: Math.abs(item.top + item.height / 2 - center),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(0, maxMounted))
    .map((hit) => hit.index)
    .sort((left, right) => left - right);
}

export function sameIndices(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * The scrollTop that brings an item fully into view, or null when it already
 * is. Items taller than the viewport align to the top.
 */
export function scrollTopToReveal(
  item: { top: number; height: number },
  window: Pick<ViewportWindow, "scrollTop" | "viewportHeight" | "galleryTop">,
  padding = 24,
): number | null {
  const itemTop = window.galleryTop + item.top;
  const itemBottom = itemTop + item.height;
  const viewTop = window.scrollTop;
  const viewBottom = window.scrollTop + window.viewportHeight;
  if (itemTop >= viewTop && itemBottom <= viewBottom) {
    return null;
  }
  if (item.height + padding * 2 >= window.viewportHeight || itemTop < viewTop) {
    return Math.max(0, itemTop - padding);
  }
  return Math.max(0, itemBottom + padding - window.viewportHeight);
}
