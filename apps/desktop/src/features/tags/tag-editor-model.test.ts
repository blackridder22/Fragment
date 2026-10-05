import { describe, expect, it } from "vitest";
import {
  addTag,
  normalizeTags,
  removeTag,
  suggestTags,
  tagValidationError,
} from "./tag-editor-model";

describe("normalizeTags", () => {
  it("trims tags, removes blanks, and keeps the first display casing", () => {
    expect(
      normalizeTags([
        "  Editorial ",
        "editorial",
        "EDITORIAL",
        "",
        "  Motion  ",
      ]),
    ).toEqual(["Editorial", "Motion"]);
  });

  it("does not mutate the source array", () => {
    const tags = ["  Type  ", "TYPE"];

    normalizeTags(tags);

    expect(tags).toEqual(["  Type  ", "TYPE"]);
  });
});

describe("addTag", () => {
  it("normalizes existing tags and appends a trimmed tag", () => {
    expect(addTag(["  Editorial ", "EDITORIAL"], "  Motion  ")).toEqual([
      "Editorial",
      "Motion",
    ]);
  });

  it("does not add a case-insensitive duplicate or a blank tag", () => {
    expect(addTag(["Editorial"], " editorial ")).toEqual(["Editorial"]);
    expect(addTag(["Editorial"], "   ")).toEqual(["Editorial"]);
  });
});

describe("removeTag", () => {
  it("removes a trimmed tag case-insensitively", () => {
    expect(removeTag(["Editorial", "Motion"], " EDITORIAL ")).toEqual([
      "Motion",
    ]);
  });

  it("normalizes the result when the tag is blank or absent", () => {
    expect(removeTag([" Editorial ", "EDITORIAL", "Motion"], " ")).toEqual([
      "Editorial",
      "Motion",
    ]);
    expect(removeTag([" Editorial ", "Motion"], "Packaging")).toEqual([
      "Editorial",
      "Motion",
    ]);
  });
});

describe("tagValidationError", () => {
  it("validates blank, length, and count limits", () => {
    expect(tagValidationError([], "   ")).toBe("Enter a tag name.");
    expect(tagValidationError([], "x".repeat(65))).toBe(
      "Tags can be up to 64 characters.",
    );
    expect(
      tagValidationError(
        Array.from({ length: 32 }, (_, index) => `Tag ${index}`),
        "One more",
      ),
    ).toBe("A Frame can have up to 32 tags.");
  });

  it("counts Unicode code points and accepts an existing tag", () => {
    expect(tagValidationError([], "😀".repeat(64))).toBeNull();
    expect(tagValidationError([], "😀".repeat(65))).toBe(
      "Tags can be up to 64 characters.",
    );
    expect(
      tagValidationError(
        Array.from({ length: 32 }, (_, index) => `Tag ${index}`),
        " tag 0 ",
      ),
    ).toBeNull();
  });
});

describe("suggestTags", () => {
  const known = ["Editorial", "Motion", "Monochrome", "Packaging", "Type"];

  it("offers known tags the Fragment does not have yet", () => {
    expect(suggestTags(known, ["motion"], "")).toEqual([
      "Editorial",
      "Monochrome",
      "Packaging",
      "Type",
    ]);
  });

  it("ranks prefix matches before substring matches, case-insensitively", () => {
    expect(suggestTags(known, [], "mo")).toEqual(["Motion", "Monochrome"]);
    expect(suggestTags(known, [], "ION")).toEqual(["Motion"]);
    expect(suggestTags(known, [], "o")).toEqual([
      "Editorial",
      "Motion",
      "Monochrome",
    ]);
  });

  it("hides an exact match, respects the limit and tolerates messy input", () => {
    expect(suggestTags(known, [], " motion ")).toEqual([]);
    expect(suggestTags(known, [], "", 2)).toEqual(["Editorial", "Motion"]);
    expect(suggestTags(["  Type ", "TYPE", ""], ["type"], "")).toEqual([]);
    expect(suggestTags(known, [], "x", 0)).toEqual([]);
  });
});
