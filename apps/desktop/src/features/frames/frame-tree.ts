import type { Frame } from "@fragment/shared";

export type FrameTreeRow = {
  frame: Frame;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  matchesQuery: boolean;
};

export type FrameDropTarget =
  | { kind: "root" }
  | { kind: "inside"; frameId: string }
  | { kind: "before" | "after"; frameId: string };

export type FrameDropPlacement = {
  parentId: string | null;
  position: number;
};

export type FrameNavigatorPreferences = {
  collapsed: boolean;
  width: number;
  expandedIds: string[];
  pinnedIds: string[];
  includeDescendants: boolean;
};

export const DEFAULT_FRAME_NAVIGATOR_PREFERENCES: FrameNavigatorPreferences = {
  collapsed: false,
  width: 272,
  expandedIds: [],
  pinnedIds: [],
  includeDescendants: false,
};

export function sortFrames(frames: Frame[]): Frame[] {
  return [...frames].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

export function descendantFrameIds(
  frames: Frame[],
  frameId: string,
  includeSelf = true,
): string[] {
  const children = childrenByParent(frames);
  const result: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    result.push(id);
    for (const child of children.get(id) ?? []) visit(child.id);
  };
  visit(frameId);
  return includeSelf ? result : result.slice(1);
}

export function frameBreadcrumbs(frames: Frame[], frameId: string): Frame[] {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const result: Frame[] = [];
  const visited = new Set<string>();
  let current = byId.get(frameId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

export function aggregateFrameCounts(
  frames: Frame[],
  directCounts: ReadonlyMap<string, number>,
): Map<string, number> {
  const children = childrenByParent(frames);
  const totals = new Map<string, number>();
  const visit = (id: string, ancestors: Set<string>): number => {
    if (totals.has(id)) return totals.get(id) ?? 0;
    if (ancestors.has(id)) return directCounts.get(id) ?? 0;
    const nextAncestors = new Set(ancestors).add(id);
    const total = (children.get(id) ?? []).reduce(
      (sum, child) => sum + visit(child.id, nextAncestors),
      directCounts.get(id) ?? 0,
    );
    totals.set(id, total);
    return total;
  };
  for (const frame of frames) visit(frame.id, new Set());
  return totals;
}

export function flattenFrameTree(
  frames: Frame[],
  expandedIds: ReadonlySet<string>,
  query = "",
): FrameTreeRow[] {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const children = childrenByParent(frames);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = new Set(
    normalizedQuery
      ? frames
          .filter((frame) =>
            frame.name.toLocaleLowerCase().includes(normalizedQuery),
          )
          .map((frame) => frame.id)
      : frames.map((frame) => frame.id),
  );
  const visibleIds = new Set(matchingIds);
  if (normalizedQuery) {
    for (const id of matchingIds) {
      let current = byId.get(id);
      const visited = new Set<string>();
      while (current?.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        visibleIds.add(current.parentId);
        current = byId.get(current.parentId);
      }
    }
  }

  const rows: FrameTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (frame: Frame, depth: number) => {
    if (visited.has(frame.id) || !visibleIds.has(frame.id)) return;
    visited.add(frame.id);
    const childFrames = children.get(frame.id) ?? [];
    const expanded = normalizedQuery.length > 0 || expandedIds.has(frame.id);
    rows.push({
      frame,
      depth,
      hasChildren: childFrames.length > 0,
      expanded,
      matchesQuery: matchingIds.has(frame.id),
    });
    if (expanded) {
      for (const child of childFrames) visit(child, depth + 1);
    }
  };

  const rootFrames = sortFrames(
    frames.filter(
      (frame) => frame.parentId === null || !byId.has(frame.parentId),
    ),
  );
  for (const frame of rootFrames) visit(frame, 0);
  return rows;
}

export function resolveFrameDrop(
  frames: Frame[],
  movingFrameId: string,
  target: FrameDropTarget,
): FrameDropPlacement | null {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  if (!byId.has(movingFrameId)) return null;
  const forbiddenIds = new Set(descendantFrameIds(frames, movingFrameId, true));

  if (target.kind === "root") {
    return {
      parentId: null,
      position: siblings(frames, null, movingFrameId).length,
    };
  }

  const targetFrame = byId.get(target.frameId);
  if (!targetFrame || forbiddenIds.has(targetFrame.id)) return null;
  if (target.kind === "inside") {
    return {
      parentId: targetFrame.id,
      position: siblings(frames, targetFrame.id, movingFrameId).length,
    };
  }

  const targetSiblings = siblings(frames, targetFrame.parentId, movingFrameId);
  const targetIndex = targetSiblings.findIndex(
    (frame) => frame.id === targetFrame.id,
  );
  if (targetIndex < 0) return null;
  return {
    parentId: targetFrame.parentId,
    position: targetIndex + (target.kind === "after" ? 1 : 0),
  };
}

export function parseFrameNavigatorPreferences(
  raw: string | null,
): FrameNavigatorPreferences {
  if (!raw) return DEFAULT_FRAME_NAVIGATOR_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<FrameNavigatorPreferences>;
    return {
      collapsed: value.collapsed === true,
      width:
        typeof value.width === "number" && Number.isFinite(value.width)
          ? Math.min(380, Math.max(220, Math.round(value.width)))
          : DEFAULT_FRAME_NAVIGATOR_PREFERENCES.width,
      expandedIds: stringArray(value.expandedIds),
      pinnedIds: stringArray(value.pinnedIds),
      includeDescendants: value.includeDescendants === true,
    };
  } catch {
    return DEFAULT_FRAME_NAVIGATOR_PREFERENCES;
  }
}

function childrenByParent(frames: Frame[]): Map<string, Frame[]> {
  const children = new Map<string, Frame[]>();
  for (const frame of frames) {
    if (!frame.parentId) continue;
    const entries = children.get(frame.parentId) ?? [];
    entries.push(frame);
    children.set(frame.parentId, entries);
  }
  for (const [parentId, entries] of children) {
    children.set(parentId, sortFrames(entries));
  }
  return children;
}

function siblings(
  frames: Frame[],
  parentId: string | null,
  excludedId: string,
): Frame[] {
  return sortFrames(
    frames.filter(
      (frame) => frame.parentId === parentId && frame.id !== excludedId,
    ),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      ]
    : [];
}
