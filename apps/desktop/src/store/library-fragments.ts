import type { Fragment } from "@fragment/shared";
import { descendantFrameIds } from "../features/frames/frame-tree";
import { normalizeFragmentTitle } from "../features/fragments/fragment-title-policy";
import { createSelectionState } from "../features/selection/selection-model";
import { addTag, normalizeTags } from "../features/tags/tag-editor-model";
import {
  movePreviewItemsToTrash,
  purgePreviewTrash,
  restorePreviewItems,
} from "../features/trash/preview-trash-state";
import { isDemoFragment } from "../lib/demo-vault";
import {
  addExistingFragmentToFrame,
  copyFragmentImage,
  deleteFragments,
  emptyTrash as emptyNativeTrash,
  getFragmentTags,
  isTauriRuntime,
  listTags,
  moveFragmentToFrame,
  openFragmentSource,
  restoreFragments,
  revealFragmentInFinder,
  setFragmentTags,
  updateFragment,
} from "../lib/tauri";
import {
  closeContextMenu,
  deselectAll,
  patchFragmentTags,
  selectFrame,
} from "./library-actions";
import { refreshSnapshot } from "./library-bootstrap";
import { confirmAction, reportError, showToast } from "./library-feedback";
import { currentPageKey, libraryLoader } from "./library-loader";
import {
  pluralize,
  selectDeleteRetentionDays,
  selectDisplayFrames,
  selectSelectedIds,
} from "./library-selectors";
import { createPageState, libraryStore } from "./library-store";
import type { LibraryState } from "./library-types";
import { offerUndo } from "./library-undo";

const { getState, setState } = libraryStore;

/** Whether a Fragment in `frameId` belongs to the currently selected scope. */
export function activeScopeIncludes(state: LibraryState, frameId: string) {
  if (!state.selectedFrameId) return true;
  if (state.selectedFrameId === frameId) return true;
  return (
    state.frameNavigator.includeDescendants &&
    descendantFrameIds(state.frames, state.selectedFrameId).includes(frameId)
  );
}

export function adjustFrameCounts(deltas: Readonly<Record<string, number>>) {
  setState((state) => {
    const frameCounts = { ...state.frameCounts };
    for (const [frameId, delta] of Object.entries(deltas)) {
      frameCounts[frameId] = Math.max(0, (frameCounts[frameId] ?? 0) + delta);
    }
    return { frameCounts };
  });
}

export function patchFragmentEverywhere(updated: Fragment) {
  const replace = (fragment: Fragment) =>
    fragment.id === updated.id ? updated : fragment;
  setState((state) => ({
    activePage: {
      ...state.activePage,
      items: state.activePage.items.map(replace),
    },
    trashPage: {
      ...state.trashPage,
      items: state.trashPage.items.map(replace),
    },
    coverFragments: state.coverFragments.map(replace),
    focused:
      state.focused?.fragment.id === updated.id
        ? { ...state.focused, fragment: updated }
        : state.focused,
  }));
}

export type RemovedEntry = { fragment: Fragment; index: number };

export function removeFragmentsFromActivePage(ids: ReadonlySet<string>) {
  const removed: RemovedEntry[] = [];
  setState((state) => {
    const items: Fragment[] = [];
    state.activePage.items.forEach((fragment, index) => {
      if (ids.has(fragment.id)) removed.push({ fragment, index });
      else items.push(fragment);
    });
    const total = Math.max(items.length, state.activePage.total - ids.size);
    return {
      activePage: {
        ...state.activePage,
        items,
        total,
        hasMore: items.length < total,
      },
      coverFragments: state.coverFragments.filter(
        (fragment) => !ids.has(fragment.id),
      ),
    };
  });
  return removed;
}

export function removeFragmentsFromTrashPage(ids: ReadonlySet<string>) {
  setState((state) => {
    const items = state.trashPage.items.filter(
      (fragment) => !ids.has(fragment.id),
    );
    const total = Math.max(items.length, state.trashPage.total - ids.size);
    return {
      trashPage: {
        ...state.trashPage,
        items,
        total,
        hasMore: items.length < total,
      },
      trashTotal: Math.max(0, state.trashTotal - ids.size),
    };
  });
}

