export const FRAGMENT_TITLE_MAX_CODE_POINTS = 120;

const ELLIPSIS = "…";

export function normalizeFragmentTitle(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const codePoints = Array.from(normalized);

  if (codePoints.length <= FRAGMENT_TITLE_MAX_CODE_POINTS) {
    return normalized;
  }

  return `${codePoints
    .slice(0, FRAGMENT_TITLE_MAX_CODE_POINTS - 1)
    .join("")}${ELLIPSIS}`;
}
