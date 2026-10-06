import {
  Channel,
  convertFileSrc,
  invoke as tauriInvoke,
} from "@tauri-apps/api/core";
import type {
  Fragment,
  Frame,
  FragmentPalette,
  PaletteIndexStatus,
  FragmentMediaInfo,
  SvgPreviewResult,
} from "@fragment/shared";
import type {
  FragmentFilter,
  SmartFrame,
} from "../features/filters/filter-model";
import { instrumentInvoke } from "./perf";

/** Tauri `invoke`, counted and timed when the dev perf flag is on. */
const invoke = instrumentInvoke(tauriInvoke);

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
  paletteRevision?: string | null;
};

export const startPaletteIndexing = () =>
  invoke<void>("start_palette_indexing");
export const setPalettePriority = (
  fragmentId: string | null,
  frameId: string | null,
) => invoke<void>("set_palette_priority", { fragmentId, frameId });
export const getFragmentPalette = (id: string) =>
  invoke<FragmentPalette>("get_fragment_palette", { id });
export const getPaletteIndexStatus = () =>
  invoke<PaletteIndexStatus>("get_palette_index_status");
export const retryFragmentPalette = (id: string) =>
  invoke<void>("retry_fragment_palette", { id });
export const getFragmentMediaInfo = (id: string) =>
  invoke<FragmentMediaInfo>("get_fragment_media_info", { id });
export const ensureSvgPreview = (
  id: string,
  maxEdge: number,
  requestId: string,
  repair = false,
) =>
  invoke<SvgPreviewResult>("ensure_svg_preview", {
    id,
    maxEdge,
    requestId,
    repair,
  });
export const cancelSvgPreview = (requestId: string) =>
  invoke<void>("cancel_svg_preview", { requestId });

export type FragmentPageSortMode =
  | "newest"
  | "oldest"
  | "name"
  | "largest"
  | "deleted"
  | "deleted-oldest";

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

export type NativeHostStatus = {
  ready: boolean;
  label: string;
  description?: string;
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
  filter?: FragmentFilter;
  sortMode?: FragmentPageSortMode;
}): Promise<FragmentPage> {
  return invoke("list_fragment_page", {
    frameId: options.frameId ?? null,
    includeDescendants: options.includeDescendants ?? false,
    trashed: options.trashed ?? false,
    offset: options.offset ?? 0,
    limit: options.limit ?? 60,
    filter: options.filter ?? null,
    sortMode: options.sortMode ?? "newest",
  });
}

export async function listFragmentIds(options: {
  expectedPaletteRevision?: string | null;
  frameId?: string | null;
  includeDescendants?: boolean;
  trashed?: boolean;
  query?: string;
  sourceFilter?: "all" | "source" | "local" | "png";
  filter?: FragmentFilter;
  sortMode?: "newest" | "oldest" | "name" | "largest";
}): Promise<string[]> {
  return invoke("list_fragment_ids", {
    expectedPaletteRevision: options.expectedPaletteRevision ?? null,
    frameId: options.frameId ?? null,
    includeDescendants: options.includeDescendants ?? false,
    trashed: options.trashed ?? false,
    query: options.query?.trim() || null,
    sourceFilter: options.sourceFilter ?? "all",
    filter: options.filter ?? null,
    sortMode: options.sortMode ?? "newest",
  });
}

export type FramePreview = {
  frameId: string;
  fragments: Fragment[];
};

export async function listFramePreviews(
  limitPerFrame = 3,
): Promise<FramePreview[]> {
  return invoke("list_frame_previews", { limitPerFrame });
}

export async function listSmartFrames(): Promise<SmartFrame[]> {
  return invoke("list_smart_frames");
}

export async function createSmartFrame(
  name: string,
  filter: FragmentFilter,
): Promise<SmartFrame> {
  return invoke("create_smart_frame", { name, filter });
}

export async function updateSmartFrame(
  id: string,
  name: string,
  filter: FragmentFilter,
): Promise<SmartFrame> {
  return invoke("update_smart_frame", { id, name, filter });
}

export async function deleteSmartFrame(id: string): Promise<void> {
  return invoke("delete_smart_frame", { id });
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

export async function emptyTrash(): Promise<PurgeReport> {
  return invoke("empty_trash");
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

export async function getFragmentTags(id: string): Promise<string[]> {
  return invoke("get_fragment_tags", { id });
}

export async function listTags(): Promise<string[]> {
  return invoke("list_tags");
}

export async function setFragmentTags(
  id: string,
  tags: string[],
): Promise<string[]> {
  return invoke("set_fragment_tags", { id, tags });
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

export async function moveFragmentToFrame(
  id: string,
  frameId: string,
): Promise<Fragment> {
  return invoke("move_fragment_to_frame", { id, frameId });
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

export async function revealVaultInFinder(): Promise<void> {
  return invoke("reveal_vault_in_finder");
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

export async function nativeHostStatus(): Promise<NativeHostStatus> {
  return invoke("native_host_status");
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
