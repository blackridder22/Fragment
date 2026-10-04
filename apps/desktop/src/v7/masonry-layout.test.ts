import { describe, expect, it } from "vitest";
import {
  aspectRatioFor,
  canExtendLayout,
  columnCountFor,
  columnWidthFor,
  DEFAULT_ASPECT_RATIO,
  MASONRY_GAP,
  placeMasonry,
  type MasonryItemInput,
  type MasonryOptions,
} from "./masonry-layout";

const options: MasonryOptions = {
  mode: "masonry",
  columnCount: 3,
  columnWidth: 200,
  gap: MASONRY_GAP,
};

function item(id: string, width?: number | null, height?: number | null) {
  return { id, width, height } satisfies MasonryItemInput;
}

describe("aspectRatioFor", () => {
  it("uses the stored dimensions and falls back to 4:3 when unknown", () => {
    expect(aspectRatioFor(item("a", 1200, 400))).toBe(3);
    expect(aspectRatioFor(item("b", 400, 1200))).toBeCloseTo(1 / 3);
    expect(aspectRatioFor(item("c", null, null))).toBe(DEFAULT_ASPECT_RATIO);
    expect(aspectRatioFor(item("d", 0, 10))).toBe(DEFAULT_ASPECT_RATIO);
    expect(aspectRatioFor(item("e", Number.NaN, 10))).toBe(
      DEFAULT_ASPECT_RATIO,
    );
  });

  it("bounds extreme strips so a card never collapses to a sliver", () => {
    expect(aspectRatioFor(item("wide", 10000, 10))).toBe(8);
    expect(aspectRatioFor(item("tall", 10, 10000))).toBe(1 / 8);
  });
});

describe("columnCountFor", () => {
  it("fits as many columns as the density allows for the width", () => {
    expect(columnCountFor(1072, "comfortable")).toBe(5);
    expect(columnCountFor(1072, "compact")).toBe(6);
    expect(columnCountFor(1072, "large")).toBe(3);
    expect(columnCountFor(400, "large")).toBe(1);
    expect(columnCountFor(4000, "comfortable")).toBe(6);
  });

  it("returns the density default before the container is measured", () => {
    expect(columnCountFor(0, "comfortable")).toBe(5);
    expect(columnCountFor(Number.NaN, "compact")).toBe(6);
  });

  it("splits the width evenly after the gaps", () => {
    expect(columnWidthFor(1072, 5)).toBe((1072 - MASONRY_GAP * 4) / 5);
    expect(columnWidthFor(100, 0)).toBe(0);
  });
});

describe("placeMasonry", () => {
  it("sizes each card from its aspect ratio at the column width", () => {
    const layout = placeMasonry(
      [item("pano", 3000, 1000), item("portrait", 1000, 3000), item("unknown")],
      options,
    );
    const [pano, portrait, unknown] = layout.items;
    expect(pano).toMatchObject({ column: 0, left: 0, top: 0, width: 200 });
    expect(pano!.height).toBeCloseTo(200 / 3);
    expect(portrait!.height).toBeCloseTo(600);
    expect(unknown!.height).toBeCloseTo(150);
    expect(layout.height).toBeCloseTo(600);
  });

  it("places every item in the shortest column, earliest on ties", () => {
    const layout = placeMasonry(
      [
        item("a", 100, 300),
        item("b", 100, 100),
        item("c", 100, 100),
        item("d", 100, 100),
        item("e", 100, 100),
      ],
      options,
    );
    const byId = Object.fromEntries(layout.items.map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ column: 0, top: 0 });
    expect(byId.b).toMatchObject({ column: 1, top: 0 });
    expect(byId.c).toMatchObject({ column: 2, top: 0 });
    expect(byId.d).toMatchObject({ column: 1, top: 200 + MASONRY_GAP });
    expect(byId.e).toMatchObject({ column: 2, top: 200 + MASONRY_GAP });
    expect(byId.d!.left).toBe(200 + MASONRY_GAP);
    expect(layout.height).toBeCloseTo(600);
  });

  it("appends a new page without moving any existing card", () => {
    const first = [
      item("a", 100, 300),
      item("b", 100, 100),
      item("c", 100, 150),
    ];
    const previous = placeMasonry(first, options);
    const next = placeMasonry(
      [...first, item("d", 100, 100), item("e", 100, 400)],
      options,
      previous,
    );
    expect(next.items.slice(0, 3)).toEqual(previous.items);
    expect(next.items.map((p) => p.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(next.items[3]).toMatchObject({ column: 1, top: 200 + MASONRY_GAP });
    expect(next.height).toBeGreaterThan(previous.height);
  });

  it("recomputes from scratch when options or earlier items change", () => {
    const items = [item("a", 100, 100), item("b", 100, 100)];
    const previous = placeMasonry(items, options);
    expect(
      canExtendLayout(previous, { ...options, columnWidth: 180 }, items),
    ).toBe(false);
    expect(
      canExtendLayout(previous, options, [item("z", 100, 100), ...items]),
    ).toBe(false);
    expect(
      canExtendLayout(previous, options, [item("a", 100, 300), items[1]!]),
    ).toBe(false);
    expect(canExtendLayout(previous, options, items.slice(0, 1))).toBe(false);
    expect(canExtendLayout(previous, options, [...items, item("c")])).toBe(
      true,
    );
    expect(canExtendLayout(null, options, items)).toBe(false);

    const reflowed = placeMasonry(
      items,
      { ...options, columnCount: 1 },
      previous,
    );
    expect(reflowed.items[1]).toMatchObject({
      column: 0,
      top: 200 + MASONRY_GAP,
    });
  });

  it("uses uniform cells in grid mode so columns fill in reading order", () => {
    const layout = placeMasonry(
      [item("a", 3000, 1000), item("b", 100, 3000), item("c"), item("d")],
      { ...options, mode: "grid", rowHeight: 240 },
    );
    expect(layout.items.map((p) => [p.column, p.top])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 240 + MASONRY_GAP],
    ]);
    expect(layout.items.every((p) => p.height === 240)).toBe(true);
    expect(layout.height).toBe(480 + MASONRY_GAP);
  });

  it("returns an empty layout for no items", () => {
    const layout = placeMasonry([], options);
    expect(layout.items).toEqual([]);
    expect(layout.height).toBe(0);
  });
});
