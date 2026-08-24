import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoFragments, demoFrames } from "../lib/demo-vault";
import { FocusedFrameOverlay } from "./FocusedFrameOverlay";

describe("FocusedFrameOverlay title", () => {
  it("shows a bounded title with an explicit edit affordance", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        currentIndex={0}
        fragment={demoFragments[0]!}
        frames={demoFrames}
        tags={[]}
        total={demoFragments.length}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onTitleChange={vi.fn()}
      />,
    );

    expect(markup).toContain('class="v7-focused-title-display"');
    expect(markup).toContain('title="Prism glass study"');
    expect(markup).toContain('aria-label="Edit Frame title"');
    expect(markup).not.toContain('aria-label="Frame title"');
  });

  it("keeps the title read-only when no title callback is supplied", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        assetSources={[]}
        currentIndex={0}
        fragment={demoFragments[0]!}
        frames={demoFrames}
        tags={[]}
        total={demoFragments.length}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
      />,
    );

    expect(markup).toContain("Prism glass study");
    expect(markup).not.toContain('aria-label="Edit Frame title"');
  });
});

describe("FocusedFrameOverlay tags", () => {
  it("renders real add and remove controls when tags are editable", () => {
    const markup = renderToStaticMarkup(
      <FocusedFrameOverlay
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        currentIndex={0}
        fragment={demoFragments[0]!}
        frames={demoFrames}
        tags={["Motion"]}
        total={demoFragments.length}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
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
        assetSources={[{ url: "/demo-raster/fragment-01.png" }]}
        currentIndex={0}
        fragment={demoFragments[0]!}
        frames={demoFrames}
        tags={[]}
        tagsLoading
        total={demoFragments.length}
        onClose={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        onTagsChange={vi.fn()}
      />,
    );

    expect(markup).toContain(">Loading…</button>");
    expect(markup).toContain("disabled");
  });
});
