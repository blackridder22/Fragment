import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoFrames } from "../lib/demo-vault";
import { SelectionActionBar } from "./SelectionActionBar";

const actions = {
  onClear: vi.fn(),
  onMove: vi.fn(),
  onPreview: vi.fn(),
  onTag: vi.fn(),
  onTrash: vi.fn(),
};

describe("SelectionActionBar", () => {
  it("does not render without a selection", () => {
    const markup = renderToStaticMarkup(
      <SelectionActionBar
        {...actions}
        count={0}
        frames={demoFrames}
        knownTags={[]}
      />,
    );

    expect(markup).toBe("");
  });

  it("exposes every batch action for multiple selected Frames", () => {
    const markup = renderToStaticMarkup(
      <SelectionActionBar
        {...actions}
        count={3}
        frames={demoFrames}
        knownTags={["Editorial"]}
      />,
    );

    expect(markup).toContain("3 selected");
    expect(markup).toContain(">Preview</button>");
    expect(markup).toContain(">Move to Fragment</button>");
    expect(markup).toContain(">Tag</button>");
    expect(markup).toContain(">Trash</button>");
    expect(markup).toContain('aria-label="Clear Frame selection"');
  });
});
