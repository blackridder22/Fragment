import { describe, expect, it } from "vitest";
import { bestSrcsetCandidateUrl, isCredibleCandidate } from "./image-detector";

describe("image candidate filtering", () => {
  it("rejects small tracking-like images", () => {
    expect(
      isCredibleCandidate({
        width: 1,
        height: 1,
        src: "https://example.com/pixel.png",
      }),
    ).toBe(false);
  });

  it("accepts large raster images", () => {
    expect(
      isCredibleCandidate({
        width: 640,
        height: 420,
        src: "https://example.com/photo.jpg",
      }),
    ).toBe(true);
  });

  it("rejects inline svg icons by default", () => {
    expect(
      isCredibleCandidate({
        width: 200,
        height: 200,
        src: "data:image/svg+xml;base64,abc",
      }),
    ).toBe(false);
  });
});

describe("best image URL selection", () => {
  it("uses the last srcset candidate and resolves it against the page URL", () => {
    expect(
      bestSrcsetCandidateUrl(
        "/small.jpg 400w, https://cdn.example.com/large.webp 1200w",
        "https://example.com/gallery/page",
      ),
    ).toBe("https://cdn.example.com/large.webp");
  });

  it("returns undefined for empty srcset values", () => {
    expect(
      bestSrcsetCandidateUrl("", "https://example.com/gallery/page"),
    ).toBeUndefined();
  });
});
