import type { Frame } from "@fragment/shared";
import {
  deleteFragments,
  deleteFrame,
  emptyTrash,
  renameFrame,
  restoreFragments,
  restoreFrame,
  type PurgeReport,
} from "../../lib/tauri";
import { retentionDays, type TrashRetention } from "./retention";
import { resolveRestoredFrameName, siblingFrameNames } from "./trash-model";

/**
 * The backend calls the Trash page needs. Each function maps to exactly one
 * `invoke`, which keeps the per-action call budget visible and testable.
 */
export type TrashBackend = {
  restoreFragments: (ids: string[]) => Promise<number>;
  restoreFrame: (id: string) => Promise<Frame>;
  renameFrame: (id: string, name: string) => Promise<Frame>;
  deleteFragments: (
    ids: string[],
    retentionDays: number | null,
  ) => Promise<number>;
  /** `null` retention performs a hard delete. */
  deleteFrame: (id: string, retentionDays: number | null) => Promise<void>;
  emptyTrash: () => Promise<PurgeReport>;
};

export const tauriTrashBackend: TrashBackend = {
  restoreFragments,
  restoreFrame,
  renameFrame,
  deleteFragments,
  deleteFrame,
  emptyTrash,
};

export type RestoredFrameResult = {
  frame: Frame;
  /** The original name when a sibling conflict forced a new one. */
  renamedFrom: string | null;
};

export type EmptyTrashSummary = { fragments: number; frames: number };

export function uniqueVaultIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id && !id.startsWith("demo-"))));
}

/** One backend call regardless of how many Fragments are selected. */
export async function restoreFragmentsNow(
  backend: TrashBackend,
  ids: readonly string[],
): Promise<string[]> {
  const realIds = uniqueVaultIds(ids);
  if (realIds.length === 0) return [];
  await backend.restoreFragments(realIds);
  return realIds;
}

/**
 * Restores a Frame and, when an active sibling already carries its name,
 * renames it to the first free numbered name. A failed rename never undoes the
 * restore; the Frame then simply keeps its original name.
 */
export async function restoreFrameWithUniqueName(
  backend: TrashBackend,
  frame: Frame,
  activeFrames: readonly Frame[],
): Promise<RestoredFrameResult> {
  const restored = await backend.restoreFrame(frame.id);
  const resolved = resolveRestoredFrameName(
    restored.name,
    siblingFrameNames(activeFrames, restored.parentId, restored.id),
  );
  if (resolved === restored.name) {
    return { frame: restored, renamedFrom: null };
  }
  try {
    const renamed = await backend.renameFrame(restored.id, resolved);
    return { frame: renamed, renamedFrom: restored.name };
  } catch {
    return { frame: restored, renamedFrom: null };
  }
}

/** The name a Frame would get on restore, or null when it keeps its own. */
export function previewRestoredFrameName(
  frame: Frame,
  activeFrames: readonly Frame[],
): string | null {
  const resolved = resolveRestoredFrameName(
    frame.name,
    siblingFrameNames(activeFrames, frame.parentId, frame.id),
  );
  return resolved === frame.name ? null : resolved;
}

export async function deleteFragmentsForever(
  backend: TrashBackend,
  ids: readonly string[],
): Promise<string[]> {
  const realIds = uniqueVaultIds(ids);
  if (realIds.length === 0) return [];
  await backend.deleteFragments(realIds, null);
  return realIds;
}

export async function deleteFrameForever(
  backend: TrashBackend,
  frameId: string,
): Promise<void> {
  await backend.deleteFrame(frameId, null);
}

export function canUndoRestore(retention: TrashRetention): boolean {
  return retention.kind === "days";
}

/** Undo of a restore: the rows go back to Trash under the current policy. */
export async function moveFragmentsBackToTrash(
  backend: TrashBackend,
  ids: readonly string[],
  retention: TrashRetention,
): Promise<string[]> {
  const days = retentionDays(retention);
  if (days === null) {
    throw new Error("Retention is off, so Undo would delete forever");
  }
  const realIds = uniqueVaultIds(ids);
  if (realIds.length === 0) return [];
  await backend.deleteFragments(realIds, days);
  return realIds;
}

export async function moveFrameBackToTrash(
  backend: TrashBackend,
  frameId: string,
  retention: TrashRetention,
): Promise<void> {
  const days = retentionDays(retention);
  if (days === null) {
    throw new Error("Retention is off, so Undo would delete forever");
  }
  await backend.deleteFrame(frameId, days);
}

export async function emptyTrashNow(
  backend: TrashBackend,
): Promise<EmptyTrashSummary> {
  const report = await backend.emptyTrash();
  return { fragments: report.fragments, frames: report.frames };
}
