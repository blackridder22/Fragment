import type { Frame } from "@fragment/shared";
import { describe, expect, it, vi } from "vitest";
import { runTrashBatch } from "./trash-batch";

function frame(id: string): Frame {
  return {
    id,
    parentId: null,
    name: id,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const identity = (item: Frame) => item;

describe("runTrashBatch", () => {
  it("reports everything as done when nothing fails", async () => {
    const outcome = await runTrashBatch<Frame>(
      { fragmentIds: ["a", "b"], frames: [frame("f1")] },
      {
        runFragments: vi.fn().mockResolvedValue(2),
        runFrames: async (frames) => ({ done: frames, failed: [] }),
        frameOf: identity,
      },
    );
    expect(outcome.failure).toBeNull();
    expect(outcome.done.fragmentIds).toEqual(["a", "b"]);
    expect(outcome.done.frames.map((item) => item.id)).toEqual(["f1"]);
  });

  it("keeps the Fragments done and leaves only the failed Frames for a retry", async () => {
    const runFragments = vi.fn().mockResolvedValue(2);
    const settledFragments = vi.fn();
    const settledFrames = vi.fn();
    const plan = { fragmentIds: ["a", "b"], frames: [frame("ok"), frame("bad")] };

    const outcome = await runTrashBatch<Frame>(plan, {
      runFragments,
      runFrames: async (frames) => ({
        done: frames.filter((item) => item.id === "ok"),
        failed: frames
          .filter((item) => item.id === "bad")
          .map((item) => ({ frame: item, message: "restore the parent Frame first" })),
      }),
      frameOf: identity,
      onFragmentsSettled: settledFragments,
      onFramesSettled: settledFrames,
    });

    expect(outcome.done.fragmentIds).toEqual(["a", "b"]);
    expect(outcome.done.frames.map((item) => item.id)).toEqual(["ok"]);
    expect(outcome.failure?.message).toBe("restore the parent Frame first");
    expect(outcome.failure?.remaining).toEqual({ fragmentIds: [], frames: [frame("bad")] });
    expect(settledFragments).toHaveBeenCalledWith(["a", "b"], true);
    expect(settledFrames).toHaveBeenCalledWith([frame("ok")], [frame("bad")]);

    // A retry with the remainder never resubmits the Fragments.
    runFragments.mockClear();
    const retry = await runTrashBatch<Frame>(outcome.failure!.remaining, {
      runFragments,
      runFrames: async (frames) => ({ done: frames, failed: [] }),
      frameOf: identity,
    });
    expect(runFragments).not.toHaveBeenCalled();
    expect(retry.failure).toBeNull();
    expect(retry.done.frames.map((item) => item.id)).toEqual(["bad"]);
  });

  it("leaves the whole plan for a retry when the Fragment call fails", async () => {
    const settledFragments = vi.fn();
    const settledFrames = vi.fn();
    const runFrames = vi.fn();
    const plan = { fragmentIds: ["a"], frames: [frame("f1")] };

    const outcome = await runTrashBatch<Frame>(plan, {
      runFragments: vi.fn().mockRejectedValue(new Error("disk gone")),
      runFrames,
      frameOf: identity,
      onFragmentsSettled: settledFragments,
      onFramesSettled: settledFrames,
    });

    expect(outcome.done).toEqual({ fragmentIds: [], frames: [] });
    expect(outcome.failure?.message).toBe("disk gone");
    expect(outcome.failure?.remaining).toEqual(plan);
    expect(runFrames).not.toHaveBeenCalled();
    expect(settledFragments).toHaveBeenCalledWith(["a"], false);
    expect(settledFrames).toHaveBeenCalledWith([], [frame("f1")]);
  });

  it("treats a thrown Frames step as every Frame failed, keeping the Fragments done", async () => {
    const outcome = await runTrashBatch<Frame>(
      { fragmentIds: ["a"], frames: [frame("f1")] },
      {
        runFragments: vi.fn().mockResolvedValue(1),
        runFrames: vi.fn().mockRejectedValue(new Error("offline")),
        frameOf: identity,
      },
    );
    expect(outcome.done.fragmentIds).toEqual(["a"]);
    expect(outcome.failure?.remaining).toEqual({ fragmentIds: [], frames: [frame("f1")] });
  });
});
