import type { Fragment } from "@fragment/shared";

export type SnapshotMetadata = {
  frameCounts: Record<string, number>;
  trashTotal: number;
};

export function mergeUniqueFragments(
  current: Fragment[],
  incoming: Fragment[],
  position: "append" | "prepend" = "append",
): Fragment[] {
  if (position === "prepend") {
    const next = mergeUniqueFragments([], incoming);
    const incomingIds = new Set(next.map((fragment) => fragment.id));
    return [
      ...next,
      ...current.filter((fragment) => !incomingIds.has(fragment.id)),
    ];
  }

  const next = [...current];
  const indexes = new Map(
    next.map((fragment, index) => [fragment.id, index] as const),
  );
  for (const fragment of incoming) {
    const existingIndex = indexes.get(fragment.id);
    if (existingIndex === undefined) {
      indexes.set(fragment.id, next.length);
      next.push(fragment);
    } else {
      next[existingIndex] = fragment;
    }
  }
  return next;
}

export function readSnapshotMetadata(snapshot: unknown): SnapshotMetadata {
  if (!snapshot || typeof snapshot !== "object") {
    return { frameCounts: {}, trashTotal: 0 };
  }

  const candidate = snapshot as {
    frameCounts?: unknown;
    trashTotal?: unknown;
  };
  const frameCounts: Record<string, number> = {};
  if (
    candidate.frameCounts &&
    typeof candidate.frameCounts === "object" &&
    !Array.isArray(candidate.frameCounts)
  ) {
    for (const [frameId, count] of Object.entries(candidate.frameCounts)) {
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
        frameCounts[frameId] = count;
      }
    }
  }

  return {
    frameCounts,
    trashTotal:
      typeof candidate.trashTotal === "number" &&
      Number.isFinite(candidate.trashTotal) &&
      candidate.trashTotal >= 0
        ? candidate.trashTotal
        : 0,
  };
}
