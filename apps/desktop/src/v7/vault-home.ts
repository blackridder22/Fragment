import type { Fragment, Frame } from "@fragment/shared";
import type { BrowsingDensity } from "../features/library/BrowsingModeControl";
import { sortFrames } from "../features/frames/frame-tree";

/** Folder cards shown before the "Show all Frames" expander. */
export const FOLDER_CARD_LIMIT = 8;
/** Latest Fragments rendered inside one folder collage. */
export const FOLDER_PREVIEW_LIMIT = 3;
/** Upper bound of the "Recently added" section; the page never paginates. */
export const RECENT_LIMIT = 18;
/** Items that receive their own first-paint delay; later items share the last one. */
export const STAGGER_CAP = 8;
export const STAGGER_STEP_MS = 20;
/** How long the first-paint stagger is allowed to run before classes are released. */
export const INTRO_WINDOW_MS = STAGGER_STEP_MS * STAGGER_CAP + 320 + 80;

/** Fallback aspect ratio when a Fragment has no stored dimensions. */
export const FALLBACK_ASPECT_RATIO = 4 / 3;
export const MIN_ASPECT_RATIO = 0.6;
export const MAX_ASPECT_RATIO = 2.4;

/**
 * Target sum of aspect ratios per recent row (row width / row height). A wider
 * target yields shorter rows with more images.
 */
export const RECENT_ROW_TARGET: Record<BrowsingDensity, number> = {
  compact: 6.4,
  comfortable: 5.2,
  large: 4.2,
};

export type FrameCountSource =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

export type FramePreviewMap =
  | ReadonlyMap<string, readonly Fragment[]>
  | Readonly<Record<string, readonly Fragment[]>>;

export type RecentRowItem = {
  fragment: Fragment;
  ratio: number;
};

export type RecentRow = {
  items: RecentRowItem[];
  /** Denominator for every item width in the row; padded to the target on the last row. */
  ratioSum: number;
};

function isMapLike<V>(
  value: ReadonlyMap<string, V> | Readonly<Record<string, V>>,
): value is ReadonlyMap<string, V> {
  return typeof (value as ReadonlyMap<string, V>).get === "function";
}

function lookup<V>(
  source: ReadonlyMap<string, V> | Readonly<Record<string, V>> | undefined,
  key: string,
): V | undefined {
  if (!source) return undefined;
  return isMapLike(source) ? source.get(key) : source[key];
}

export function isSystemFrame(
  frame: Frame,
  systemFrameId?: string | null,
): boolean {
  if (systemFrameId) return frame.id === systemFrameId;
  return frame.parentId === null && frame.name === "Inbox";
}

/** Top-level Frames in the sidebar's order, with the system Frame (Inbox) pinned first. */
export function topLevelFrames(
  frames: readonly Frame[],
  systemFrameId?: string | null,
): Frame[] {
  const roots = sortFrames(frames.filter((frame) => frame.parentId === null));
  const system = roots.filter((frame) => isSystemFrame(frame, systemFrameId));
  const rest = roots.filter((frame) => !isSystemFrame(frame, systemFrameId));
  return [...system, ...rest];
}

export function visibleFolderFrames(
  frames: readonly Frame[],
  expanded: boolean,
  limit = FOLDER_CARD_LIMIT,
): { visible: Frame[]; hiddenCount: number } {
  if (expanded || frames.length <= limit) {
    return { visible: [...frames], hiddenCount: 0 };
  }
  return {
    visible: frames.slice(0, limit),
    hiddenCount: frames.length - limit,
  };
}

/** Recursive total when the store provides one; otherwise count the loaded page. */
export function frameCountFor(
  frame: Frame,
  frameCounts: FrameCountSource | undefined,
  fallbackFragments: readonly Fragment[],
): number {
  if (frameCounts) {
    return lookup(frameCounts, frame.id) ?? 0;
  }
  return fallbackFragments.reduce(
    (count, fragment) => count + Number(fragment.frameId === frame.id),
    0,
  );
}

export function fragmentCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "Fragment" : "Fragments"}`;
}

function uniqueById(fragments: readonly Fragment[]): Fragment[] {
  const seen = new Set<string>();
  const unique: Fragment[] = [];
  for (const fragment of fragments) {
    if (seen.has(fragment.id)) continue;
    seen.add(fragment.id);
    unique.push(fragment);
  }
  return unique;
}

/**
 * Fragments for one folder collage: the backend previews when present, else
 * whatever the loaded page holds for that Frame, newest first.
 */
export function collageFragments(
  frameId: string,
  previews: FramePreviewMap | undefined,
  fallbackFragments: readonly Fragment[],
  limit = FOLDER_PREVIEW_LIMIT,
): Fragment[] {
  const fromPreviews = lookup(previews, frameId);
  if (fromPreviews && fromPreviews.length > 0) {
    return uniqueById(fromPreviews).slice(0, limit);
  }
  return uniqueById(
    fallbackFragments.filter((fragment) => fragment.frameId === frameId),
  ).slice(0, limit);
}

/** Bounded, deduplicated newest-first list for "Recently added". */
export function recentFragments(
  fragments: readonly Fragment[],
  limit = RECENT_LIMIT,
): Fragment[] {
  return uniqueById(fragments).slice(0, Math.max(0, limit));
}

export function aspectRatioOf(fragment: Pick<Fragment, "width" | "height">) {
  const width = fragment.width ?? 0;
  const height = fragment.height ?? 0;
  if (width <= 0 || height <= 0) return FALLBACK_ASPECT_RATIO;
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, width / height));
}

/**
 * Greedy justified rows: each row collects items until their aspect ratios sum
 * to about `target`, so CSS can size every item as `ratio / ratioSum` of the row
 * width and all items in a row share one height while staying whole. The last
 * row is padded to `target` so a lone trailing image never balloons.
 */
export function justifiedRows(
  fragments: readonly Fragment[],
  target: number,
): RecentRow[] {
  const rows: RecentRow[] = [];
  let current: RecentRowItem[] = [];
  let sum = 0;
  const close = (ratioSum: number) => {
    rows.push({ items: current, ratioSum });
    current = [];
    sum = 0;
  };

  for (const fragment of fragments) {
    const ratio = aspectRatioOf(fragment);
    if (current.length > 0 && sum + ratio > target) {
      const withItem = Math.abs(sum + ratio - target);
      const withoutItem = Math.abs(sum - target);
      if (withItem < withoutItem) {
        current.push({ fragment, ratio });
        close(sum + ratio);
        continue;
      }
      close(sum);
    }
    current.push({ fragment, ratio });
    sum += ratio;
    if (sum >= target) {
      close(sum);
    }
  }
  if (current.length > 0) {
    close(Math.max(sum, target));
  }
  return rows;
}

/** 0-based stagger slot; items past the cap share the last slot. */
export function staggerIndex(index: number, cap = STAGGER_CAP): number {
  return Math.max(0, Math.min(index, cap - 1));
}

export function isBrandNewVault({
  ready,
  frames,
  fragments,
  systemFrameId,
  searchQuery,
}: {
  ready: boolean;
  frames: readonly Frame[];
  fragments: readonly Fragment[];
  systemFrameId?: string | null;
  searchQuery?: string;
}): boolean {
  if (!ready || searchQuery?.trim()) return false;
  if (fragments.length > 0) return false;
  return frames.every((frame) => isSystemFrame(frame, systemFrameId));
}
