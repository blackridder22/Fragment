import { describe, expect, it } from "vitest";
import { percentile, summarize, type PreviewPerfSample } from "./preview-perf";

function sample(overrides: Partial<PreviewPerfSample> = {}): PreviewPerfSample {
  return {
    fragmentId: "f",
    kind: "open",
    path: "thumbnail",
    firstPixelsMs: 10,
    previewDecodedMs: 100,
    startedAt: 0,
    ...overrides,
  };
}

describe("percentile", () => {
  it("uses nearest-rank percentiles", () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 0.5)).toBe(3);
    expect(percentile(values, 0.95)).toBe(5);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("summarize", () => {
  it("aggregates first pixels, decode times, paths and kinds", () => {
    const summary = summarize([
      sample({ firstPixelsMs: 8, previewDecodedMs: 120 }),
      sample({ firstPixelsMs: 12, previewDecodedMs: 80, kind: "navigate" }),
      sample({
        firstPixelsMs: 2,
        previewDecodedMs: 2,
        path: "cached",
        kind: "navigate",
      }),
      sample({ firstPixelsMs: null, previewDecodedMs: null, path: null }),
    ]);

    expect(summary.samples).toBe(4);
    expect(summary.firstPixels).toEqual({ count: 3, p50: 8, p95: 12, max: 12 });
    expect(summary.previewDecoded).toEqual({
      count: 3,
      p50: 80,
      p95: 120,
      max: 120,
    });
    expect(summary.paths).toEqual({ thumbnail: 2, preview: 0, cached: 1 });
    expect(summary.byKind).toEqual({ open: 2, navigate: 2 });
  });
});
