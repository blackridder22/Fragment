export type PreviewItemLocation = "active" | "trashed" | "purged";

type StoredPreviewItemLocation = Exclude<PreviewItemLocation, "active">;

export type PreviewTrashState = ReadonlyMap<string, StoredPreviewItemLocation>;

export function createPreviewTrashState(): PreviewTrashState {
  return new Map();
}

export function movePreviewItemsToTrash(
  state: PreviewTrashState,
  ids: readonly string[],
): PreviewTrashState {
  const next = new Map(state);
  let changed = false;

  for (const id of new Set(ids)) {
    if (next.get(id) === "purged" || next.get(id) === "trashed") {
      continue;
    }
    next.set(id, "trashed");
    changed = true;
  }

  return changed ? next : state;
}

export function restorePreviewItems(
  state: PreviewTrashState,
  ids: readonly string[],
): PreviewTrashState {
  const next = new Map(state);
  let changed = false;

  for (const id of new Set(ids)) {
    if (next.get(id) !== "trashed") {
      continue;
    }
    next.delete(id);
    changed = true;
  }

  return changed ? next : state;
}

export function purgePreviewTrash(state: PreviewTrashState): PreviewTrashState {
  const next = new Map(state);
  let changed = false;

  for (const [id, location] of state) {
    if (location !== "trashed") {
      continue;
    }
    next.set(id, "purged");
    changed = true;
  }

  return changed ? next : state;
}

export function previewIdsAtLocation(
  ids: readonly string[],
  state: PreviewTrashState,
  location: PreviewItemLocation,
): string[] {
  return ids.filter((id) => (state.get(id) ?? "active") === location);
}
