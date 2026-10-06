import type { Frame } from "@fragment/shared";
import type { FrameActionFailure } from "./trash-actions";

/** A mixed Trash selection about to be restored or deleted. */
export type TrashBatchPlan = { fragmentIds: string[]; frames: Frame[] };

export type TrashBatchFailure = {
  message: string;
  error: unknown;
  /** What a retry must resubmit: nothing the backend already completed. */
  remaining: TrashBatchPlan;
};

export type TrashBatchOutcome<TFrame> = {
  /** Completed by the backend and already removed from the page. */
  done: { fragmentIds: string[]; frames: TFrame[] };
  failure: TrashBatchFailure | null;
};

export type TrashBatchHandlers<TFrame> = {
  /** One call for every Fragment id; throws when nothing was applied. */
  runFragments: (ids: string[]) => Promise<unknown>;
  /** Frames one by one; the report says which ones completed. */
  runFrames: (
    frames: Frame[],
  ) => Promise<{ done: TFrame[]; failed: FrameActionFailure[] }>;
  frameOf: (item: TFrame) => Frame;
  /** Fires once the Fragment call settled, for the row exit motion. */
  onFragmentsSettled?: (ids: string[], completed: boolean) => void;
  /** Fires once the Frames settled, with the completed and the failed ones. */
  onFramesSettled?: (completed: Frame[], failed: Frame[]) => void;
};

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Runs one Trash action (Restore or Delete now) over a mixed selection:
 * Fragments first in a single call, then the Frames. Whatever completed stays
 * completed and is reported in `done`, so the page can toast it (with Undo
 * where reversible). A failure returns the untouched remainder, so a retry
 * never resubmits ids the backend already processed, which would patch the
 * loaded page and the Trash total a second time.
 */
export async function runTrashBatch<TFrame>(
  plan: TrashBatchPlan,
  handlers: TrashBatchHandlers<TFrame>,
): Promise<TrashBatchOutcome<TFrame>> {
  const done = { fragmentIds: [] as string[], frames: [] as TFrame[] };
  if (plan.fragmentIds.length > 0) {
    try {
      await handlers.runFragments(plan.fragmentIds);
    } catch (error) {
      handlers.onFragmentsSettled?.(plan.fragmentIds, false);
      handlers.onFramesSettled?.([], plan.frames);
      return {
        done,
        failure: { message: errorMessage(error), error, remaining: plan },
      };
    }
    done.fragmentIds = plan.fragmentIds;
    handlers.onFragmentsSettled?.(plan.fragmentIds, true);
  }
  if (plan.frames.length > 0) {
    let report: { done: TFrame[]; failed: FrameActionFailure[] };
    try {
      report = await handlers.runFrames(plan.frames);
    } catch (error) {
      handlers.onFramesSettled?.([], plan.frames);
      return {
        done,
        failure: {
          message: errorMessage(error),
          error,
          remaining: { fragmentIds: [], frames: plan.frames },
        },
      };
    }
    done.frames = report.done;
    const failedFrames = report.failed.map((failure) => failure.frame);
    handlers.onFramesSettled?.(report.done.map(handlers.frameOf), failedFrames);
    if (report.failed.length > 0) {
      const message = report.failed[0].message;
      return {
        done,
        failure: {
          message,
          error: new Error(message),
          remaining: { fragmentIds: [], frames: failedFrames },
        },
      };
    }
  }
  return { done, failure: null };
}
