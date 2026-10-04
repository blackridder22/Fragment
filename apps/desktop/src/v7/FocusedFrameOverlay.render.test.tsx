import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoFragments, demoFrames } from "../lib/demo-vault";
import { FocusedFrameOverlay } from "./FocusedFrameOverlay";

const baseProps = {
  currentIndex: 0,
  fragment: demoFragments[0]!,
  frames: demoFrames,
  tags: [] as string[],
  total: demoFragments.length,
  onClose: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
};

describe("FocusedFrameOverlay title", () => {
  it("shows a bounded title with an explicit edit affordance", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        onTitleChange={vi.fn()}
      />,
    );

    expect(markup).toContain('class="v7-focused-title-display"');
    expect(markup).toContain('title="Prism glass study"');
    expect(markup).toContain('aria-label="Edit Fragment title"');
    expect(markup).not.toContain('aria-label="Fragment title"');
  });

  it("keeps the title read-only when no title callback is supplied", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay {...baseProps} assetSources={[]} />,
    );

    expect(markup).toContain("Prism glass study");
    expect(markup).not.toContain('aria-label="Edit Fragment title"');
  });
});

describe("FocusedFrameOverlay tags", () => {
  it("renders real add and remove controls when tags are editable", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        tags={["Motion"]}
        onTagsChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Remove tag Motion"');
    expect(markup).toContain(">+ Add</button>");
    expect(markup).not.toContain(">+ Add</span>");
  });

  it("disables tag editing while native tags are loading", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        tagsLoading
        onTagsChange={vi.fn()}
      />,
    );

    expect(markup).toContain(">Loading…</button>");
    expect(markup).toContain("disabled");
  });
});

describe("FocusedFrameOverlay progressive image", () => {
  it("stacks the gallery thumbnail under the preview until it decodes", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/previews/fragment-01.png" }]}
        thumbnailSources={[{ url: "/thumbnails/fragment-01.png" }]}
      />,
    );

    const thumbIndex = markup.indexOf('class="v7-focused-image-thumb"');
    const fullIndex = markup.indexOf('class="v7-focused-image-full"');
    expect(thumbIndex).toBeGreaterThan(-1);
    expect(fullIndex).toBeGreaterThan(thumbIndex);
    expect(markup).toContain('src="/thumbnails/fragment-01.png"');
    expect(markup).toContain('src="/previews/fragment-01.png"');
    expect(markup).toContain('data-ready="false"');
    expect(markup).toContain('class="v7-focused-image-box"');
  });

  it("skips the thumbnail layer when it would duplicate the preview", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        thumbnailSources={[{ url: "/demo-raster/fragment-01.png" }]}
      />,
    );

    expect(markup).not.toContain("v7-focused-image-thumb");
    expect(markup).toContain('class="v7-focused-image-full"');
  });

  it("shows the unavailable state instead of an empty image", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay {...baseProps} assetSources={[]} />,
    );

    expect(markup).toContain("Preview unavailable");
    expect(markup).not.toContain("v7-focused-image-full");
    expect(markup).not.toContain("v7-focused-zoom");
  });

  it("offers Fit and 100% zoom controls for raster images", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
      />,
    );

    expect(markup).toContain('aria-label="Zoom"');
    expect(markup).toContain(">Fit</button>");
    expect(markup).toContain(">100%</button>");
  });
});

describe("FocusedFrameOverlay details and chrome", () => {
  it("opens in the open state with no trash confirmation and a status slot", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
      />,
    );

    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).not.toContain("v7-focused-confirm");
    expect(markup).toContain('class="v7-focused-status" data-tone="idle"');
  });

  it("renders metadata, provenance, the source row and the Frame selector", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        onFrameChange={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    );

    expect(markup).toContain("230 × 279");
    expect(markup).toContain("Captured ");
    expect(markup).toContain('class="v7-focused-source-link"');
    expect(markup).toContain("fragment.local/source");
    expect(markup).toContain('for="v7-fragment-frame"');
    expect(markup).toContain(">Frame</label>");
    expect(markup).toContain("Reveal Original");
    expect(markup).toContain("Open Source");
  });

  it("uses Fragment vocabulary for the image and Frame for the collection", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        {...baseProps}
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
      />,
    );

    expect(markup).toContain('aria-label="Previous Fragment"');
    expect(markup).toContain('aria-label="Next Fragment"');
    expect(markup).toContain('aria-label="Fragment details"');
    expect(markup).not.toContain("Untitled Frame");
    expect(markup).not.toContain('aria-label="Previous Frame"');
  });
});
