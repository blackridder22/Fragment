import { describe, expect, it } from "vitest";
import {
  importQueueReducer,
  summarizeImportResults,
  type ImportQueueItem,
} from "./import-state";

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

  it("removes a skipped duplicate from the pending queue", () => {
    expect(
      importQueueReducer([item("one")], {
        type: "event",
        event: { event: "skipped", requestId: "one" },
      }),
    ).toEqual([]);
  });
});

describe("summarizeImportResults", () => {
  it("counts new, linked, skipped, and failed outcomes", () => {
    expect(
      summarizeImportResults([
        { requestId: "new", ok: true, outcome: "new", fragment: null },
        {
          requestId: "linked",
          ok: true,
          outcome: "linked",
          fragment: { id: "linked-fragment" } as never,
        },
        { requestId: "skipped", ok: true, outcome: "skipped" },
        { requestId: "failed", ok: false, error: "decode failed" },
      ]),
    ).toEqual({
      imported: 1,
      linkedFragmentIds: ["linked-fragment"],
      skipped: 1,
      failed: 1,
    });
  });
});
