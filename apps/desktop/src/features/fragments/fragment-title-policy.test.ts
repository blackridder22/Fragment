import { describe, expect, it } from "vitest";
import {
  FRAGMENT_TITLE_MAX_CODE_POINTS,
  normalizeFragmentTitle,
} from "./fragment-title-policy";

describe("normalizeFragmentTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeFragmentTitle("  Warm\n\t gallery   reference  ")).toBe(
      "Warm gallery reference",
    );
  });

  it("leaves a title at the limit unchanged", () => {
    const title = "a".repeat(FRAGMENT_TITLE_MAX_CODE_POINTS);

    expect(normalizeFragmentTitle(title)).toBe(title);
  });

  it("truncates long titles with an ellipsis inside the limit", () => {
    const result = normalizeFragmentTitle(
      "a".repeat(FRAGMENT_TITLE_MAX_CODE_POINTS + 1),
    );

    expect(result).toBe(`${"a".repeat(FRAGMENT_TITLE_MAX_CODE_POINTS - 1)}…`);
    expect(Array.from(result)).toHaveLength(FRAGMENT_TITLE_MAX_CODE_POINTS);
  });

  it("counts Unicode code points without splitting surrogate pairs", () => {
    const result = normalizeFragmentTitle(
      `${"😀".repeat(FRAGMENT_TITLE_MAX_CODE_POINTS)}x`,
    );

    expect(result).toBe(`${"😀".repeat(FRAGMENT_TITLE_MAX_CODE_POINTS - 1)}…`);
    expect(Array.from(result)).toHaveLength(FRAGMENT_TITLE_MAX_CODE_POINTS);
    expect(result).not.toContain("�");
  });
});
