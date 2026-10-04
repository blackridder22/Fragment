import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Fragment, Frame } from "@fragment/shared";
import { VaultPage, type VaultPageProps } from "./VaultPage";

function frame(id: string, name = id): Frame {
  return {
    id,
    parentId: null,
    name,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function fragment(id: string, frameId: string): Fragment {
  return {
    id,
    frameId,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    width: 400,
    height: 300,
    capturedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const inbox = { ...frame("inbox", "Inbox"), sortOrder: 11 };
// Inbox sorts last by sortOrder on purpose: the page must still pin it first.
const twelveFrames = [
  ...Array.from({ length: 11 }, (_, index) => ({
    ...frame(`frame-${index + 1}`, `Frame ${index + 1}`),
    sortOrder: index,
  })),
  inbox,
];
const page = Array.from({ length: 30 }, (_, index) =>
  fragment(`fragment-${index}`, index % 2 === 0 ? "inbox" : "frame-1"),
);

function render(overrides: Partial<VaultPageProps> = {}) {
  return renderToStaticMarkup(
    <VaultPage
      assetSourcesFor={(item) => [{ url: `asset://${item.thumbnailPath}` }]}
      folderNameFor={() => "Vault"}
      frameCounts={new Map([
        ["inbox", 1],
        ["frame-1", 3],
        ["frame-11", 1200],
      ])}
      framePreviews={
        new Map([
          ["frame-11", [fragment("deep-1", "frame-11-child")]],
          ["frame-1", [fragment("f1-a", "frame-1"), fragment("f1-b", "frame-1")]],
        ])
      }
      frames={twelveFrames}
      fragments={page}
      selectedIds={new Set()}
      systemFrameId="inbox"
      onBrowseAll={vi.fn()}
      onContextMenu={vi.fn()}
      onImport={vi.fn()}
      onOpen={vi.fn()}
      onOpenFolder={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelect={vi.fn()}
      {...overrides}
    />,
  );
}

function count(markup: string, needle: string) {
  return markup.split(needle).length - 1;
}

function framesSection(markup: string) {
  const end = markup.indexOf('class="v7-vault-recent"');
  return end === -1 ? markup : markup.slice(0, end);
}

const FOLDER_CARD = 'data-drop-target="frame-tree:';

describe("VaultPage frames section", () => {
  it("shows the first eight of twelve top-level Frames with an expander for the rest", () => {
    const markup = render();
    expect(count(markup, FOLDER_CARD)).toBe(8);
    expect(markup).toContain("Show all Frames");
    expect(markup).toContain("4 more");
    expect(markup).toContain("12 Frames");
    expect(markup).not.toContain("Frame 11</strong>");
  });

  it("marks Inbox as the system Frame and uses Fragment for counts", () => {
    const markup = render();
    expect(markup).toContain('data-system="true"');
    expect(count(markup, 'data-system="true"')).toBe(1);
    expect(markup.indexOf('frame-tree:inbox"')).toBeLessThan(
      markup.indexOf('frame-tree:frame-1"'),
    );
    expect(markup).toContain("System");
    expect(markup).toContain('aria-label="Open Inbox, 1 Fragment"');
    expect(markup).toContain('aria-label="Open Frame 1, 3 Fragments"');
    expect(markup).toContain('class="v7-folder-card-count">3 Fragments<');
    expect(markup).not.toMatch(/v7-folder-card-count">[\d,]+ Frames?</);
  });

  it("keeps folder cards as drop targets for Fragment drags and arms the hovered one", () => {
    const markup = render({ dropTarget: "frame-tree:frame-1" });
    expect(markup).toContain('data-drop-target="frame-tree:inbox"');
    expect(markup).toContain(
      'data-drop-state="armed" data-drop-target="frame-tree:frame-1"',
    );
    expect(count(markup, 'data-drop-state="armed"')).toBe(1);
  });

  it("builds collages from backend previews, then the loaded page, then neutral tiles", () => {
    const frames = framesSection(
      render({
        frames: [
          inbox,
          frame("frame-1", "Frame 1"),
          frame("frame-11", "Frame 11"),
          frame("bare", "Bare"),
        ],
      }),
    );
    // Frame 11 is outside the loaded page; its collage comes from the backend previews.
    expect(frames).toContain("asset://thumbnails/deep-1.png");
    // Frame 1 has previews, so the page items for it are not used for its collage.
    expect(frames).toContain("asset://thumbnails/f1-a.png");
    expect(frames).not.toContain("asset://thumbnails/fragment-1.png");
    // Inbox has no previews and falls back to the loaded page.
    expect(frames).toContain("asset://thumbnails/fragment-0.png");
    // A Frame with nothing anywhere shows neutral tiles.
    expect(frames).toContain(
      'class="v7-folder-image v7-asset-fallback" data-tone="0"',
    );
  });
});

describe("VaultPage recently added", () => {
  it("renders a bounded set of newest Fragments in justified rows without pagination", () => {
    const markup = render();
    expect(count(markup, "v7-vault-recent-card")).toBe(18);
    expect(markup).toContain("Recently added");
    expect(markup).toContain("Fragments from across your Vault");
    expect(markup).toContain("Browse all");
    expect(markup).toContain("--v7-recent-ratio:1.3333333333333333");
    expect(markup).toContain("--v7-recent-row-sum:");
    expect(markup).not.toContain("Load more");
    expect(markup).not.toContain("Showing");
    expect(markup).not.toContain("Frames from across your Vault");
  });

  it("staggers the first paint by index and caps the delay slot at eight", () => {
    const markup = render();
    expect(markup).toContain("--v7-stagger-index:0");
    expect(markup).toContain("--v7-stagger-index:7");
    expect(markup).not.toContain("--v7-stagger-index:8");
    expect(count(markup, "v7-vault-enter")).toBe(8 + 18);
  });

  it("relabels the section while a search is active", () => {
    const markup = render({ searchQuery: "poster" });
    expect(markup).toContain("Matching Fragments");
    expect(markup).toContain("Fragments matching “poster” across your Vault");
  });

  it("offers an import when Frames exist but nothing has been saved yet", () => {
    const markup = render({ fragments: [], framePreviews: undefined });
    expect(markup).toContain("No Fragments yet");
    expect(markup).toContain("Import Fragments");
    expect(markup).not.toContain("Your Vault is empty");
  });
});

describe("VaultPage empty Vault", () => {
  it("explains Frames and Fragments with import and Capture Mode actions", () => {
    const markup = render({ frames: [inbox], fragments: [], framePreviews: undefined });
    expect(markup).toContain("Your Vault is empty");
    expect(markup).toContain("<strong>Frames</strong>");
    expect(markup).toContain("<strong>Fragments</strong>");
    expect(markup).toContain("Import Fragments");
    expect(markup).toContain("Set up Capture Mode");
    expect(markup).toContain("Settings");
    expect(markup).not.toContain("Recently added");
    expect(markup).not.toContain("No Frames in your Vault yet");
  });

  it("does not flash the empty state before the first snapshot", () => {
    const markup = render({ frames: [], fragments: [], framePreviews: undefined, ready: false });
    expect(markup).not.toContain("Your Vault is empty");
    expect(markup).not.toContain("No Fragments yet");
    expect(markup).toContain("Recently added");
  });
});
