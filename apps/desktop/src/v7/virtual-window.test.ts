import { describe, expect, it } from "vitest";
import {
  MAX_MOUNTED_CARDS,
  overscanFor,
  sameIndices,
  scrollTopToReveal,
  windowRange,
  windowedIndices,
  type WindowedItem,
} from "./virtual-window";

function column(count: number, height: number, gap = 12): WindowedItem[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    top: index * (height + gap),
    height,
  }));
}

describe("windowing math", () => {
  it("overscans by about one viewport within bounds", () => {
    expect(overscanFor(784)).toBe(784);
    expect(overscanFor(100)).toBe(320);
    expect(overscanFor(5000)).toBe(1600);
    expect(overscanFor(Number.NaN)).toBe(320);
  });

  it("converts the scroll position into a gallery-local band", () => {
    expect(
      windowRange({
        scrollTop: 1000,
        viewportHeight: 800,
        galleryTop: 120,
        overscan: 800,
      }),
    ).toEqual({ start: 80, end: 2480 });
  });

  it("mounts only the items that intersect the band", () => {
    const items = column(100, 200);
    const indices = windowedIndices(items, { start: 1000, end: 2000 });
    expect(indices[0]).toBe(4);
    expect(indices[indices.length - 1]).toBe(9);
    expect(indices).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it("includes items that only partially overlap the band edges", () => {
    const items = column(10, 200);
    expect(windowedIndices(items, { start: 190, end: 220 })).toEqual([0, 1]);
    expect(windowedIndices(items, { start: -500, end: -1 })).toEqual([]);
  });

  it("caps the mounted count at the items nearest the viewport", () => {
    const items = column(1000, 20, 0);
    const indices = windowedIndices(items, { start: 0, end: 20000 });
    expect(indices).toHaveLength(MAX_MOUNTED_CARDS);
    expect(indices[0]).toBe(500 - MAX_MOUNTED_CARDS / 2);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(windowedIndices(items, { start: 0, end: 20000 }, 10)).toHaveLength(
      10,
    );
  });

  it("compares index lists cheaply", () => {
    expect(sameIndices([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameIndices([1, 2, 3], [1, 2])).toBe(false);
    expect(sameIndices([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it("scrolls just far enough to reveal an item", () => {
    const window = { scrollTop: 1000, viewportHeight: 800, galleryTop: 100 };
    expect(scrollTopToReveal({ top: 1000, height: 200 }, window)).toBeNull();
    expect(scrollTopToReveal({ top: 400, height: 200 }, window)).toBe(476);
    expect(scrollTopToReveal({ top: 1800, height: 200 }, window)).toBe(1324);
    expect(scrollTopToReveal({ top: 1200, height: 900 }, window)).toBe(1276);
    expect(
      scrollTopToReveal({ top: 0, height: 200 }, { ...window, scrollTop: 500 }),
    ).toBe(76);
  });
});
