import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Fragment } from "@fragment/shared";
import { demoFragments } from "../lib/demo-vault";
import { FrameGallery } from "./FrameGallery";
import { MAX_MOUNTED_CARDS } from "./virtual-window";

const SHAPES: Array<[number, number]> = [
  [3000, 1000],
  [1000, 3000],
  [1600, 1200],
  [1200, 1600],
  [800, 800],
];

function fragment(
  index: number,
  shape = SHAPES[index % SHAPES.length]!,
): Fragment {
  return {
    ...demoFragments[0]!,
    id: `qa-${String(index).padStart(4, "0")}`,
    title: `Media ${index}`,
    width: shape[0],
    height: shape[1],
  };
}

const fragments = Array.from({ length: 1000 }, (_, index) => fragment(index));

const handlers = {
  assetSourcesFor: (item: Fragment) => [{ url: `/qa/${item.id}.png` }],
  folderNameFor: () => "Media QA",
  onContextMenu: vi.fn(),
  onOpen: vi.fn(),
  onSelect: vi.fn(),
};

function countCards(markup: string) {
  return markup.split('class="fragment-card v7-frame-card').length - 1;
}

describe("FrameGallery", () => {
  it("mounts only a window of cards for a large page", () => {
    const markup = renderToStaticMarkup(
      <FrameGallery
        {...handlers}
        fragments={fragments}
        layout="masonry"
        resultCount={1000}
        selectedIds={new Set()}
      />,
    );

    const cards = countCards(markup);
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThanOrEqual(MAX_MOUNTED_CARDS);
    expect(markup).toContain('aria-label="1,000 Fragments"');
    expect(markup).toContain('data-virtual="true"');
    expect(markup).toMatch(/class="v7-frame-gallery"[^>]*style="height:\d+/);
  });

  it("gives masonry cards the Fragment's aspect ratio instead of cropping", () => {
    const markup = renderToStaticMarkup(
      <FrameGallery
        {...handlers}
        fragments={[
          fragment(0, [3000, 1000]),
          fragment(1, [1000, 3000]),
          fragment(2, [0, 0]),
        ]}
        layout="masonry"
        selectedIds={new Set(["qa-0001"])}
      />,
    );

    expect(markup).toContain("aspect-ratio:3");
    expect(markup).toContain("aspect-ratio:0.3333333333333333");
    expect(markup).toContain("aspect-ratio:1.3333333333333333");
    expect(markup).not.toContain('data-cropped="true"');
    expect(markup).not.toContain("Cropped to fit the grid");
    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('aria-setsize="3"');
    expect(markup).toContain('data-loaded="pending"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
  });

  it("keeps grid cells uniform and says that they crop", () => {
    const markup = renderToStaticMarkup(
      <FrameGallery
        {...handlers}
        density="comfortable"
        fragments={[fragment(0, [3000, 1000]), fragment(1, [1000, 3000])]}
        layout="grid"
        selectedIds={new Set()}
      />,
    );

    expect(markup).toContain("height:240px");
    expect(markup).not.toContain("aspect-ratio");
    expect(markup).toContain('data-cropped="true"');
    expect(markup).toContain("Cropped to fit the grid");
  });

  it("renders the empty, filtered, loading and failed states with Fragment copy", () => {
    const base = {
      ...handlers,
      layout: "masonry" as const,
      selectedIds: new Set<string>(),
    };

    expect(
      renderToStaticMarkup(
        <FrameGallery {...base} fragments={[]} frameName="Posters" />,
      ),
    ).toContain("No Fragments in Posters yet");
    expect(
      renderToStaticMarkup(<FrameGallery {...base} fragments={[]} />),
    ).toContain("No Fragments in your Vault yet");

    const filtered = renderToStaticMarkup(
      <FrameGallery
        {...base}
        fragments={[]}
        hasActiveFilters
        onClearFilters={vi.fn()}
      />,
    );
    expect(filtered).toContain("No Fragments match these filters");
    expect(filtered).toContain(">Clear filters</button>");

    const loading = renderToStaticMarkup(
      <FrameGallery {...base} fragments={[]} loading />,
    );
    expect(loading).toContain("Loading Fragments…");
    expect(loading).toContain('aria-busy="true"');

    const failed = renderToStaticMarkup(
      <FrameGallery
        {...base}
        fragments={[]}
        error="Disk is offline"
        onRetry={vi.fn()}
      />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Couldn’t load Fragments");
    expect(failed).toContain("Disk is offline");
    expect(failed).toContain(">Retry</span>");
    expect(failed).not.toContain("No Frames");
  });
});
