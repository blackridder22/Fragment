import { describe, expect, it } from "vitest";
import type { Fragment } from "@fragment/shared";
import { mergeUniqueFragments, readSnapshotMetadata } from "./library-state";

function fragment(id: string, title = id): Fragment {
  return {
    id,
    frameId: "frame-1",
    title,
    originalPath: `${id}.png`,
    thumbnailPath: `${id}-thumb.png`,
    capturedAt: "2026-06-24T00:00:00Z",
    createdAt: "2026-06-24T00:00:00Z",
    updatedAt: "2026-06-24T00:00:00Z",
  };
}

describe("mergeUniqueFragments", () => {
  it("appends pages without duplicating IDs and refreshes existing values", () => {
    const merged = mergeUniqueFragments(
      [fragment("one"), fragment("two")],
      [fragment("two", "Updated"), fragment("three")],
    );

    expect(merged.map((item) => item.id)).toEqual(["one", "two", "three"]);
    expect(merged[1]?.title).toBe("Updated");
  });

  it("prepends a completed import once", () => {
    const merged = mergeUniqueFragments(
      [fragment("one"), fragment("two")],
      [fragment("two", "Newest"), fragment("three")],
      "prepend",
    );

    expect(merged.map((item) => item.id)).toEqual(["two", "three", "one"]);
    expect(merged[0]?.title).toBe("Newest");
  });
});

describe("readSnapshotMetadata", () => {
  it("accepts optional native snapshot metadata and rejects invalid counts", () => {
    expect(
      readSnapshotMetadata({
        frameCounts: { inbox: 4, invalid: -1, text: "2" },
        trashTotal: 3,
      }),
    ).toEqual({ frameCounts: { inbox: 4 }, trashTotal: 3 });
  });
});
