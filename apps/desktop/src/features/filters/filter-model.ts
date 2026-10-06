import type { ColorFilter } from "@fragment/shared";

export type FragmentFilter = {
  color?: ColorFilter | null;
  query?: string | null;
  tags?: string[];
  mimeTypes?: string[];
  sourceDomain?: string | null;
  sourceKind?: "all" | "source" | "local" | null;
  capturedAfter?: string | null;
  capturedBefore?: string | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  orientation?: "all" | "landscape" | "portrait" | "square" | null;
  minFileSize?: number | null;
  maxFileSize?: number | null;
  hasNotes?: boolean | null;
  noteContains?: string | null;
  titleContains?: string | null;
  siteContains?: string | null;
  creatorContains?: string | null;
};

export type SmartFrame = {
  id: string;
  name: string;
  filter: FragmentFilter;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_FRAGMENT_FILTER: FragmentFilter = {
  tags: [],
  mimeTypes: [],
  sourceKind: "all",
  orientation: "all",
};

function cleanText(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? clean : undefined;
}

function cleanNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

export function normalizeFragmentFilter(
  filter: FragmentFilter,
): FragmentFilter {
  const tags = [
    ...new Set((filter.tags ?? []).map(cleanText).filter(Boolean)),
  ] as string[];
  const mimeTypes = [
    ...new Set((filter.mimeTypes ?? []).map(cleanText).filter(Boolean)),
  ] as string[];
  return {
    color: filter.color ?? undefined,
    query: cleanText(filter.query),
    tags,
    mimeTypes,
    sourceDomain: cleanText(filter.sourceDomain),
    sourceKind:
      filter.sourceKind && filter.sourceKind !== "all"
        ? filter.sourceKind
        : undefined,
    capturedAfter: cleanText(filter.capturedAfter),
    capturedBefore: filter.capturedBefore
      ? `${filter.capturedBefore.slice(0, 10)}T23:59:59.999Z`
      : undefined,
    minWidth: cleanNumber(filter.minWidth),
    maxWidth: cleanNumber(filter.maxWidth),
    minHeight: cleanNumber(filter.minHeight),
    maxHeight: cleanNumber(filter.maxHeight),
    orientation:
      filter.orientation && filter.orientation !== "all"
        ? filter.orientation
        : undefined,
    minFileSize: cleanNumber(filter.minFileSize),
    maxFileSize: cleanNumber(filter.maxFileSize),
    hasNotes:
      typeof filter.hasNotes === "boolean" ? filter.hasNotes : undefined,
    noteContains: cleanText(filter.noteContains),
    titleContains: cleanText(filter.titleContains),
    siteContains: cleanText(filter.siteContains),
    creatorContains: cleanText(filter.creatorContains),
  };
}

export function activeFilterCount(filter: FragmentFilter) {
  const normalized = normalizeFragmentFilter(filter);
  return Object.entries(normalized).reduce((count, [, value]) => {
    if (Array.isArray(value)) return count + (value.length > 0 ? 1 : 0);
    return count + (value === undefined ? 0 : 1);
  }, 0);
}

export function filterWithLibraryControls(
  filter: FragmentFilter,
  query: string,
  sourceKind: "all" | "source" | "local" | "png",
): FragmentFilter {
  const mimeTypes = [...(filter.mimeTypes ?? [])];
  if (sourceKind === "png" && !mimeTypes.includes("image/png")) {
    mimeTypes.push("image/png");
  }
  return normalizeFragmentFilter({
    ...filter,
    query,
    mimeTypes,
    sourceKind: sourceKind === "png" ? "all" : sourceKind,
  });
}
