import { describe, expect, it } from "vitest";
import type { ImageCandidate } from "@fragment/shared";
import { runCaptureBatch } from "./capture-batch";

function candidate(id: string): ImageCandidate {
  return {
    id,
    src: `https://example.com/${id}.jpg`,
    pageUrl: "https://example.com/gallery",
    width: 320,
    height: 240,
    rect: { x: 0, y: 0, width: 320, height: 240 },
    source: "generic",
  };
}

describe("capture batch reliability", () => {
  it("does not publish a late response after cancellation", async () => {
    let finishRequest: ((value: { ok: true; payload: unknown }) => void) | undefined;
    let cancelled = false;
    const progress: number[] = [];
    const run = runCaptureBatch({
      candidates: [candidate("late")],
      isCancelled: () => cancelled,
      onProgress: ({ completed }) => progress.push(completed),
      send: () =>
        new Promise((resolve) => {
          finishRequest = resolve;
        }),
    });

    cancelled = true;
    finishRequest?.({
      ok: true,
      payload: { fragmentId: "saved-after-cancel" },
    });
    const result = await run;

    expect(result.cancelled).toBe(true);
    expect(result.items).toEqual([]);
    expect(progress).toEqual([0]);
  });

  it("retries only failed items after a partial batch result", async () => {
    const candidates = [candidate("one"), candidate("two"), candidate("three")];
    const calls = new Map<string, number>();
    const send = async (item: ImageCandidate) => {
      calls.set(item.id, (calls.get(item.id) ?? 0) + 1);
      if (item.id === "two" && calls.get(item.id) === 1) {
        return {
          ok: false as const,
          error: { code: "temporary_failure", message: "Try again" },
        };
      }
      return {
        ok: true as const,
        payload: { fragmentId: `fragment-${item.id}` },
      };
    };

    const first = await runCaptureBatch({ candidates, send });
    const retry = await runCaptureBatch({
      candidates: first.failedCandidates,
      send,
    });

    expect(first.items.map((item) => item.status)).toEqual([
      "saved",
      "failed",
      "saved",
    ]);
    expect(first.failedCandidates.map((item) => item.id)).toEqual(["two"]);
    expect(retry.failures).toBe(0);
    expect(calls).toEqual(
      new Map([
        ["one", 1],
        ["two", 2],
        ["three", 1],
      ]),
    );
  });
});
