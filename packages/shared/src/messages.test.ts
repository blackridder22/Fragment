import { describe, expect, it } from "vitest";
import { captureFragmentRequestSchema, nativeRequestSchema } from "./messages";

const candidate = {
  id: "candidate-1",
  src: "https://cdn.example.com/reference.png",
  pageUrl: "https://example.com/gallery",
  width: 640,
  height: 480,
  rect: {
    x: 10,
    y: 20,
    width: 320,
    height: 240,
  },
  source: "generic" as const,
};

describe("native message validation", () => {
  it("accepts a capture request with nullable frame fallback and tags", () => {
    const parsed = captureFragmentRequestSchema.parse({
      type: "capture.fragment",
      requestId: "capture-1",
      frameId: null,
      candidate,
      note: "reference note",
      tags: ["texture", "motion"],
      requestedAt: "2026-06-24T12:00:00.000Z",
      extensionVersion: "0.1.0",
    });

    expect(parsed.frameId).toBeNull();
    expect(parsed.tags).toEqual(["texture", "motion"]);
  });

  it("rejects unknown native message types", () => {
    expect(() =>
      nativeRequestSchema.parse({
        type: "capture.bulk",
        requestId: "bad-1",
      }),
    ).toThrow();
  });

  it("rejects unknown image candidate sources", () => {
    expect(() =>
      captureFragmentRequestSchema.parse({
        type: "capture.fragment",
        requestId: "capture-1",
        frameId: null,
        candidate: {
          ...candidate,
          source: "bulk_scraper",
        },
        requestedAt: "2026-06-24T12:00:00.000Z",
        extensionVersion: "0.1.0",
      }),
    ).toThrow();
  });
});
