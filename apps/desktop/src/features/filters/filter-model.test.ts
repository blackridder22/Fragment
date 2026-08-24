import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filterWithLibraryControls,
  normalizeFragmentFilter,
} from "./filter-model";

describe("Fragment filters", () => {
  it("normalizes saved filters without inventing active defaults", () => {
    expect(
      normalizeFragmentFilter({
        tags: [" Editorial ", "Editorial", ""],
        sourceKind: "all",
        orientation: "all",
        minWidth: 1200.4,
        capturedBefore: "2026-08-01",
      }),
    ).toEqual({
      tags: ["Editorial"],
      mimeTypes: [],
      minWidth: 1200,
      capturedBefore: "2026-08-01T23:59:59.999Z",
    });
  });

  it("folds quick search and PNG into the server filter", () => {
    const filter = filterWithLibraryControls(
      { creatorContains: "Ada" },
      "poster",
      "png",
    );
    expect(filter.query).toBe("poster");
    expect(filter.mimeTypes).toEqual(["image/png"]);
    expect(activeFilterCount(filter)).toBe(3);
  });
});
