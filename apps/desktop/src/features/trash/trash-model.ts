import type { Fragment, Frame } from "@fragment/shared";
import {
  estimateDeleteAfter,
  parseTimestamp,
  type TrashRetention,
} from "./retention";

export type TrashSort = "newest" | "oldest";

export type TrashFragmentRow = {
  key: string;
  kind: "fragment";
  id: string;
  fragment: Fragment;
  name: string;
  deletedAt: string;
  deleteAfter: string | null;
};

export type TrashFrameRow = {
  key: string;
  kind: "frame";
  id: string;
  frame: Frame;
  name: string;
  deletedAt: string;
  deleteAfter: string | null;
  /** True while the date is derived from the current policy, not the row. */
  estimatedRetention: boolean;
};

export type TrashRow = TrashFragmentRow | TrashFrameRow;

export const fragmentRowKey = (id: string) => `fragment:${id}`;
export const frameRowKey = (id: string) => `frame:${id}`;

export function fragmentDisplayName(fragment: Pick<Fragment, "title">): string {
  return fragment.title?.trim() || "Untitled Fragment";
}

export function frameDisplayName(frame: Pick<Frame, "name">): string {
  return frame.name.trim() || "Unnamed Frame";
}

/**
 * Keeps the server's deleted-date order: the Trash sort is part of the page
 * query key, so the page never re-sorts Fragments (`sortByDeletedAt` is for
 * Frames, which arrive unsorted, and for the browser preview's demo rows).
 */
export function buildFragmentRows(
  fragments: readonly Fragment[],
): TrashFragmentRow[] {
  return fragments.map((fragment) => ({
    key: fragmentRowKey(fragment.id),
    kind: "fragment",
    id: fragment.id,
    fragment,
    name: fragmentDisplayName(fragment),
    deletedAt: fragment.deletedAt ?? fragment.updatedAt ?? fragment.createdAt,
    deleteAfter: fragment.deleteAfter ?? null,
  }));
}

/**
 * Trashed Frames arrive unsorted and without retention fields. The backend
 * stamps `updated_at` with the deletion time, so that is the deleted date.
 */
export function buildFrameRows(
  frames: readonly Frame[],
  sort: TrashSort,
  retention: TrashRetention,
): TrashFrameRow[] {
  const rows = frames.map((frame): TrashFrameRow => {
    const deletedAt = frame.updatedAt ?? frame.createdAt;
    return {
      key: frameRowKey(frame.id),
      kind: "frame",
      id: frame.id,
      frame,
      name: frameDisplayName(frame),
      deletedAt,
      deleteAfter: estimateDeleteAfter(deletedAt, retention),
      estimatedRetention: true,
    };
  });
  return sortByDeletedAt(rows, sort);
}

export function sortByDeletedAt<T extends { deletedAt: string }>(
  rows: readonly T[],
  sort: TrashSort,
): T[] {
  return [...rows].sort((left, right) => {
    const difference =
      (parseTimestamp(right.deletedAt) ?? 0) -
      (parseTimestamp(left.deletedAt) ?? 0);
    return sort === "newest" ? difference : -difference;
  });
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/** "3 Fragments and 1 Frame", "3 Fragments", "1 Frame". */
export function trashSelectionSummary(
  fragmentCount: number,
  frameCount: number,
): string {
  const parts: string[] = [];
  if (fragmentCount > 0) parts.push(pluralize(fragmentCount, "Fragment"));
  if (frameCount > 0) parts.push(pluralize(frameCount, "Frame"));
  return parts.join(" and ") || "nothing";
}

/** The Empty Trash consequence: it removes everything, not the visible rows. */
export function emptyTrashConsequence(totals: {
  fragments: number;
  frames: number;
}): string {
  return `This empties the whole Trash: ${trashSelectionSummary(totals.fragments, totals.frames)}, including anything hidden by the current filter or not loaded yet, and the image files no active Fragment uses. This cannot be undone.`;
}

export function normalizeFrameName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * A restored Frame keeps its name unless a sibling already uses it, in which
 * case the first free "Name 2", "Name 3", … is chosen.
 */
export function resolveRestoredFrameName(
  name: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set(Array.from(existingNames, normalizeFrameName));
  if (!taken.has(normalizeFrameName(name))) {
    return name;
  }
  const base = name.trim();
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(normalizeFrameName(candidate))) {
      return candidate;
    }
  }
  return `${base} ${Date.now()}`;
}

export function siblingFrameNames(
  frames: readonly Frame[],
  parentId: string | null,
  excludeId: string,
): string[] {
  return frames
    .filter(
      (frame) =>
        frame.id !== excludeId && (frame.parentId ?? null) === (parentId ?? null),
    )
    .map((frame) => frame.name);
}

/**
 * Removes rows from a loaded, paginated list without reloading it and reports
 * how far the server-side offset must move back for the next page to line up.
 */
export function removeFragmentsFromPage(
  loaded: readonly Fragment[],
  ids: readonly string[],
  nextOffset: number,
): { remaining: Fragment[]; removed: Fragment[]; nextOffset: number } {
  const idSet = new Set(ids);
  const removed = loaded.filter((fragment) => idSet.has(fragment.id));
  const remaining = loaded.filter((fragment) => !idSet.has(fragment.id));
  return {
    remaining,
    removed,
    nextOffset: Math.max(0, nextOffset - removed.length),
  };
}
