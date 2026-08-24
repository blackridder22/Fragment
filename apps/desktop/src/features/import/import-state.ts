import type { ImportBatchResult } from "../../lib/tauri";

export type ImportItemStatus = "queued" | "preparing" | "failed";

export type ImportQueueItem = {
  id: string;
  jobId: string;
  name: string;
  path: string;
  frameId: string | null;
  frameName: string;
  status: ImportItemStatus;
  error?: string;
  errorCode?: string;
  existingFragmentId?: string;
  existingTrashed?: boolean;
};

export type ImportQueueEvent =
  | { event: "queued"; requestId: string }
  | { event: "preparing"; requestId: string }
  | { event: "complete"; requestId: string }
  | { event: "skipped"; requestId: string }
  | {
      event: "failed";
      requestId: string;
      error: string;
      errorCode?: string;
      existingFragmentId?: string;
      existingTrashed?: boolean;
    }
  | { event: "cancelled"; requestId: string }
  | { event: "finished" };

export type ImportQueueAction =
  | { type: "enqueue"; items: ImportQueueItem[] }
  | { type: "event"; event: ImportQueueEvent }
  | { type: "fail"; ids: string[]; error: string }
  | { type: "retry"; id: string; jobId: string }
  | { type: "skip"; id: string };

export function importQueueReducer(
  state: ImportQueueItem[],
  action: ImportQueueAction,
): ImportQueueItem[] {
  if (action.type === "enqueue") {
    const incomingIds = new Set(action.items.map((item) => item.id));
    return [
      ...action.items,
      ...state.filter((item) => !incomingIds.has(item.id)),
    ];
  }
  if (action.type === "skip") {
    return state.filter((item) => item.id !== action.id);
  }
  if (action.type === "retry") {
    return state.map((item) =>
      item.id === action.id
        ? {
            ...item,
            jobId: action.jobId,
            status: "queued",
            error: undefined,
            errorCode: undefined,
            existingFragmentId: undefined,
            existingTrashed: undefined,
          }
        : item,
    );
  }
  if (action.type === "fail") {
    const failedIds = new Set(action.ids);
    return state.map((item) =>
      failedIds.has(item.id)
        ? { ...item, status: "failed", error: action.error }
        : item,
    );
  }
  const event = action.event;
  if (event.event === "finished") {
    return state;
  }
  if (event.event === "complete" || event.event === "skipped") {
    return state.filter((item) => item.id !== event.requestId);
  }

  return state.map((item) => {
    if (item.id !== event.requestId) {
      return item;
    }
    if (event.event === "failed") {
      return {
        ...item,
        status: "failed",
        error: event.error,
        errorCode: event.errorCode,
        existingFragmentId: event.existingFragmentId,
        existingTrashed: event.existingTrashed,
      };
    }
    if (event.event === "cancelled") {
      return { ...item, status: "failed", error: "Import cancelled" };
    }
    return {
      ...item,
      status: event.event,
      error: undefined,
      errorCode: undefined,
      existingFragmentId: undefined,
      existingTrashed: undefined,
    };
  });
}

export type ImportResultSummary = {
  imported: number;
  linkedFragmentIds: string[];
  skipped: number;
  failed: number;
};

export function summarizeImportResults(
  results: ImportBatchResult[],
): ImportResultSummary {
  const summary: ImportResultSummary = {
    imported: 0,
    linkedFragmentIds: [],
    skipped: 0,
    failed: 0,
  };
  for (const result of results) {
    if (!result.ok) {
      summary.failed += 1;
    } else if (result.outcome === "linked" && result.fragment) {
      summary.linkedFragmentIds.push(result.fragment.id);
    } else if (result.outcome === "skipped") {
      summary.skipped += 1;
    } else {
      summary.imported += 1;
    }
  }
  return summary;
}
