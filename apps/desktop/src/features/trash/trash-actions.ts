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
import {
  remainingRetentionDays,
  retentionDays,
  type TrashRetention,
} from "./retention";
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

export type FrameActionFailure = { frame: Frame; message: string };

/** Frames restored one by one; the failures stay in the Trash for a retry. */
export type FrameRestoreReport = {
  restored: RestoredFrameResult[];
  failed: FrameActionFailure[];
};

export type FrameDeleteReport = {
  deleted: Frame[];
  failed: FrameActionFailure[];
};

export type EmptyTrashSummary = { fragments: number; frames: number };

/** A restored Fragment to send back to the Trash when the restore is undone. */
export type RetrashFragment = { id: string; deleteAfter: string | null };

/** A restored Frame to send back to the Trash when the restore is undone. */
export type RetrashFrame = RestoredFrameResult & {
  /** The row's date before the restore (estimated for Frames). */
  deleteAfter: string | null;
};

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

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

/**
 * Restores several Frames in sequence against one accumulating sibling list,
 * so two trashed Frames with the same name restored together do not collide
 * with each other. A failure is reported and the rest still run.
 */
export async function restoreFramesWithUniqueNames(
  backend: TrashBackend,
  frames: readonly Frame[],
  activeFrames: readonly Frame[],
): Promise<FrameRestoreReport> {
  const known = [...activeFrames];
  const restored: RestoredFrameResult[] = [];
  const failed: FrameActionFailure[] = [];
  for (const frame of frames) {
    try {
      const result = await restoreFrameWithUniqueName(backend, frame, known);
      restored.push(result);
      known.push(result.frame);
    } catch (caught) {
      failed.push({ frame, message: errorMessage(caught) });
    }
  }
  return { restored, failed };
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

/** One `hard_delete_frame` per Frame (there is no batch command); failures are reported. */
export async function deleteFramesForever(
  backend: TrashBackend,
  frames: readonly Frame[],
): Promise<FrameDeleteReport> {
  const deleted: Frame[] = [];
  const failed: FrameActionFailure[] = [];
  for (const frame of frames) {
    try {
      await deleteFrameForever(backend, frame.id);
      deleted.push(frame);
    } catch (caught) {
      failed.push({ frame, message: errorMessage(caught) });
    }
  }
  return { deleted, failed };
}

export function canUndoRestore(retention: TrashRetention): boolean {
  return retention.kind === "days";
}

function requireRetentionDays(retention: TrashRetention): number {
  const days = retentionDays(retention);
  if (days === null) {
    throw new Error("Retention is off, so Undo would delete forever");
  }
  return days;
}

/**
 * Undo of a restore: the rows go back to Trash with the time they had left.
 * The backend only takes a whole number of retention days from now, so the
 * original `deleteAfter` is carried at day granularity: ids are grouped by the
 * days left and each group is one call (rows without a date get the policy).
 */
export async function moveFragmentsBackToTrash(
  backend: TrashBackend,
  entries: readonly RetrashFragment[],
  retention: TrashRetention,
  now: Date = new Date(),
): Promise<string[]> {
  const policyDays = requireRetentionDays(retention);
  const groups = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || entry.id.startsWith("demo-") || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    const days = remainingRetentionDays(entry.deleteAfter, policyDays, now);
    groups.set(days, [...(groups.get(days) ?? []), entry.id]);
  }
  for (const [days, ids] of groups) {
    await backend.deleteFragments(ids, days);
  }
  return Array.from(seen);
}

/**
 * Undo of a Frame restore. A Frame that was renamed on restore gets its name
 * back first (only active Frames can be renamed), then returns to the Trash
 * with the days it had left.
 */
export async function moveFrameBackToTrash(
  backend: TrashBackend,
  entry: RetrashFrame,
  retention: TrashRetention,
  now: Date = new Date(),
): Promise<void> {
  const policyDays = requireRetentionDays(retention);
  if (entry.renamedFrom) {
    try {
      await backend.renameFrame(entry.frame.id, entry.renamedFrom);
    } catch {
      // The Frame still returns to the Trash; it keeps the resolved name.
    }
  }
  await backend.deleteFrame(
    entry.frame.id,
    remainingRetentionDays(entry.deleteAfter, policyDays, now),
  );
}

export async function emptyTrashNow(
  backend: TrashBackend,
): Promise<EmptyTrashSummary> {
  const report = await backend.emptyTrash();
  return { fragments: report.fragments, frames: report.frames };
}
