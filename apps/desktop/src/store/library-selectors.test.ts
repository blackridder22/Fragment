import type { Fragment, Frame } from "@fragment/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  isTauriRuntime: () => false,
  assetUrl: (root: string, path: string) => `${root}/${path}`,
}));
import { V7FrameCard } from "../v7/FrameGallery";
import {
  selectActiveCards,
  selectFocusedFragment,
  selectFolderCovers,
  selectRecursiveCounts,
  selectShellTitles,
  selectVaultFragmentTotal,
} from "./library-selectors";
import { createInitialLibraryState } from "./library-store";
import type { LibraryState } from "./library-types";

const now = "2026-10-04T00:00:00.000Z";

function frame(
  id: string,
  name: string,
  parentId: string | null = null,
): Frame {
  return { id, parentId, name, sortOrder: 0, createdAt: now, updatedAt: now };
}

function fragment(id: string, frameId: string): Fragment {
  return {
    id,
    frameId,
    title: id,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    previewPath: `previews/${id}.png`,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function state(patch: Partial<LibraryState> = {}): LibraryState {
  return {
    ...createInitialLibraryState({ storage: null, previewMode: false }),
    booted: true,
    assetRoot: "/vault",
    frames: [
      frame("inbox", "Inbox"),
      frame("posters", "Posters"),
      frame("nested", "Nested", "posters"),
    ],
    frameCounts: { inbox: 2, posters: 1, nested: 4 },
    ...patch,
  };
}

function withItems(items: Fragment[], patch: Partial<LibraryState> = {}) {
  const base = state(patch);
  return {
    ...base,
    activePage: { ...base.activePage, items, total: items.length },
  };
}

describe("gallery cards", () => {
  it("keeps card and asset-source references stable across unrelated changes", () => {
    const first = withItems([fragment("a", "inbox"), fragment("b", "posters")]);
    const cards = selectActiveCards(first);
    expect(cards.map((card) => card.folderName)).toEqual(["Inbox", "Posters"]);
    expect(cards[0]?.assetSources[0]?.relativePath).toBe("thumbnails/a.png");

    expect(
      selectActiveCards({ ...first, toast: null, frameDropTarget: "trash" }),
    ).toBe(cards);
    expect(
      selectActiveCards({
        ...first,
        selection: {
          mode: "explicit",
          scopeKey: "",
          ids: ["a"],
          anchorId: "a",
        },
      }),
    ).toBe(cards);
  });

  it("reuses unchanged cards when a page is appended", () => {
    const a = fragment("a", "inbox");
    const b = fragment("b", "posters");
    const c = fragment("c", "posters");
    const first = withItems([a, b]);
    const before = selectActiveCards(first);
    const after = selectActiveCards({
      ...first,
      activePage: { ...first.activePage, items: [a, b, c] },
    });
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]?.fragment).toBe(c);
  });

  it("recomputes only the affected card when a Frame is renamed", () => {
    const first = withItems([fragment("a", "inbox"), fragment("b", "posters")]);
    const before = selectActiveCards(first);
    const after = selectActiveCards({
      ...first,
      frames: first.frames.map((item) =>
        item.id === "posters" ? { ...item, name: "Print" } : item,
      ),
    });
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.folderName).toBe("Print");
  });

  it("wraps the card in React.memo", () => {
    expect((V7FrameCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });
});

describe("counts and covers", () => {
  it("aggregates recursive counts and the Vault total", () => {
    const current = state();
    expect(selectRecursiveCounts(current).get("posters")).toBe(5);
    expect(selectRecursiveCounts(current).get("inbox")).toBe(2);
    expect(selectVaultFragmentTotal(current)).toBe(7);
  });

  it("builds at most three covers per Frame from snapshot covers and the page", () => {
    const current = withItems(
      [fragment("c1", "inbox"), fragment("p1", "posters")],
      {
        coverFragments: ["c1", "c2", "c3", "c4"].map((id) =>
          fragment(id, "inbox"),
        ),
      },
    );
    const byFrame = selectFolderCovers(current);
    expect(byFrame.get("inbox")?.map((card) => card.fragment.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(byFrame.get("posters")?.map((card) => card.fragment.id)).toEqual([
      "p1",
    ]);
  });
});

describe("titles and focus", () => {
  it("uses Fragment for images and Frame for collections", () => {
    const base = withItems([fragment("a", "inbox")]);
    base.activePage.total = 42;
    expect(selectShellTitles(base)).toEqual({
      title: "Your Vault",
      subtitle: "3 Frames · 42 Fragments",
    });
    expect(selectShellTitles({ ...base, view: "frames" })).toEqual({
      title: "All Fragments",
      subtitle: "42 Fragments across 3 Frames",
    });
    expect(selectShellTitles({ ...base, selectedFrameId: "posters" })).toEqual({
      title: "Posters",
      subtitle: "42 Fragments",
    });
  });

  it("returns the latest page copy of the focused Fragment", () => {
    const stale = fragment("a", "inbox");
    const fresh = { ...stale, title: "Renamed" };
    const current = withItems([fresh], {
      focused: { fragment: stale, mode: "preview" },
    });
    expect(selectFocusedFragment(current)).toBe(fresh);
  });
});
