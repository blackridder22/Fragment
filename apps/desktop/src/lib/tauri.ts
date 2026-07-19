import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Fragment, Frame } from "@fragment/shared";

export type ImportDuplicateCheck = {
  duplicate: boolean;
  kind?:
    | "same_image"
    | "same_image_in_vault"
    | "same_name_and_pixels"
    | string
    | null;
  existingFragmentId?: string | null;
  existingFrameId?: string | null;
  existingFrameName?: string | null;
  existingTitle?: string | null;
  suggestedTitle?: string | null;
  width?: number | null;
  height?: number | null;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function ensureDefaultFrame(): Promise<Frame> {
  return invoke("ensure_default_frame");
}

export async function listFrames(): Promise<Frame[]> {
  return invoke("list_frames");
}

export async function createFrame(name: string): Promise<Frame> {
  return invoke("create_frame", { parentId: null, name });
}

export async function renameFrame(id: string, name: string): Promise<Frame> {
  return invoke("rename_frame", { id, name });
}

export async function deleteFrame(id: string): Promise<void> {
  return invoke("delete_frame", { id });
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
  note: string | null
): Promise<Fragment> {
  return invoke("update_fragment", { id, title, note });
}

export async function importImage(
  frameId: string | null,
  filePath: string,
  titleOverride?: string | null
): Promise<Fragment> {
  return invoke("import_image", { frameId, filePath, titleOverride });
}

export async function checkImportDuplicate(
  frameId: string | null,
  filePath: string
): Promise<ImportDuplicateCheck> {
  return invoke("check_import_duplicate", { frameId, filePath });
}

export async function deleteFragment(
  id: string,
  retentionDays?: number | null
): Promise<void> {
  return invoke("delete_fragment", { id, retentionDays });
}

export async function restoreFragment(id: string): Promise<Fragment> {
  return invoke("restore_fragment", { id });
}

export async function deleteFragmentEverywhere(id: string): Promise<void> {
  return invoke("delete_fragment_everywhere", { id });
}

export async function revealFragmentInFinder(id: string): Promise<void> {
  return invoke("reveal_fragment_in_finder", { id });
}

export async function openFragmentSource(id: string): Promise<void> {
  return invoke("open_fragment_source", { id });
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