export function prependToActivePage(fragments: Fragment[]) {
  if (fragments.length === 0) return;
  setState((state) => {
    const incoming = new Set(fragments.map((fragment) => fragment.id));
    const items = [
      ...fragments,
      ...state.activePage.items.filter(
        (fragment) => !incoming.has(fragment.id),
      ),
    ];
    const total =
      state.activePage.total + (items.length - state.activePage.items.length);
    return {
      activePage: {
        ...state.activePage,
        items,
        total,
        hasMore: items.length < total,
      },
    };
  });
}

export async function saveFragmentMeta(
  fragment: Fragment,
  title: string | null,
  note: string | null,
) {
  if (isDemoFragment(fragment)) return;
  const updated = await updateFragment(fragment.id, title, note);
  patchFragmentEverywhere(updated);
  showToast("Fragment saved", { tone: "success" });
}

export async function saveFocusedTitle(fragment: Fragment, title: string) {
  const normalizedTitle = normalizeFragmentTitle(title);
  if (!normalizedTitle) {
    throw new Error("Enter a title before saving.");
  }
  if (getState().previewMode || isDemoFragment(fragment)) {
    setState((state) => ({
      previewTitleOverrides: {
        ...state.previewTitleOverrides,
        [fragment.id]: normalizedTitle,
      },
    }));
    showToast("Fragment title saved", { tone: "success" });
    return;
  }
  await saveFragmentMeta(fragment, normalizedTitle, fragment.note ?? null);
}

export async function saveFocusedNotes(fragment: Fragment, notes: string) {
  await saveFragmentMeta(fragment, fragment.title ?? null, notes);
}

function sortedTags(tags: readonly string[]) {
  return normalizeTags(tags).sort((left, right) => left.localeCompare(right));
}

async function refreshKnownTags(fallback: readonly string[]) {
  const refreshed = await listTags().catch(() => null);
  setState((state) => ({
    knownTags: sortedTags(refreshed ?? [...state.knownTags, ...fallback]),
  }));
}

export async function saveFocusedTags(fragment: Fragment, tags: string[]) {
  const normalizedTags = normalizeTags(tags);
  if (getState().previewMode || isDemoFragment(fragment)) {
    patchFragmentTags(fragment.id, normalizedTags);
    showToast("Tags saved", { tone: "success" });
    return;
  }
  try {
    const updatedTags = normalizeTags(
      await setFragmentTags(fragment.id, normalizedTags),
    );
    patchFragmentTags(fragment.id, updatedTags);
    await refreshKnownTags(updatedTags);
    showToast("Tags saved", { tone: "success" });
  } catch (caught) {
    setState((state) => ({
      fragmentTagStatusById: {
        ...state.fragmentTagStatusById,
        [fragment.id]: "ready",
      },
    }));
    reportError(caught);
    showToast("Tags could not be saved", { tone: "error" });
    throw caught;
  }
}

