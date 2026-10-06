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

  it("exposes every batch action for multiple selected Fragments", () => {
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
    expect(markup).toContain(">Move to Frame</button>");
    expect(markup).toContain(">Tag</button>");
    expect(markup).toContain(">Trash</button>");
    expect(markup).toContain('aria-label="Clear Fragment selection"');
  });

  it("offers Restore and Delete now in Trash scope with Fragment vocabulary", () => {
    const markup = renderToStaticMarkup(
      <SelectionActionBar
        count={4}
        countLabel="3 Fragments and 1 Frame selected"
        scope="trash"
        onClear={vi.fn()}
        onDeleteNow={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(markup).toContain('data-scope="trash"');
    expect(markup).toContain("3 Fragments and 1 Frame selected");
    expect(markup).toContain(">Restore</button>");
    expect(markup).toContain(">Delete now</button>");
    expect(markup).not.toContain(">Move to Fragment</button>");
    expect(markup).not.toContain(">Tag</button>");
    expect(markup).toContain('aria-label="Clear selection"');
  });
});
