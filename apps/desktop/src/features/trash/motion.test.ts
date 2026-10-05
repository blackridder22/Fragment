import { describe, expect, it } from "vitest";
import { parseCssDuration, readMotionDuration } from "./motion";

describe("motion tokens", () => {
  it("parses milliseconds and seconds", () => {
    expect(parseCssDuration("200ms", 50)).toBe(200);
    expect(parseCssDuration(" 0.32s ", 50)).toBe(320);
    expect(parseCssDuration("0ms", 50)).toBe(0);
  });

  it("falls back for empty or malformed values", () => {
    expect(parseCssDuration("", 50)).toBe(50);
    expect(parseCssDuration("fast", 50)).toBe(50);
  });

  it("reports no motion outside a browser", () => {
    expect(readMotionDuration("--dur-base", 200)).toBe(0);
  });
});