export async function tagSelectedFragments(tag: string) {
  const state = getState();
  const ids = Array.from(new Set(selectSelectedIds(state)));
  if (ids.length === 0) {
    throw new Error("Select at least one Fragment to add a tag");
  }
  if (state.previewMode) {
    setState((current) => {
      const fragmentTagsById = { ...current.fragmentTagsById };
      const fragmentTagStatusById = { ...current.fragmentTagStatusById };
      for (const id of ids) {
        fragmentTagsById[id] = addTag(fragmentTagsById[id] ?? [], tag);
        fragmentTagStatusById[id] = "ready";
      }
      return {
        fragmentTagsById,
        fragmentTagStatusById,
        knownTags: sortedTags([...current.knownTags, tag]),
      };
    });
    showToast(`Tagged ${pluralize(ids.length, "Fragment")}`, {
      tone: "success",
    });
    return;
  }
  const updated: Record<string, string[]> = {};
  let tagged = 0;
  let failed = 0;
  let lastError = "";
  for (const id of ids.filter((value) => !value.startsWith("demo-"))) {
    try {
      const cached =
        state.fragmentTagStatusById[id] === "ready"
          ? state.fragmentTagsById[id]
          : null;
      const currentTags = cached ?? (await getFragmentTags(id));
      updated[id] = normalizeTags(
        await setFragmentTags(id, addTag(currentTags, tag)),
      );
      tagged += 1;
    } catch (caught) {
      failed += 1;
      lastError = caught instanceof Error ? caught.message : String(caught);
    }
  }
  if (tagged > 0) {
    setState((current) => ({
      fragmentTagsById: { ...current.fragmentTagsById, ...updated },
      fragmentTagStatusById: {
        ...current.fragmentTagStatusById,
        ...Object.fromEntries(
          Object.keys(updated).map((id) => [id, "ready" as const]),
        ),
      },
    }));
    await refreshKnownTags([tag]);
  }
  const label = [
    `Tagged ${pluralize(tagged, "Fragment")}`,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  showToast(label, { tone: failed > 0 ? "error" : "success" });
  if (lastError) reportError(lastError);
  if (tagged === 0 && failed > 0) {
    throw new Error(lastError || "Tagging failed");
  }
}

/** Patches the pages after the backend moved a Fragment to another Frame. */
function applyFragmentMove(updated: Fragment, previousFrameId: string) {
  patchFragmentEverywhere(updated);
  if (previousFrameId !== updated.frameId) {
    adjustFrameCounts({ [previousFrameId]: -1, [updated.frameId]: 1 });
  }
  const state = getState();
  if (!activeScopeIncludes(state, updated.frameId)) {
    removeFragmentsFromActivePage(new Set([updated.id]));
  }
}

export async function moveFragmentToFrameAction(
  fragment: Fragment,
  targetFrameId: string,
) {
  const state = getState();
  const target = selectDisplayFrames(state).find(
    (frame) => frame.id === targetFrameId,
  );
  if (!target) {
    throw new Error("Destination Frame was not found");
  }
  if (fragment.frameId === targetFrameId) {
    showToast(`Fragment is already in ${target.name}`);
    return;
  }
  try {
    setState({ error: null });
    if (isDemoFragment(fragment)) {
      setState((current) => ({
        previewFrameAssignments: {
          ...current.previewFrameAssignments,
          [fragment.id]: targetFrameId,
        },
      }));
    } else {
      const updated = await moveFragmentToFrame(fragment.id, targetFrameId);
      applyFragmentMove(updated, fragment.frameId);
    }
    setState({ focused: null, contextMenu: null });
    selectFrame(targetFrameId);
    showToast(
      `Moved ${fragment.title?.trim() || "Fragment"} to ${target.name}`,
      {
        tone: "success",
      },
    );
  } catch (caught) {
    reportError(caught);
    showToast("Move failed", { tone: "error" });
    throw caught;
  }
}

export async function moveSelectedFragmentsToFrame(
  ids: string[],
  targetFrameId: string,
) {
  const state = getState();
  const target = selectDisplayFrames(state).find(
    (frame) => frame.id === targetFrameId,
  );
  if (!target) {
    throw new Error("Destination Frame was not found");
  }
  const uniqueIds = Array.from(new Set(ids));
  if (state.previewMode) {
    const demoIds = uniqueIds.filter((id) => id.startsWith("demo-"));
    if (demoIds.length === 0) {
      throw new Error("No selected Fragments are available to move");
    }
    setState((current) => ({
      previewFrameAssignments: {
        ...current.previewFrameAssignments,
        ...Object.fromEntries(demoIds.map((id) => [id, targetFrameId])),
      },
      contextMenu: null,
    }));
    deselectAll();
    showToast(
      `Moved ${pluralize(demoIds.length, "Fragment")} to ${target.name}`,
      {
        tone: "success",
      },
    );
    return;
  }
  const realIds = uniqueIds.filter((id) => !id.startsWith("demo-"));
  if (realIds.length === 0) {
    throw new Error("No saved Fragments are available to move");
  }
  const loadedById = new Map(
    [...state.activePage.items, ...state.coverFragments].map((fragment) => [
      fragment.id,
      fragment,
    ]),
  );
  let moved = 0;
  let skipped = 0;
  let failed = 0;
  let lastError = "";
  for (const id of realIds) {
    const loaded = loadedById.get(id);
    if (loaded?.frameId === targetFrameId) {
      skipped += 1;
      continue;
    }
    try {
      const updated = await moveFragmentToFrame(id, targetFrameId);
      if (loaded) applyFragmentMove(updated, loaded.frameId);
      else adjustFrameCounts({ [updated.frameId]: 1 });
      moved += 1;
    } catch (caught) {
      failed += 1;
      lastError = caught instanceof Error ? caught.message : String(caught);
    }
  }
  if (moved > 0) deselectAll();
  closeContextMenu();
  const label = [
    `Moved ${moved} to ${target.name}`,
    skipped > 0 ? `${skipped} already there` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  showToast(label, { tone: failed > 0 ? "error" : "success" });
  if (lastError) reportError(lastError);
  if (moved === 0 && failed > 0) {
    throw new Error(lastError || "Move failed");
  }
}

/** Links existing Fragments into another Frame (drop onto the Frame tree). */
export async function linkFragmentsToFrame(ids: string[], frameId: string) {
  const state = getState();
  const frame = state.frames.find((item) => item.id === frameId);
  if (!frame) {
    throw new Error("Destination Frame was not found");
  }
  const linked: Fragment[] = [];
  let skipped = 0;
  let failed = 0;
  let lastError = "";
  for (const id of new Set(ids.filter((value) => !value.startsWith("demo-")))) {
    try {
      linked.push(await addExistingFragmentToFrame(id, frameId));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.includes("asset already belongs to Frame")) skipped += 1;
      else {
        failed += 1;
        lastError = message;
      }
    }
  }
  if (linked.length > 0) {
    adjustFrameCounts({ [frameId]: linked.length });
    setState((current) => ({
      coverFragments: [...linked, ...current.coverFragments],
    }));
    const current = getState();
    if (activeScopeIncludes(current, frameId)) {
      if (current.sortMode === "newest" && !current.fragmentFilter.color) {
        prependToActivePage(linked);
      } else {
        libraryLoader.invalidate("active");
      }
    }
  }
  if (lastError) reportError(lastError);
  const label = [
    `Added ${linked.length} to ${frame.name}`,
    skipped > 0 ? `${skipped} already there` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (linked.length > 0) {
    offerUndo(
      { kind: "linked", ids: linked.map((fragment) => fragment.id) },
      label,
    );
  } else {
    showToast(label, { tone: failed > 0 ? "error" : "info" });
  }
}

export async function moveFragmentsToTrash(ids: string[]): Promise<boolean> {
  const state = getState();
  if (state.undoPending) {
    showToast("Wait for Undo to finish");
    return false;
  }
  const uniqueIds = Array.from(new Set(ids));
  if (state.previewMode) {
    const demoIds = uniqueIds.filter((id) => id.startsWith("demo-"));
    if (demoIds.length === 0) return false;
    setState((current) => ({
      previewTrashState: movePreviewItemsToTrash(
        current.previewTrashState,
        demoIds,
      ),
      selection: createSelectionState(),
      focused:
        current.focused && demoIds.includes(current.focused.fragment.id)
          ? null
          : current.focused,
      contextMenu: null,
    }));
    offerUndo(
      { kind: "fragments", ids: demoIds, removed: [], pageKey: null },
      `${pluralize(demoIds.length, "Fragment")} moved to Trash`,
    );
    return true;
  }
  const realIds = uniqueIds.filter((id) => !id.startsWith("demo-"));
  if (realIds.length === 0) return false;
  const forever = state.deletePolicy === "forever";
  if (forever) {
    const confirmed = await confirmAction({
      title: `Delete ${pluralize(realIds.length, "Fragment")} forever?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete forever",
      destructive: true,
    });
    if (!confirmed) return false;
  }
  await deleteFragments(realIds, selectDeleteRetentionDays(state));
  const idSet = new Set(realIds);
  const removed = removeFragmentsFromActivePage(idSet);
  const deltas: Record<string, number> = {};
  for (const { fragment } of removed) {
    deltas[fragment.frameId] = (deltas[fragment.frameId] ?? 0) - 1;
  }
  adjustFrameCounts(deltas);
  setState((current) => ({
    trashTotal: forever
      ? current.trashTotal
      : current.trashTotal + realIds.length,
    trashPage: { ...current.trashPage, key: null },
    selection: createSelectionState(),
    contextMenu: null,
    focused:
      current.focused && idSet.has(current.focused.fragment.id)
        ? null
        : current.focused,
  }));
  if (removed.length < realIds.length) {
    // Some ids were not loaded, so their Frame counts are unknown locally.
    void refreshSnapshot();
  }
  if (forever) {
    showToast(`Deleted ${pluralize(realIds.length, "Fragment")}`, {
      tone: "success",
    });
  } else {
    offerUndo(
      {
        kind: "fragments",
        ids: realIds,
        removed,
        pageKey: getState().activePage.key,
      },
      `${pluralize(realIds.length, "Fragment")} moved to Trash`,
    );
  }
  return true;
}

export async function restoreTrashedFragment(fragment: Fragment) {
  if (isDemoFragment(fragment)) {
    setState((current) => ({
      previewTrashState: restorePreviewItems(current.previewTrashState, [
        fragment.id,
      ]),
    }));
    showToast("Restored Fragment", { tone: "success" });
    return;
  }
  setState({ error: null });
  await restoreFragments([fragment.id]);
  removeFragmentsFromTrashPage(new Set([fragment.id]));
  adjustFrameCounts({ [fragment.frameId]: 1 });
  setState((current) => ({
    coverFragments: [fragment, ...current.coverFragments],
  }));
  libraryLoader.invalidate("active");
  showToast("Restored Fragment", { tone: "success" });
}

export async function reportTrashRestoreFailure(caught: unknown) {
  await refreshSnapshot();
  reportError(caught);
  showToast("Restore failed · Try again", { tone: "error" });
}

export async function emptyTrashAction() {
  const state = getState();
  if (state.undoPending) {
    showToast("Wait for Undo to finish");
    return;
  }
  if (state.previewMode) {
    setState((current) => ({
      previewTrashState: purgePreviewTrash(current.previewTrashState),
      focused: null,
      undo: null,
      toast: null,
    }));
    showToast("Trash emptied", { tone: "success" });
    return;
  }
  try {
    await emptyNativeTrash();
  } catch (caught) {
    reportError(caught);
    throw caught;
  }
  setState((current) => ({
    trashPage: { ...createPageState(), key: currentPageKey(current, "trash") },
    trashedFrames: [],
    trashTotal: 0,
    focused: null,
    error: null,
    undo: null,
    toast: null,
  }));
  showToast("Trash emptied", { tone: "success" });
}

export async function copyFragmentImageAction(fragment: Fragment) {
  if (!isTauriRuntime() || isDemoFragment(fragment)) return;
  try {
    await copyFragmentImage(fragment.id);
    showToast("Image copied", { tone: "success" });
  } catch (caught) {
    reportError(caught);
  }
}

export async function openFocusedSource(fragment: Fragment) {
  const url = fragment.sourceUrl ?? fragment.pageUrl;
  if (!url) return;
  if (isTauriRuntime() && !isDemoFragment(fragment)) {
    await openFragmentSource(fragment.id);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function revealFragment(fragment: Fragment) {
  if (!isTauriRuntime() || isDemoFragment(fragment)) return;
  await revealFragmentInFinder(fragment.id);
}
