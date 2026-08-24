import { describe, expect, it } from "vitest";
import {
  edgeScrollStep,
  intersectingCardIds,
  marqueeRectFromPoints,
  selectionAfterEmptyCanvasClick,
  type SelectableRect,
} from "./marquee-geometry";

describe("marquee geometry", () => {
  it("normalizes drags in every direction", () => {
    expect(marqueeRectFromPoints(260, 210, 80, 60)).toEqual({
      left: 80,
      top: 60,
      width: 180,
      height: 150,
    });
  });

  it("selects every intersecting card in a grid", () => {
    const cards: SelectableRect[] = [
      { id: "a", left: 20, right: 120, top: 20, bottom: 120 },
      { id: "b", left: 132, right: 232, top: 20, bottom: 120 },
      { id: "c", left: 20, right: 120, top: 132, bottom: 232 },
      { id: "d", left: 132, right: 232, top: 132, bottom: 232 },
    ];

    expect(
      intersectingCardIds(
        { left: 110, top: 30, width: 80, height: 175 },
        cards,
      ),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("uses actual card bounds for uneven masonry columns", () => {
    const cards: SelectableRect[] = [
      { id: "tall", left: 20, right: 120, top: 20, bottom: 260 },
      { id: "short", left: 132, right: 232, top: 20, bottom: 110 },
      { id: "lower", left: 132, right: 232, top: 122, bottom: 250 },
    ];

    expect(
      intersectingCardIds(
        { left: 140, top: 115, width: 70, height: 80 },
        cards,
      ),
    ).toEqual(["lower"]);
  });

  it("preserves selection for additive empty clicks and clears plain clicks", () => {
    expect(selectionAfterEmptyCanvasClick(["a", "b"], true)).toEqual([
      "a",
      "b",
    ]);
    expect(selectionAfterEmptyCanvasClick(["a", "b"], false)).toEqual([]);
  });

  it("computes edge scrolling inside the canvas bounds", () => {
    expect(edgeScrollStep(110, 100, 700, 48, 18)).toBeLessThan(0);
    expect(edgeScrollStep(690, 100, 700, 48, 18)).toBeGreaterThan(0);
    expect(edgeScrollStep(400, 100, 700, 48, 18)).toBe(0);
  });
});
