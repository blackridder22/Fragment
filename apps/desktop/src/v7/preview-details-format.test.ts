import { describe, expect, it } from "vitest";
import { demoFragments } from "../lib/demo-vault";
import {
  compactSource,
  fileType,
  formatBytes,
  formatMetadata,
  formatProvenance,
  sourceName,
} from "./preview-details-format";

const fragment = demoFragments[0]!;

describe("preview details formatting", () => {
  it("formats bytes with sensible units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(412_000)).toBe("412 KB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
    expect(formatBytes(2_000_000_000)).toBe("2 GB");
  });

  it("derives the type label from the mime type or extension", () => {
    expect(fileType({ ...fragment, mimeType: "image/jpeg" })).toBe("JPG");
    expect(fileType({ ...fragment, mimeType: "image/svg+xml" })).toBe("SVG");
    expect(
      fileType({ ...fragment, mimeType: null, originalPath: "a/b/c.webp" }),
    ).toBe("WEBP");
  });

  it("joins dimensions, type and size for the metadata row", () => {
    expect(
      formatMetadata({
        ...fragment,
        width: 1600,
        height: 900,
        mimeType: "image/png",
        fileSize: 240_000,
      }),
    ).toBe("1600 × 900 · PNG · 240 KB");
    expect(
      formatMetadata({
        ...fragment,
        width: null,
        height: null,
        mimeType: "image/png",
        fileSize: null,
      }),
    ).toBe("PNG");
  });

  it("describes provenance from the capture date and site", () => {
    const captured = formatProvenance(
      { ...fragment, capturedAt: "2026-10-04T10:00:00.000Z", siteName: null },
      "https://www.example.com/post/1",
    );
    expect(captured.startsWith("Captured ")).toBe(true);
    expect(captured.endsWith("· example.com")).toBe(true);

    const imported = formatProvenance(
      { ...fragment, capturedAt: "2026-10-04T10:00:00.000Z", siteName: null },
      null,
    );
    expect(imported.startsWith("Imported ")).toBe(true);
    expect(imported).not.toContain("·");

    expect(
      formatProvenance({ ...fragment, capturedAt: "nope", siteName: "" }, null),
    ).toBe("");
  });

  it("names and compacts the source", () => {
    expect(sourceName({ ...fragment, siteName: "Dribbble" }, null)).toBe(
      "Dribbble",
    );
    expect(sourceName({ ...fragment, siteName: null }, null)).toBe(
      "Local import",
    );
    expect(
      sourceName({ ...fragment, siteName: null }, "https://www.site.io/x"),
    ).toBe("site.io");
    expect(sourceName({ ...fragment, siteName: null }, "not a url")).toBe(
      "Web source",
    );
    expect(compactSource("https://www.site.io/a/b?c=1")).toBe("site.io/a/b");
    expect(compactSource("https://site.io/")).toBe("site.io");
    expect(compactSource("garbage")).toBe("garbage");
  });
});
