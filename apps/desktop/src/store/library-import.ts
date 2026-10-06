import type { Fragment } from "@fragment/shared";
import { open } from "@tauri-apps/plugin-dialog";
import {
  importQueueReducer,
  summarizeImportResults,
  type ImportQueueAction,
  type ImportQueueItem,
} from "../features/import/import-state";
import {
  cancelImportJob,
  getLibraryRevision,
  importImageBatch,
  isTauriRuntime,
  type ImportBatchEvent,
} from "../lib/tauri";
import { reportError, setLibraryError, showToast } from "./library-feedback";
import {
  activeScopeIncludes,
  adjustFrameCounts,
  prependToActivePage,
} from "./library-fragments";
import { libraryLoader } from "./library-loader";
import { pluralize, selectFrameById } from "./library-selectors";
import { libraryStore } from "./library-store";
import { offerUndo } from "./library-undo";

const { getState, setState } = libraryStore;
const completedImportRequests = new Set<string>();
let pageNeedsReload = false;

function dispatchImportQueue(action: ImportQueueAction) {
  setState((state) => ({
    pendingImports: importQueueReducer(state.pendingImports, action),
  }));
}

export function operationId(prefix: string) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36);
  return `${prefix}-${suffix}`;
}

export function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Image";
}

function addImportedFragment(requestId: string, fragment: Fragment) {
  if (completedImportRequests.has(requestId)) return;
  completedImportRequests.add(requestId);
  adjustFrameCounts({ [fragment.frameId]: 1 });
  setState((state) => ({
    coverFragments: [
      fragment,
      ...state.coverFragments.filter((item) => item.id !== fragment.id),
    ],
  }));
  const state = getState();
  if (!activeScopeIncludes(state, fragment.frameId)) return;
  if (state.sortMode === "newest" && !state.fragmentFilter.color) {
    prependToActivePage([fragment]);
  } else {
    pageNeedsReload = true;
  }
}

export async function runImportBatch(
  items: ImportQueueItem[],
  enqueue: boolean,
) {
  if (items.length === 0) return;
  const jobId = items[0]!.jobId;
  if (enqueue) dispatchImportQueue({ type: "enqueue", items });
  setLibraryError(null);
  showToast(`Importing ${pluralize(items.length, "image")}`);
  try {
    const results = await importImageBatch(
      jobId,
      items.map((item) => ({
        requestId: item.id,
        frameId: item.frameId,
        filePath: item.path,
      })),
      (event: ImportBatchEvent) => {
        if (event.event === "failed") {
          dispatchImportQueue({
            type: "event",
            event: {
              event: "failed",
              requestId: event.requestId,
              error: event.error,
              errorCode: event.errorCode ?? undefined,
              existingFragmentId: event.existingFragmentId ?? undefined,
              existingTrashed: event.existingTrashed ?? undefined,
            },
          });
        } else if (event.event === "skipped") {
          dispatchImportQueue({
            type: "event",
            event: { event: "skipped", requestId: event.requestId },
          });
        } else {
          dispatchImportQueue({ type: "event", event });
        }
        if (event.event === "complete") {
          addImportedFragment(event.requestId, event.fragment);
        }
      },
    );
    for (const result of results) {
      if (result.ok && result.fragment) {
        addImportedFragment(result.requestId, result.fragment);
        dispatchImportQueue({
          type: "event",
          event: { event: "complete", requestId: result.requestId },
        });
      } else if (result.outcome === "skipped") {
        dispatchImportQueue({
          type: "event",
          event: { event: "skipped", requestId: result.requestId },
        });
      } else if (result.error) {
        dispatchImportQueue({
          type: "event",
          event: {
            event: "failed",
            requestId: result.requestId,
            error: result.error,
            errorCode: result.errorCode ?? undefined,
            existingFragmentId: result.existingFragmentId ?? undefined,
            existingTrashed: result.existingTrashed ?? undefined,
          },
        });
      }
    }
    const summary = summarizeImportResults(results);
    const label =
      [
        summary.imported > 0 ? `${summary.imported} imported` : null,
        summary.linkedFragmentIds.length > 0
          ? `${summary.linkedFragmentIds.length} already in your Vault — linked into ${items[0]?.frameName ?? "Inbox"}`
          : null,
        summary.skipped > 0 ? `${summary.skipped} skipped` : null,
        summary.failed > 0 ? `${summary.failed} failed` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Import complete";
    if (summary.linkedFragmentIds.length > 0) {
      offerUndo({ kind: "linked", ids: summary.linkedFragmentIds }, label);
    } else {
      showToast(label, { tone: summary.failed > 0 ? "error" : "success" });
    }
    if (pageNeedsReload) {
      pageNeedsReload = false;
      libraryLoader.invalidate("active");
    }
    try {
      setState({ revision: await getLibraryRevision() });
    } catch {
      // A later focus revision check reconciles the library.
    }
  } catch (caught) {
    const message = reportError(caught);
    dispatchImportQueue({
      type: "fail",
      ids: items.map((item) => item.id),
      error: message,
    });
    showToast("Import failed", { tone: "error" });
  }
}

export function retryImport(item: ImportQueueItem) {
  const jobId = operationId("import-job");
  dispatchImportQueue({ type: "retry", id: item.id, jobId });
  void runImportBatch([{ ...item, jobId, status: "queued" }], false);
}

export async function cancelImport(item: ImportQueueItem) {
  await cancelImportJob(item.jobId);
  showToast(`Cancelling ${item.name}`);
}

export function skipImport(item: ImportQueueItem) {
  dispatchImportQueue({ type: "skip", id: item.id });
  showToast(`Skipped ${item.name}`);
}

export async function importPaths(paths: string[]) {
  if (paths.length === 0) return;
  const state = getState();
  const frameById = selectFrameById(state);
  const destination = state.settings.defaultFragment;
  const frameId =
    destination === "inbox"
      ? state.defaultFrameId
      : destination === "recent"
        ? state.recentFrameId && frameById.has(state.recentFrameId)
          ? state.recentFrameId
          : state.defaultFrameId
        : (state.selectedFrameId ?? state.defaultFrameId);
  const frameName = (frameId ? frameById.get(frameId)?.name : null) ?? "Inbox";
  const jobId = operationId("import-job");
  await runImportBatch(
    paths.map((path) => ({
      id: operationId("import"),
      jobId,
      name: fileNameFromPath(path),
      path,
      frameId,
      frameName,
      status: "queued" as const,
    })),
    true,
  );
}

export async function chooseImages() {
  if (!isTauriRuntime()) {
    setLibraryError("Open Fragment through Tauri to import images.");
    return;
  }
  const selected = await open({
    multiple: true,
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "svg"],
      },
    ],
  });
  if (!selected) return;
  void importPaths(Array.isArray(selected) ? selected : [selected]);
}
