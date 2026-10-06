import type { Fragment } from "@fragment/shared";

export function formatMetadata(fragment: Fragment) {
  const parts: string[] = [];
  if (fragment.width && fragment.height) {
    parts.push(`${fragment.width} × ${fragment.height}`);
  }
  parts.push(fileType(fragment));
  if (fragment.fileSize) parts.push(formatBytes(fragment.fileSize));
  return parts.join(" · ");
}

export function fileType(fragment: Fragment) {
  if (fragment.mimeType === "image/svg+xml") return "SVG";
  const mimeSubtype = fragment.mimeType?.split("/").pop();
  const extension = fragment.originalPath.split(".").pop();
  const value = mimeSubtype || extension || "Image";
  if (value.toLowerCase() === "jpeg") return "JPG";
  return value.toUpperCase();
}

export function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} GB`;
}

export function sourceName(fragment: Fragment, sourceUrl: string | null) {
  if (fragment.siteName?.trim()) return fragment.siteName;
  if (!sourceUrl) return "Local Fragment";
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

export function compactSource(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return sourceUrl;
  }
}

export function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
