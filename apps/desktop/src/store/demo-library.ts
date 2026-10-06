import type { Fragment, Frame } from "@fragment/shared";
import { demoFragments, demoFrames } from "../lib/demo-vault";
import { previewIdsAtLocation } from "../features/trash/preview-trash-state";
import { descendantFrameIds } from "../features/frames/frame-tree";
import { createSelector } from "./create-store";
import type { LibraryState, SortMode, SourceFilter } from "./library-types";

/**
 * Browser-preview data. Only demo Fragments are filtered and sorted on the
 * client; real pages arrive filtered and sorted from the backend.
 */

const demoFragmentIds = demoFragments.map((fragment) => fragment.id);

export function isTransparentAsset(fragment: Fragment) {
  const mimeType = fragment.mimeType?.toLowerCase() ?? "";
  const originalPath = fragment.originalPath.toLowerCase();
  return (
    mimeType.includes("png") ||
    (!fragment.id.startsWith("demo-") && originalPath.endsWith(".png"))
  );
}

export function matchesSourceFilter(fragment: Fragment, filter: SourceFilter) {
  const hasSource = Boolean(fragment.sourceUrl || fragment.pageUrl);
  if (filter === "source") return hasSource;
  if (filter === "local") return !hasSource;
  if (filter === "png") return isTransparentAsset(fragment);
  return true;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareDemoFragments(
  left: Fragment,
  right: Fragment,
  sortMode: SortMode,
) {
  if (sortMode === "name") {
    return (left.title ?? "").localeCompare(right.title ?? "");
  }
  if (sortMode === "largest") {
    return (right.fileSize ?? 0) - (left.fileSize ?? 0);
  }
  const leftTime = timestamp(left.capturedAt || left.createdAt);
  const rightTime = timestamp(right.capturedAt || right.createdAt);
  return sortMode === "oldest" ? leftTime - rightTime : rightTime - leftTime;
}

function withOverrides(
  fragment: Fragment,
  assignments: Record<string, string>,
  titles: Record<string, string>,
) {
  const frameId = assignments[fragment.id];
  const title = titles[fragment.id];
  return frameId || title !== undefined
    ? {
        ...fragment,
        frameId: frameId ?? fragment.frameId,
        title: title ?? fragment.title,
      }
    : fragment;
}

export const selectDemoActiveFragments = createSelector(
  [
    (state: LibraryState) => state.previewTrashState,
    (state: LibraryState) => state.previewFrameAssignments,
    (state: LibraryState) => state.previewTitleOverrides,
  ],
  (trashState, assignments, titles) => {
    const active = new Set(
      previewIdsAtLocation(demoFragmentIds, trashState, "active"),
    );
    return demoFragments
      .filter((fragment) => active.has(fragment.id))
      .map((fragment) => withOverrides(fragment, assignments, titles));
  },
);

export const selectDemoTrashedFragments = createSelector(
  [
    (state: LibraryState) => state.previewTrashState,
    (state: LibraryState) => state.previewFrameAssignments,
    (state: LibraryState) => state.previewTitleOverrides,
  ],
  (trashState, assignments, titles) => {
    const byId = new Map(
      demoFragments.map((fragment) => [
        fragment.id,
        withOverrides(fragment, assignments, titles),
      ]),
    );
    return previewIdsAtLocation(demoFragmentIds, trashState, "trashed")
      .map((id) => byId.get(id))
      .filter((fragment): fragment is Fragment => Boolean(fragment));
  },
);

const demoFrameById = new Map(demoFrames.map((frame) => [frame.id, frame]));

export const selectDemoGalleryFragments = createSelector(
  [
    selectDemoActiveFragments,
    (state: LibraryState) => state.selectedFrameId,
    (state: LibraryState) => state.frameNavigator.includeDescendants,
    (state: LibraryState) => state.query,
    (state: LibraryState) => state.sourceFilter,
    (state: LibraryState) => state.sortMode,
  ],
  (fragments, selectedFrameId, includeDescendants, query, source, sort) => {
    const scope = selectedFrameId
      ? new Set(
          includeDescendants
            ? descendantFrameIds(demoFrames, selectedFrameId)
            : [selectedFrameId],
        )
      : null;
    const normalized = query.trim().toLowerCase();
    return fragments
      .filter((fragment) => {
        if (scope && !scope.has(fragment.frameId)) return false;
        if (!matchesSourceFilter(fragment, source)) return false;
        if (!normalized) return true;
        return [
          fragment.title,
          demoFrameById.get(fragment.frameId)?.name,
          fragment.siteName,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalized));
      })
      .sort((left, right) => compareDemoFragments(left, right, sort));
  },
);

export const selectDemoCounts = createSelector(
  [selectDemoActiveFragments],
  (fragments) => {
    const counts = new Map<string, number>();
    for (const fragment of fragments) {
      counts.set(fragment.frameId, (counts.get(fragment.frameId) ?? 0) + 1);
    }
    return counts;
  },
);

export function demoFramesList(): Frame[] {
  return demoFrames;
}
