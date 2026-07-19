import type { ImageCandidate } from "@fragment/shared";
import type { BackgroundReply } from "../shared/messages";

export type CaptureBatchItemResult = {
  candidate: ImageCandidate;
  status: "saved" | "existing" | "failed";
  saved: number;
  existing: number;
  error?: { code: string; message: string };
};

export type CaptureBatchResult = {
  cancelled: boolean;
  items: CaptureBatchItemResult[];
  saved: number;
  existing: number;
  failures: number;
  failedCandidates: ImageCandidate[];
};

export type CaptureBatchProgress = {
  completed: number;
  total: number;
  candidate: ImageCandidate;
};

type RunCaptureBatchOptions = {
  candidates: ImageCandidate[];
  send: (candidate: ImageCandidate) => Promise<BackgroundReply>;
  isCancelled?: () => boolean;
  onProgress?: (progress: CaptureBatchProgress) => void;
};

export async function runCaptureBatch({
  candidates,
  send,
  isCancelled = () => false,
  onProgress = () => undefined,
}: RunCaptureBatchOptions): Promise<CaptureBatchResult> {
  const items: CaptureBatchItemResult[] = [];

  for (const [index, candidate] of candidates.entries()) {
    if (isCancelled()) {
      return summarize(items, true);
    }
    onProgress({ completed: index, total: candidates.length, candidate });

    let reply: BackgroundReply;
    try {
      reply = await send(candidate);
    } catch (error) {
      reply = {
        ok: false,
        error: {
          code: "capture_request_failed",
          message:
            error instanceof Error ? error.message : "Could not save Fragment",
        },
      };
    }

    if (isCancelled()) {
      return summarize(items, true);
    }

    if (!reply.ok) {
      items.push({
        candidate,
        status: "failed",
        saved: 0,
        existing: 0,
        error: reply.error,
      });
    } else {
      const counts = captureCounts(reply.payload);
      items.push({
        candidate,
        status: counts.saved > 0 ? "saved" : "existing",
        saved: counts.saved,
        existing: counts.existing,
      });
    }
    onProgress({
      completed: index + 1,
      total: candidates.length,
      candidate,
    });
  }

  return summarize(items, false);
}

function summarize(
  items: CaptureBatchItemResult[],
  cancelled: boolean,
): CaptureBatchResult {
  let saved = 0;
  let existing = 0;
  const failedCandidates: ImageCandidate[] = [];
  for (const item of items) {
    saved += item.saved;
    existing += item.existing;
    if (item.status === "failed") {
      failedCandidates.push(item.candidate);
    }
  }
  return {
    cancelled,
    items,
    saved,
    existing,
    failures: failedCandidates.length,
    failedCandidates,
  };
}

function captureCounts(payload: unknown): { saved: number; existing: number } {
  if (!payload || typeof payload !== "object") {
    return { saved: 1, existing: 0 };
  }
  const result = payload as Record<string, unknown>;
  const fragmentIds = stringArray(result.fragmentIds);
  const duplicateIds = stringArray(result.duplicateOfFragmentIds);
  return {
    saved:
      fragmentIds.length > 0
        ? fragmentIds.length
        : typeof result.fragmentId === "string"
          ? 1
          : 0,
    existing:
      duplicateIds.length > 0
        ? duplicateIds.length
        : typeof result.duplicateOfFragmentId === "string"
          ? 1
          : 0,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
