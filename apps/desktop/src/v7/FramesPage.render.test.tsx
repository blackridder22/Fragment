import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoFragments } from "../lib/demo-vault";
import { FramesPage } from "./FramesPage";

const base = {
  assetSourcesFor: () => [{ url: "/demo-raster/fragment-01.png" }],
  folderNameFor: () => "Posters",
  layout: "masonry" as const,
  onContextMenu: vi.fn(),
  onOpen: vi.fn(),
  onSelect: vi.fn(),
  selectedIds: new Set<string>(),
};

describe("FramesPage filters", () => {
  it("shows a chip per active filter with one-click clear and a match count", () => {
    const markup = renderToStaticMarkup(
      <FramesPage
        {...base}
        filter={{
          mimeTypes: ["image/png"],
          orientation: "portrait",
          tags: ["editorial"],
          color: { hex: "#E66B54", tolerance: 80 },
        }}
        fragments={demoFragments.slice(0, 3)}
        resultCount={12}
        sourceFilter="local"
      />,
    );

    expect(markup).toContain(">All Fragments</span>");
    expect(markup).toContain(">Format</span>");
    expect(markup).toContain('aria-label="Active filters"');
    for (const label of [
      "PNG",
      "Portrait",
      "Local files",
      "editorial",
      "#E66B54",
    ]) {
      expect(markup).toContain(`aria-label="Remove filter ${label}"`);
    }
    expect(markup).toContain(">Clear filters</button>");
    expect(markup).toContain("12 matches");
    expect(markup).not.toContain("results");
  });

  it("hides the chips and counts Fragments when nothing is filtered", () => {
    const markup = renderToStaticMarkup(
      <FramesPage
        {...base}
        fragments={demoFragments.slice(0, 3)}
        resultCount={1000}
      />,
    );

    expect(markup).not.toContain("Active filters");
    expect(markup).not.toContain("Clear filters");
    expect(markup).toContain("1,000 Fragments");
    expect(markup).not.toContain("No Frames");
  });

  it("routes a page failure to the footer when Fragments are already shown", () => {
    const withItems = renderToStaticMarkup(
      <FramesPage
        {...base}
        error="Library is busy"
        fragments={demoFragments.slice(0, 3)}
        hasMore
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        resultCount={1000}
      />,
    );
    expect(withItems).toContain("Couldn’t load more Fragments");
    expect(withItems).not.toContain("Couldn’t load Fragments<");

    const empty = renderToStaticMarkup(
      <FramesPage
        {...base}
        error="Library is busy"
        fragments={[]}
        onRetry={vi.fn()}
        resultCount={0}
      />,
    );
    expect(empty).toContain("Couldn’t load Fragments");
    expect(empty).not.toContain("Couldn’t load more");
  });

  it("names the open Frame in the empty state", () => {
    const markup = renderToStaticMarkup(
      <FramesPage
        {...base}
        fragments={[]}
        frameName="Posters"
        resultCount={0}
      />,
    );
    expect(markup).toContain("No Fragments in Posters yet");
  });
});
