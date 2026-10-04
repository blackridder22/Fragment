import { describe, expect, it } from "vitest";
import { colorFilterSchema, normalizeHex } from "./colors";
describe("color boundary", () => {
  it("normalizes user HEX and rejects malformed native filters", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex(" #12abef ")).toBe("#12ABEF");
    expect(normalizeHex("#12345G")).toBeNull();
    expect(
      colorFilterSchema.safeParse({ hex: "#abc", tolerance: 80 }).success,
    ).toBe(false);
    expect(
      colorFilterSchema.safeParse({ hex: "#AABBCC", tolerance: 80.2 }).success,
    ).toBe(false);
    expect(
      colorFilterSchema.safeParse({ hex: "#AABBCC", tolerance: 201 }).success,
    ).toBe(false);
    expect(colorFilterSchema.parse({ hex: "#AABBCC", tolerance: 80 }).hex).toBe(
      "#AABBCC",
    );
  });
});
