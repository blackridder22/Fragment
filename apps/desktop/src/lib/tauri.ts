import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Fragment, Frame } from "@fragment/shared";

export type LibrarySnapshot = {
  defaultFrame: Frame;
  frames: Frame[];
  fragments: Fragment[];
  fragmentTotal: number;
  trashTotal: number;
  frameCounts: Record<string, number>;
  revision: string;
  assetRoot: string;
};

export type FragmentPage = {
  items: Fragment[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  revision: string;
};

export type ImportBatchItem = {
  requestId: string;
  frameId: string | null;
  filePath: string;
  titleOverride?: string | null;
};

export type ImportBatchResult = {
  requestId: string;
  ok: boolean;
  fragment?: Fragment | null;
  error?: string | null;
  errorCode?: string | null;
  existingFragmentId?: string | null;
  existingTrashed?: boolean | null;
  outcome?: "new" | "linked" | "skipped" | null;
};

export type ImportBatchEvent =
  | { event: "queued"; jobId: string; requestId: string }
  | { event: "preparing"; jobId: string; requestId: string }
  | {
      event: "complete";
      jobId: string;
      requestId: string;
      fragment: Fragment;
      linked: boolean;
    }
  | {
      event: "skipped";
      jobId: string;
      requestId: string;
      existingFragmentId: string;
      existingTrashed: boolean;
    }
  | {
      event: "failed";
      jobId: string;
      requestId: string;
      error: string;
      errorCode?: string | null;
      existingFragmentId?: string | null;
      existingTrashed?: boolean | null;
    }
  | { event: "cancelled"; jobId: string; requestId: string }
  | {
      event: "finished";
      jobId: string;
      completed: number;
      linked: number;
      skipped: number;
      failed: number;
      cancelled: number;
    };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function ensureDefaultFrame(): Promise<Frame> {
  return invoke("ensure_default_frame");
}

export async function loadLibrarySnapshot(
  limit = 60,
): Promise<LibrarySnapshot> {
  return invoke("load_library_snapshot", { limit });
}

export async function listFragmentPage(options: {
  frameId?: string | null;
  includeDescendants?: boolean;
  trashed?: boolean;
  offset?: number;
  limit?: number;
}): Promise<FragmentPage> {
  return invoke("list_fragment_page", {
    frameId: options.frameId ?? null,
    includeDescendants: options.includeDescendants ?? false,
    trashed: options.trashed ?? false,
    offset: options.offset ?? 0,
    limit: options.limit ?? 60,
  });
}

export async function listFragmentIds(options: {
  frameId?: string | null;
  includeDescendants?: boolean;
  trashed?: boolean;
  query?: string;
  sourceFilter?: "all" | "source" | "local" | "png";
}): Promise<string[]> {
  return invoke("list_fragment_ids", {
    frameId: options.frameId ?? null,
    includeDescendants: options.includeDescendants ?? false,
    trashed: options.trashed ?? false,
    query: options.query?.trim() || null,
    sourceFilter: options.sourceFilter ?? "all",
  });
}

export async function getLibraryRevision(): Promise<string> {
  return invoke("get_library_revision");
}

export async function listFrames(): Promise<Frame[]> {
  return invoke("list_frames");
}

export async function createFrame(
  name: string,
  parentId: string | null = null,
): Promise<Frame> {
  return invoke("create_frame", { parentId, name });
}

export async function renameFrame(id: string, name: string): Promise<Frame> {
  return invoke("rename_frame", { id, name });
}

export async function moveFrame(
  id: string,
  parentId: string | null,
  position: number,
): Promise<Frame> {
  return invoke("move_frame", { id, parentId, position });
}

export async function deleteFrame(
  id: string,
  retentionDays: number | null = 31,
): Promise<void> {
  if (retentionDays === null) {
    return invoke("hard_delete_frame", { id });
  }
  return invoke("delete_frame", { id, retentionDays });
}

export async function listTrashedFrames(): Promise<Frame[]> {
  return invoke("list_trashed_frames");
}

export async function restoreFrame(id: string): Promise<Frame> {
  return invoke("restore_frame", { id });
}

export type PurgeReport = {
  fragments: number;
  frames: number;
  assets: number;
  cleanup: { removed: number; deferred: number };
};

export async function purgeExpiredTrash(): Promise<PurgeReport> {
  return invoke("purge_expired_trash");
}

export async function listAllFragments(): Promise<Fragment[]> {
  return invoke("list_all_fragments");
}

export async function listTrashedFragments(): Promise<Fragment[]> {
  return invoke("list_trashed_fragments");
}

export async function updateFragment(
  id: string,
  title: string | null,
  note: string | null,
): Promise<Fragment> {
  return invoke("update_fragment", { id, title, note });
}

export async function getFragmentAny(id: string): Promise<Fragment> {
  return invoke("get_fragment_any", { id });
}

export async function fragmentMembershipCount(id: string): Promise<number> {
  return invoke("fragment_membership_count", { id });
}

export async function addExistingFragmentToFrame(
  existingFragmentId: string,
  frameId: string | null,
): Promise<Fragment> {
  return invoke("add_existing_fragment_to_frame", {
    existingFragmentId,
    frameId,
  });
}

export async function importImage(
  frameId: string | null,
  filePath: string,
  titleOverride?: string | null,
): Promise<Fragment> {
  return invoke("import_image", { frameId, filePath, titleOverride });
}

export async function importImageBatch(
  jobId: string,
  items: ImportBatchItem[],
  onEvent: (event: ImportBatchEvent) => void,
): Promise<ImportBatchResult[]> {
  const channel = new Channel<ImportBatchEvent>();
  channel.onmessage = onEvent;
  return invoke("import_image_batch", { jobId, items, onEvent: channel });
}

export async function cancelImportJob(jobId: string): Promise<void> {
  return invoke("cancel_import_job", { jobId });
}

export async function deleteFragment(
  id: string,
  retentionDays?: number | null,
): Promise<void> {
  return invoke("delete_fragment", { id, retentionDays });
}

export async function restoreFragment(id: string): Promise<Fragment> {
  return invoke("restore_fragment", { id });
}

export async function deleteFragmentEverywhere(
  id: string,
  retentionDays: number | null = 31,
): Promise<void> {
  return invoke("delete_fragment_everywhere", { id, retentionDays });
}

export async function deleteFragments(
  ids: string[],
  retentionDays: number | null,
): Promise<number> {
  return invoke("delete_fragments", { ids, retentionDays });
}

export async function restoreFragments(ids: string[]): Promise<number> {
  return invoke("restore_fragments", { ids });
}

export async function revealFragmentInFinder(id: string): Promise<void> {
  return invoke("reveal_fragment_in_finder", { id });
}

export async function openFragmentSource(id: string): Promise<void> {
  return invoke("open_fragment_source", { id });
}

export async function copyFragmentImage(id: string): Promise<void> {
  return invoke("copy_fragment_image", { id });
}

export async function loadAssetRoot(): Promise<string> {
  return invoke("asset_root");
}

export async function loadAssetDataUrl(relativePath: string): Promise<string> {
  return invoke("asset_data_url", { relativePath });
}

export function assetUrl(root: string, relativePath?: string | null): string {
  if (!relativePath) {
    return "";
  }
  return convertFileSrc(`${root}/${relativePath}`);
}
