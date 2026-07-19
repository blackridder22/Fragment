import { describe, expect, it } from "vitest";
import { batchSummary, parseTagsInput, saveBatchButtonLabel } from "./overlay";

describe("capture picker tag parsing", () => {
  it("trims, de-duplicates, and strips leading tag markers", () => {
    expect(parseTagsInput(" texture, #motion, texture, UI ")).toEqual([
      "texture",
      "motion",
      "UI",
    ]);
  });

  it("ignores empty tag entries", () => {
    expect(parseTagsInput(" , , # , neon")).toEqual(["neon"]);
  });
});

describe("capture picker batch labels", () => {
  it("describes visible image saves across multiple Frames", () => {
    expect(saveBatchButtonLabel(4, 1)).toBe("Save 4");
    expect(saveBatchButtonLabel(4, 3)).toBe("Save 4 to 3 Frames");
  });

  it("summarizes duplicate-aware multi-frame saves", () => {
    expect(batchSummary(0, 3, 3)).toBe("Already saved in 3 places");
    expect(batchSummary(2, 1, 3)).toBe("Saved 2, 1 already existed");
    expect(batchSummary(3, 0, 3)).toBe("Saved 3");
    expect(batchSummary(2, 1, 4, 1)).toBe(
      "Saved 2, 1 already existed, 1 failed",
    );
  });
});
