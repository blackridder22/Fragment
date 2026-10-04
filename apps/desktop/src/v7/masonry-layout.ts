import type { BrowsingDensity } from "../features/library/BrowsingModeControl";

export type MasonryMode = "masonry" | "grid";

export type MasonryItemInput = {
  id: string;
  width?: number | null;
  height?: number | null;
};

export type MasonryPlacement = {
  id: string;
  index: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Width divided by height of the rendered box. */
  ratio: number;
};

export type MasonryOptions = {
  mode: MasonryMode;
  columnCount: number;
  columnWidth: number;
  gap: number;
  /** Uniform cell height, used by the grid mode only. */
  rowHeight?: number;
};

export type MasonryLayout = MasonryOptions & {
  items: MasonryPlacement[];
  columnHeights: number[];
  /** Total content height without the trailing gap. */
  height: number;
};

export const DEFAULT_ASPECT_RATIO = 4 / 3;
export const MASONRY_GAP = 12;
/** Boxes narrower than 1:8 or wider than 8:1 are letterboxed instead of growing further. */
export const MIN_ASPECT_RATIO = 1 / 8;
export const MAX_ASPECT_RATIO = 8;
/** Columns are tied when they differ by less than this many pixels, which keeps reading order. */
const COLUMN_TIE_TOLERANCE = 1;

const MIN_COLUMN_WIDTH: Record<BrowsingDensity, number> = {
  compact: 164,
  comfortable: 204,
  large: 260,
};

const MAX_COLUMN_COUNT: Record<BrowsingDensity, number> = {
  compact: 8,
  comfortable: 6,
  large: 5,
};

const DEFAULT_COLUMN_COUNT: Record<BrowsingDensity, number> = {
  compact: 6,
  comfortable: 5,
  large: 4,
};

const GRID_ROW_HEIGHT: Record<BrowsingDensity, number> = {
  compact: 176,
  comfortable: 240,
  large: 304,
};

export function aspectRatioFor(
  item: Pick<MasonryItemInput, "width" | "height">,
  fallback = DEFAULT_ASPECT_RATIO,
): number {
  const { width, height } = item;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return fallback;
  }
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, width / height));
}

export function columnCountFor(
  containerWidth: number,
  density: BrowsingDensity,
  gap = MASONRY_GAP,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return DEFAULT_COLUMN_COUNT[density];
  }
  const count = Math.floor(
    (containerWidth + gap) / (MIN_COLUMN_WIDTH[density] + gap),
  );
  return Math.min(MAX_COLUMN_COUNT[density], Math.max(1, count));
}

export function columnWidthFor(
  containerWidth: number,
  columnCount: number,
  gap = MASONRY_GAP,
): number {
  if (columnCount <= 0) return 0;
  return Math.max(0, (containerWidth - gap * (columnCount - 1)) / columnCount);
}

export function gridRowHeightFor(density: BrowsingDensity): number {
  return GRID_ROW_HEIGHT[density];
}

function shortestColumn(columnHeights: readonly number[]): number {
  let column = 0;
  for (let index = 1; index < columnHeights.length; index += 1) {
    if (columnHeights[index]! + COLUMN_TIE_TOLERANCE < columnHeights[column]!) {
      column = index;
    }
  }
  return column;
}

function boxRatio(item: MasonryItemInput, options: MasonryOptions): number {
  if (options.mode === "grid") {
    const rowHeight = options.rowHeight ?? options.columnWidth;
    return rowHeight > 0 ? options.columnWidth / rowHeight : 1;
  }
  return aspectRatioFor(item);
}

/**
 * A previous layout can be extended when its options match and its items are a
 * prefix of the new list with unchanged box ratios, so appending a page never
 * moves an existing card.
 */
export function canExtendLayout(
  previous: MasonryLayout | null | undefined,
  options: MasonryOptions,
  items: readonly MasonryItemInput[],
): previous is MasonryLayout {
  if (
    !previous ||
    previous.mode !== options.mode ||
    previous.columnCount !== options.columnCount ||
    previous.columnWidth !== options.columnWidth ||
    previous.gap !== options.gap ||
    previous.rowHeight !== options.rowHeight ||
    previous.items.length > items.length
  ) {
    return false;
  }
  for (let index = 0; index < previous.items.length; index += 1) {
    const placement = previous.items[index]!;
    const item = items[index]!;
    if (
      placement.id !== item.id ||
      placement.ratio !== boxRatio(item, options)
    ) {
      return false;
    }
  }
  return true;
}

export function placeMasonry(
  items: readonly MasonryItemInput[],
  options: MasonryOptions,
  previous?: MasonryLayout | null,
): MasonryLayout {
  const columnCount = Math.max(1, Math.floor(options.columnCount));
  const normalized: MasonryOptions = { ...options, columnCount };
  const reusable = canExtendLayout(previous, normalized, items)
    ? previous
    : null;
  const placements = reusable ? reusable.items.slice() : [];
  const columnHeights = reusable
    ? reusable.columnHeights.slice()
    : new Array<number>(columnCount).fill(0);

  for (let index = placements.length; index < items.length; index += 1) {
    const item = items[index]!;
    const ratio = boxRatio(item, normalized);
    const height =
      normalized.mode === "grid"
        ? (normalized.rowHeight ?? normalized.columnWidth)
        : normalized.columnWidth / ratio;
    const column = shortestColumn(columnHeights);
    const top = columnHeights[column]!;
    placements.push({
      id: item.id,
      index,
      column,
      left: column * (normalized.columnWidth + normalized.gap),
      top,
      width: normalized.columnWidth,
      height,
      ratio,
    });
    columnHeights[column] = top + height + normalized.gap;
  }

  const height =
    placements.length === 0
      ? 0
      : Math.max(0, Math.max(...columnHeights) - normalized.gap);

  return { ...normalized, items: placements, columnHeights, height };
}
