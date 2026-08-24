import { describe, expect, it } from "vitest";
import {
  aspectRatioLabel,
  formatLabel,
  normalizeTagDraft,
  sourceDomain,
} from "./fragment-metadata";

describe("fragment metadata helpers", () => {
  it("normalizes tag drafts without losing the first display casing", () => {
    expect(
      normalizeTagDraft([" Interface ", "interface", "", "Reference"]),
    ).toEqual(["Interface", "Reference"]);
  });

  it("formats useful retrieval metadata", () => {
    expect(aspectRatioLabel(1920, 1080)).toBe("16:9");
    expect(aspectRatioLabel(1000, 667)).toBe("1.50");
    expect(formatLabel("image/jpeg", "originals/photo.bin")).toBe("JPG");
    expect(sourceDomain("https://www.example.com/path")).toBe("example.com");
  });
});
