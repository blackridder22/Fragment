import type { Fragment, Frame } from "@fragment/shared";
import { describe, expect, it } from "vitest";
import {
  buildFragmentRows,
  buildFrameRows,
  pluralize,
  removeFragmentsFromPage,
  resolveRestoredFrameName,
  siblingFrameNames,
  sortByDeletedAt,
  trashSelectionSummary,
} from "./trash-model";

function frame(id: string, name: string, updatedAt: string, parentId: string | null = null): Frame {
  return {
    id,
    parentId,
    name,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

function fragment(id: string, deletedAt: string, deleteAfter: string | null): Fragment {
  return {
    id,
    frameId: "frame-a",
    title: `Fragment ${id}`,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    capturedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: deletedAt,
    deletedAt,
    deleteAfter,
  };
}

describe("Trash sections", () => {
  it("sorts Frames by their deleted date in both directions", () => {
    const frames = [
      frame("old", "Old", "2026-09-01T00:00:00.000Z"),
      frame("new", "New", "2026-10-01T00:00:00.000Z"),
      frame("mid", "Mid", "2026-09-15T00:00:00.000Z"),
    ];
    const retention = { kind: "days", days: 31 } as const;

    expect(buildFrameRows(frames, "newest", retention).map((row) => row.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(buildFrameRows(frames, "oldest", retention).map((row) => row.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("estimates a Frame's retention date from its deletion time", () => {
    const rows = buildFrameRows(
      [frame("a", "A", "2026-10-01T00:00:00.000Z")],
      "newest",
      { kind: "days", days: 7 },
    );
    expect(rows[0].deleteAfter).toBe("2026-10-08T00:00:00.000Z");
    expect(rows[0].estimatedRetention).toBe(true);

    const off = buildFrameRows([frame("a", "A", "2026-10-01T00:00:00.000Z")], "newest", {
      kind: "forever",
    });
    expect(off[0].deleteAfter).toBeNull();
  });

  it("keeps Fragment rows in the server's order and carries their own dates", () => {
    const rows = buildFragmentRows([
      fragment("b", "2026-09-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
      fragment("a", "2026-10-01T00:00:00.000Z", null),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
    expect(rows[0].deleteAfter).toBe("2026-10-02T00:00:00.000Z");
    expect(rows[1].deleteAfter).toBeNull();
    expect(rows[0].name).toBe("Fragment b");
  });

  it("sorts any rows by deleted date with invalid dates last", () => {
    const rows = [
      { deletedAt: "garbage", id: "x" },
      { deletedAt: "2026-10-01T00:00:00.000Z", id: "y" },
    ];
    expect(sortByDeletedAt(rows, "newest").map((row) => row.id)).toEqual(["y", "x"]);
    expect(sortByDeletedAt(rows, "oldest").map((row) => row.id)).toEqual(["x", "y"]);
  });
});

describe("Trash copy", () => {
  it("pluralizes with Fragment for images and Frame for collections", () => {
    expect(pluralize(1, "Fragment")).toBe("1 Fragment");
    expect(pluralize(3, "Fragment")).toBe("3 Fragments");
    expect(trashSelectionSummary(3, 1)).toBe("3 Fragments and 1 Frame");
    expect(trashSelectionSummary(0, 2)).toBe("2 Frames");
    expect(trashSelectionSummary(1, 0)).toBe("1 Fragment");
    expect(trashSelectionSummary(0, 0)).toBe("nothing");
  });
});

describe("Frame restore conflicts", () => {
  it("keeps the name when no sibling uses it", () => {
    expect(resolveRestoredFrameName("Posters", ["Motion", "Texture"])).toBe("Posters");
  });

  it("resolves a conflict with the first free numbered name, ignoring case", () => {
    expect(resolveRestoredFrameName("Posters", ["posters"])).toBe("Posters 2");
    expect(resolveRestoredFrameName("Posters", ["Posters", "Posters 2"])).toBe("Posters 3");
    expect(resolveRestoredFrameName("  Posters ", ["Posters"])).toBe("Posters 2");
  });

  it("only compares against active siblings under the same parent", () => {
    const frames = [
      frame("a", "Posters", "", null),
      frame("b", "Posters", "", "parent"),
      frame("self", "Posters", "", null),
    ];
    expect(siblingFrameNames(frames, null, "self")).toEqual(["Posters"]);
    expect(siblingFrameNames(frames, "parent", "self")).toEqual(["Posters"]);
    expect(siblingFrameNames(frames, "other", "self")).toEqual([]);
  });
});

describe("page patching", () => {
  it("removes restored rows from the loaded page and moves the offset back", () => {
    const loaded = Array.from({ length: 1_000 }, (_, index) =>
      fragment(`f-${index}`, "2026-10-01T00:00:00.000Z", null),
    );
    const ids = loaded.slice(100, 150).map((item) => item.id);

    const result = removeFragmentsFromPage(loaded, ids, 1_000);

    expect(result.removed).toHaveLength(50);
    expect(result.remaining).toHaveLength(950);
    expect(result.remaining.some((item) => ids.includes(item.id))).toBe(false);
    expect(result.nextOffset).toBe(950);
    expect(removeFragmentsFromPage(loaded, ["missing"], 60).nextOffset).toBe(60);
  });
});
