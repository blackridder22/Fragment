import type { Fragment, Frame } from "@fragment/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DAY_MS } from "../features/trash/retention";
import type { GalleryCard } from "../store/library-selectors";
import { TrashPage, type TrashPageProps } from "./TrashPage";

const now = Date.now();

function fragment(id: string, title: string, daysLeft: number | null): Fragment {
  const deletedAt = new Date(now - 2 * DAY_MS).toISOString();
  return {
    id,
    frameId: "frame-posters",
    title,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    capturedAt: deletedAt,
    createdAt: deletedAt,
    updatedAt: deletedAt,
    deletedAt,
    deleteAfter:
      daysLeft === null
        ? null
        : new Date(now + daysLeft * DAY_MS - 60_000).toISOString(),
  };
}

function card(id: string, title: string, daysLeft: number | null): GalleryCard {
  return {
    fragment: fragment(id, title, daysLeft),
    assetSources: [],
    folderName: "Posters",
  };
}

function frame(id: string, name: string): Frame {
  return {
    id,
    parentId: null,
    name,
    sortOrder: 0,
    createdAt: new Date(now - 10 * DAY_MS).toISOString(),
    updatedAt: new Date(now - DAY_MS).toISOString(),
  };
}

const actions = {
  onDeleteFragmentsNow: vi.fn(),
  onDeleteFramesNow: vi.fn(),
  onEmptyTrash: vi.fn(),
  onNotify: vi.fn(),
  onRestoreFragments: vi.fn(),
  onRestoreFrames: vi.fn(),
};

function render(overrides: Partial<TrashPageProps> = {}) {
  return renderToStaticMarkup(
    <TrashPage
      {...actions}
      fragmentTotal={0}
      frameNameFor={() => "Posters"}
      frames={[]}
      items={[]}
      loading={false}
      retention={{ kind: "days", days: 31 }}
      {...overrides}
    />,
  );
}

describe("TrashPage structure", () => {
  it("separates Frames and Fragments into sections with their own counts and sorts", () => {
    const markup = render({
      items: [card("a", "Prism glass study", 6), card("b", "Poster", 1)],
      fragmentTotal: 2,
      frames: [frame("f1", "Old posters")],
    });

    expect(markup).toContain('data-section="frames"');
    expect(markup).toContain('data-section="fragments"');
    expect(markup).toContain(">Frames</h2>");
    expect(markup).toContain(">Fragments</h2>");
    expect(markup).toContain("1 Frame<");
    expect(markup).toContain("2 Fragments<");
    expect(markup).toContain('aria-label="Sort Frames by deleted date"');
    expect(markup).toContain('aria-label="Sort Fragments by deleted date"');
    expect(markup).toContain('aria-label="Select all Frames"');
    expect(markup).toContain('aria-label="Select all Fragments"');
    expect(markup).toContain("2 Fragments · 1 Frame · Items remain recoverable in Trash for 31 days");
  });

  it("keeps the Fragments in the order they arrive (the server sorts)", () => {
    const markup = render({
      items: [card("older", "Older", 1), card("newer", "Newer", 6)],
      fragmentTotal: 2,
      sort: "newest",
    });

    expect(markup.indexOf('data-fragment-id="older"')).toBeLessThan(
      markup.indexOf('data-fragment-id="newer"'),
    );
  });

  it("labels rows with their vocabulary and retention from the precomputed card", () => {
    const markup = render({
      items: [card("a", "Prism glass study", 6), card("b", "Poster", null)],
      fragmentTotal: 2,
      frames: [frame("f1", "Old posters")],
      retention: { kind: "days", days: 7 },
    });

    expect(markup).toContain("Fragment · from Posters");
    expect(markup).toContain("Frame · from Your Vault");
    expect(markup).toContain("Deletes in 6 days");
    expect(markup).toContain("Deleted forever on empty");
    // The Frame was deleted a day ago under a 7-day policy.
    expect(markup).toContain("Deletes in 6 days</span>");
    expect(markup).toContain('data-marquee-item=""');
    expect(markup).toContain('data-fragment-id="a"');
    expect(markup).not.toContain("Untitled Frame");
  });

  it("mirrors the Settings choice when retention is off", () => {
    const markup = render({
      items: [card("a", "Prism glass study", null)],
      fragmentTotal: 1,
      retention: { kind: "forever" },
    });

    expect(markup).toContain("Items are permanently removed immediately");
    expect(markup).toContain("Deleted forever on empty");
  });

  it("reports the server total even before every page is loaded", () => {
    const markup = render({ fragmentTotal: 72, hasMore: true, onLoadMore: vi.fn() });

    expect(markup).toContain("0 of 72 Fragments loaded");
    expect(markup).toContain("72 Fragments · 0 Frames");
    expect(markup).not.toContain("Trash is empty");
  });

  it("shows one empty state when nothing is in Trash", () => {
    const markup = render();

    expect(markup).toContain("Trash is empty");
    expect(markup).toContain("Deleted Frames and Fragments will appear here.");
    expect(markup).not.toContain('data-section="frames"');
    expect(markup).toContain("disabled");
  });

  it("shows the loading state until the Trash has been listed once", () => {
    const markup = render({ loading: true, loaded: false });

    expect(markup).toContain("Loading Trash");
    expect(markup).not.toContain("Trash is empty");
  });

  it("shows the Trash-scoped selection bar for a Fragment selection", () => {
    const markup = render({
      items: [card("a", "Prism glass study", 6), card("b", "Poster", 1)],
      fragmentTotal: 2,
      selectedIds: new Set(["a", "b"]),
      onClearSelection: vi.fn(),
    });

    expect(markup).toContain('data-scope="trash"');
    expect(markup).toContain("2 Fragments selected");
    expect(markup).toContain(">Delete now</button>");
    expect(markup).toContain("Restore 2<");
    expect(markup).toContain("Delete 2 now<");
    expect(markup).toContain('data-selected="true"');
  });
});

describe("TrashPage policy", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "TrashPage.tsx"),
    "utf8",
  );

  it("never falls back to the native confirm", () => {
    expect(source).not.toMatch(/window\.confirm|\bconfirm\(/);
  });

  it("uses Frame for collections and Fragment for images", () => {
    expect(source).not.toMatch(/\bPin\b|\bBoard\b|Repin/);
    // Inverted phrases from the v0.0.9 diagnosis.
    expect(source).not.toMatch(/Restored Frame\b|Deleted Frame\b|Frames moved to Trash/);
  });

  it("confirms Empty Trash with the unfiltered totals, never the visible rows", () => {
    expect(source).toContain("emptyTrashConsequence(vaultTotals)");
    expect(source).not.toMatch(/emptyTrashConsequence\(\{\s*fragments: fragmentCount/);
  });
});
