import { assetUrl, ensureSvgPreview, loadAssetDataUrl } from "../lib/tauri";
import { libraryStore } from "./library-store";

const { getState, setState } = libraryStore;
const pendingRequests: Partial<Record<string, Promise<string | null>>> = {};
const svgRepairs = new Map<string, Promise<void>>();
const MAX_ENTRIES = 32;
const MAX_BYTES = 24 * 1024 * 1024;

/**
 * Emergency fallback when the asset protocol fails for a derivative: repairs
 * SVG previews, otherwise loads a data URL (bounded cache).
 */
export async function resolveAssetFallback(
  relativePath: string,
): Promise<string | null> {
  if (
    relativePath.toLowerCase().endsWith(".svg") ||
    relativePath.includes("svg-cache/")
  ) {
    return null;
  }
  const state = getState();
  const cached = state.assetDataUrls[relativePath];
  if (cached) return cached;
  const pending = pendingRequests[relativePath];
  if (pending) return pending;

  const svg = [
    ...state.activePage.items,
    ...state.trashPage.items,
    ...state.coverFragments,
  ].find(
    (fragment) =>
      fragment.mimeType === "image/svg+xml" &&
      (fragment.thumbnailPath === relativePath ||
        fragment.previewPath === relativePath),
  );
  const fallback = async () => {
    if (!svg) return loadAssetDataUrl(relativePath);
    const key = svg.assetId ?? svg.id;
    let repair = svgRepairs.get(key);
    if (!repair) {
      repair = ensureSvgPreview(svg.id, 1600, crypto.randomUUID(), true).then(
        () => undefined,
      );
      if (svgRepairs.size >= MAX_ENTRIES) {
        const oldest = svgRepairs.keys().next().value;
        if (oldest) svgRepairs.delete(oldest);
      }
      svgRepairs.set(key, repair);
    }
    await repair;
    return `${assetUrl(getState().assetRoot, relativePath)}?repair=1`;
  };
  const request = fallback()
    .then((dataUrl) => {
      setState((current) => {
        if (current.assetDataUrls[relativePath]) return {};
        const entries = Object.entries(current.assetDataUrls);
        let bytes =
          dataUrl.length +
          entries.reduce((sum, [, value]) => sum + value.length, 0);
        while (
          entries.length &&
          (entries.length >= MAX_ENTRIES || bytes > MAX_BYTES)
        ) {
          const removed = entries.shift();
          if (removed) bytes -= removed[1].length;
        }
        return {
          assetDataUrls:
            dataUrl.length > MAX_BYTES
              ? Object.fromEntries(entries)
              : { ...Object.fromEntries(entries), [relativePath]: dataUrl },
        };
      });
      delete pendingRequests[relativePath];
      return dataUrl;
    })
    .catch(() => {
      delete pendingRequests[relativePath];
      return null;
    });
  pendingRequests[relativePath] = request;
  return request;
}
