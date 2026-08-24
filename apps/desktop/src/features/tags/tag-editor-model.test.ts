import { describe, expect, it } from "vitest";
import {
  addTag,
  normalizeTags,
  removeTag,
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
