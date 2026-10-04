import { describe, expect, it } from "vitest";
import {
  FIT_VIEW,
  clampPan,
  clampZoom,
  displayPercent,
  fitWithin,
  nativeZoom,
  wheelZoomFactor,
  zoomAt,
} from "./preview-geometry";

describe("fitWithin", () => {
  it("contain-fits landscape and portrait images", () => {
    expect(
      fitWithin({ width: 800, height: 600 }, { width: 1600, height: 900 }),
    ).toEqual({
      width: 800,
      height: 450,
    });
    expect(
      fitWithin({ width: 800, height: 600 }, { width: 900, height: 1600 }),
    ).toEqual({
      width: 337.5,
      height: 600,
    });
  });

  it("fills the stage when the image has no usable dimensions", () => {
    expect(fitWithin({ width: 800, height: 600 }, null)).toEqual({
      width: 800,
      height: 600,
    });
    expect(
      fitWithin({ width: 800, height: 600 }, { width: 0, height: 10 }),
    ).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("returns an empty box for an empty stage", () => {
    expect(
      fitWithin({ width: 0, height: 0 }, { width: 10, height: 10 }),
    ).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("zoom helpers", () => {
  it("clamps zoom between fit and the maximum", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(50)).toBe(8);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(12, 16)).toBe(12);
  });

  it("derives native zoom and display percent from the fit size", () => {
    const fit = { width: 800, height: 450 };
    const image = { width: 1600, height: 900 };
    expect(nativeZoom(fit, image)).toBe(2);
    expect(displayPercent(fit, image, 1)).toBe(50);
    expect(displayPercent(fit, image, 2)).toBe(100);
    expect(displayPercent(fit, null, 1)).toBeNull();
    expect(nativeZoom(fit, { width: 400, height: 200 })).toBe(1);
  });

  it("maps wheel deltas to a bounded multiplicative factor", () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100000)).toBeCloseTo(Math.exp(240 * 0.0035), 6);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48), 6);
  });
});

describe("pan helpers", () => {
  it("keeps a smaller image centred", () => {
    expect(
      clampPan({ x: 40, y: -20 }, { width: 400, height: 300 }, 1, {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("limits panning to the overflow of a zoomed image", () => {
    expect(
      clampPan({ x: 500, y: -500 }, { width: 800, height: 600 }, 2, {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: 400, y: -300 });
  });

  it("zooms around the pointer so the point under it stays put", () => {
    const next = zoomAt(FIT_VIEW, 2, { x: 100, y: 50 });
    expect(next.zoom).toBe(2);
    expect(next.pan).toEqual({ x: -100, y: -50 });
    expect(zoomAt(next, 2, { x: 0, y: 0 })).toBe(next);
  });
});
