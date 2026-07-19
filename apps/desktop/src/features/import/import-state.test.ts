import { describe, expect, it } from "vitest";
import { importQueueReducer, type ImportQueueItem } from "./import-state";

function item(id: string): ImportQueueItem {
  return {
    id,
    jobId: "job-1",
    name: `${id}.png`,
    path: `/tmp/${id}.png`,
    frameId: null,
    frameName: "Inbox",
    status: "queued",
  };
}

describe("importQueueReducer", () => {
  it("keeps failed imports visible until the user retries or skips", () => {
    const failed = importQueueReducer([item("one")], {
      type: "event",
      event: {
        event: "failed",
        requestId: "one",
        error: "duplicate",
        errorCode: "duplicate_membership",
        existingFragmentId: "existing-one",
        existingTrashed: false,
      },
    });
    expect(failed[0]).toMatchObject({
      status: "failed",
      error: "duplicate",
      errorCode: "duplicate_membership",
      existingFragmentId: "existing-one",
      existingTrashed: false,
    });

    const retried = importQueueReducer(failed, {
      type: "retry",
      id: "one",
      jobId: "job-2",
    });
    expect(retried[0]).toMatchObject({ status: "queued", jobId: "job-2" });
    expect(retried[0]?.error).toBeUndefined();
    expect(retried[0]?.existingFragmentId).toBeUndefined();

    expect(importQueueReducer(failed, { type: "skip", id: "one" })).toEqual([]);
  });

  it("removes a completed import from the pending queue", () => {
    expect(
      importQueueReducer([item("one")], {
        type: "event",
        event: { event: "complete", requestId: "one" },
      }),
    ).toEqual([]);
  });
});
