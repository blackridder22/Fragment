import { describe, expect, it } from "vitest";
import { parseDurationMs } from "./preview-motion";

describe("parseDurationMs", () => {
  it("parses millisecond and second tokens", () => {
    expect(parseDurationMs("120ms")).toBe(120);
    expect(parseDurationMs(" 0.2s ")).toBe(200);
    expect(parseDurationMs("200")).toBe(200);
  });

  it("treats missing or malformed values as zero", () => {
    expect(parseDurationMs("")).toBe(0);
    expect(parseDurationMs(null)).toBe(0);
    expect(parseDurationMs("fast")).toBe(0);
    expect(parseDurationMs("-40ms")).toBe(0);
  });
});
