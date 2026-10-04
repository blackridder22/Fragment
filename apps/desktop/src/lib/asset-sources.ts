import type { Fragment } from "@fragment/shared";
import type { AssetSource } from "./assets";
import { assetUrl } from "./tauri";

export type AssetMode = "detail" | "gallery";

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.filter((value): value is string => Boolean(value && value.trim())),
    ),
  );
}

export function assetPathCandidates(fragment: Fragment, mode: AssetMode) {
  const paths =
    mode === "detail"
      ? [fragment.previewPath, fragment.thumbnailPath, fragment.originalPath]
      : [fragment.thumbnailPath, fragment.previewPath, fragment.originalPath];
  return uniqueValues(
    fragment.mimeType === "image/svg+xml"
      ? paths.filter((path) => path !== fragment.originalPath)
      : paths,
  );
}

export function assetSourcesFor(
  fragment: Fragment,
  mode: AssetMode,
  assetRoot: string,
  assetDataUrls: Readonly<Record<string, string>>,
): AssetSource[] {
  return assetPathCandidates(fragment, mode)
    .map((relativePath) => {
      if (relativePath.startsWith("/demo")) {
        return { url: relativePath };
      }
      const dataUrl = assetDataUrls[relativePath];
      if (dataUrl) {
        return { url: dataUrl };
      }
      return {
        relativePath,
        url: assetRoot ? assetUrl(assetRoot, relativePath) : "",
      };
    })
    .filter((source) => Boolean(source.url));
}

type CacheEntry = {
  assetRoot: string;
  assetDataUrls: Readonly<Record<string, string>>;
  sources: AssetSource[];
};

/**
 * Caches asset sources per Fragment object. The same Fragment with the same
 * asset root and data-URL map returns the same array, so memoized cards keep
 * their props stable across page appends and unrelated state changes.
 */
export function createAssetSourceCache(mode: AssetMode) {
  const cache = new WeakMap<Fragment, CacheEntry>();
  return (
    fragment: Fragment,
    assetRoot: string,
    assetDataUrls: Readonly<Record<string, string>>,
  ): AssetSource[] => {
    const hit = cache.get(fragment);
    if (
      hit &&
      hit.assetRoot === assetRoot &&
      hit.assetDataUrls === assetDataUrls
    ) {
      return hit.sources;
    }
    const sources = assetSourcesFor(fragment, mode, assetRoot, assetDataUrls);
    if (
      hit &&
      hit.sources.length === sources.length &&
      hit.sources.every(
        (source, index) =>
          source.url === sources[index]!.url &&
          source.relativePath === sources[index]!.relativePath,
      )
    ) {
      cache.set(fragment, { assetRoot, assetDataUrls, sources: hit.sources });
      return hit.sources;
    }
    cache.set(fragment, { assetRoot, assetDataUrls, sources });
    return sources;
  };
}
