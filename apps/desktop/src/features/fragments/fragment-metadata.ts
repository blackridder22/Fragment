export function normalizeTagDraft(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function sourceDomain(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function aspectRatioLabel(
  width?: number | null,
  height?: number | null,
): string {
  if (!width || !height) return "Unknown";
  const divisor = greatestCommonDivisor(width, height);
  const left = width / divisor;
  const right = height / divisor;
  if (left <= 24 && right <= 24) return `${left}:${right}`;
  return (width / height).toFixed(2);
}

export function formatLabel(
  mimeType?: string | null,
  originalPath?: string | null,
): string {
  const subtype = mimeType?.split("/")[1]?.split(";")[0]?.trim();
  if (subtype === "svg+xml") return "SVG";
  if (subtype) return subtype.replace("jpeg", "jpg").toUpperCase();
  const extension = originalPath?.split(".").pop();
  return extension && extension !== originalPath
    ? extension.toUpperCase()
    : "Unknown";
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}
