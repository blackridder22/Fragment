import { describe, expect, it } from "vitest";
import type { Fragment, Frame } from "@fragment/shared";
import {
  FOLDER_CARD_LIMIT,
  RECENT_LIMIT,
  RECENT_ROW_TARGET,
  STAGGER_CAP,
  aspectRatioOf,
  collageFragments,
  fragmentCountLabel,
  frameCountFor,
  isBrandNewVault,
  isSystemFrame,
  justifiedRows,
  recentFragments,
  staggerIndex,
  topLevelFrames,
  visibleFolderFrames,
} from "./vault-home";

function frame(id: string, parentId: string | null = null): Frame {
  return {
    id,
    parentId,
    name: id,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function fragment(
  id: string,
  frameId: string,
  size: { width?: number | null; height?: number | null } = {},
): Fragment {
  return {
    id,
    frameId,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    width: size.width ?? 400,
    height: size.height ?? 300,
    capturedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("folder card selection", () => {
  const frames = Array.from({ length: 12 }, (_, index) =>
    frame(`frame-${index + 1}`),
  );

  it("keeps only top-level Frames, in sidebar order with Inbox first", () => {
    expect(
      topLevelFrames([frame("a"), frame("b", "a"), frame("c")]).map((f) => f.id),
    ).toEqual(["a", "c"]);
    const later = { ...frame("later"), sortOrder: 2 };
    const earlier = { ...frame("earlier"), sortOrder: 1 };
    const inbox = { ...frame("inbox"), name: "Inbox", sortOrder: 5 };
    expect(
      topLevelFrames([later, inbox, earlier], "inbox").map((f) => f.id),
    ).toEqual(["inbox", "earlier", "later"]);
    expect(topLevelFrames([later, earlier], "inbox").map((f) => f.id)).toEqual(
      ["earlier", "later"],
    );
  });

  it("shows the first eight Frames collapsed and reports the remainder", () => {
    const collapsed = visibleFolderFrames(frames, false);
    expect(collapsed.visible).toHaveLength(FOLDER_CARD_LIMIT);
    expect(collapsed.visible[0]?.id).toBe("frame-1");
    expect(collapsed.visible.at(-1)?.id).toBe("frame-8");
    expect(collapsed.hiddenCount).toBe(4);
  });

  it("reveals every Frame when expanded or when they fit", () => {
    expect(visibleFolderFrames(frames, true).visible).toHaveLength(12);
    expect(visibleFolderFrames(frames, true).hiddenCount).toBe(0);
    const few = frames.slice(0, 5);
    expect(visibleFolderFrames(few, false)).toEqual({
      visible: few,
      hiddenCount: 0,
    });
  });

  it("marks Inbox as the system Frame by id, falling back to its root name", () => {
    const inbox = { ...frame("inbox-id"), name: "Inbox" };
    expect(isSystemFrame(inbox, "inbox-id")).toBe(true);
    expect(isSystemFrame(frame("other"), "inbox-id")).toBe(false);
    expect(isSystemFrame(inbox, null)).toBe(true);
    expect(isSystemFrame({ ...inbox, parentId: "parent" }, null)).toBe(false);
  });
});

describe("collage selection", () => {
  const page = [
    fragment("p1", "frame-a"),
    fragment("p2", "frame-b"),
    fragment("p3", "frame-a"),
    fragment("p4", "frame-a"),
    fragment("p5", "frame-a"),
  ];

  it("prefers the backend previews so Frames outside the first page get real tiles", () => {
    const previews = new Map([
      ["frame-z", [fragment("z1", "frame-z"), fragment("z2", "frame-z-child")]],
    ]);
    expect(
      collageFragments("frame-z", previews, page).map((f) => f.id),
    ).toEqual(["z1", "z2"]);
  });

  it("falls back to the loaded page for a Frame without previews, capped at three", () => {
    expect(collageFragments("frame-a", undefined, page).map((f) => f.id)).toEqual(
      ["p1", "p3", "p4"],
    );
    expect(collageFragments("frame-a", new Map(), page)).toHaveLength(3);
    expect(collageFragments("frame-none", {}, page)).toEqual([]);
  });

  it("accepts a plain record and de-duplicates ids", () => {
    const duplicate = fragment("d1", "frame-a");
    expect(
      collageFragments("frame-a", { "frame-a": [duplicate, duplicate] }, []),
    ).toHaveLength(1);
  });

  it("uses recursive store totals and falls back to counting the page", () => {
    const target = frame("frame-a");
    expect(frameCountFor(target, new Map([["frame-a", 42]]), page)).toBe(42);
    expect(frameCountFor(target, { "frame-a": 7 }, page)).toBe(7);
    expect(frameCountFor(target, { "frame-b": 7 }, page)).toBe(0);
    expect(frameCountFor(target, undefined, page)).toBe(4);
  });

  it("uses the Fragment noun for counts", () => {
    expect(fragmentCountLabel(1)).toBe("1 Fragment");
    expect(fragmentCountLabel(0)).toBe("0 Fragments");
    expect(fragmentCountLabel(1200)).toBe("1,200 Fragments");
  });
});

describe("recently added rows", () => {
  const many = Array.from({ length: 40 }, (_, index) =>
    fragment(`r${index}`, "frame-a"),
  );

  it("is bounded and de-duplicated so the home page never paginates", () => {
    expect(recentFragments(many)).toHaveLength(RECENT_LIMIT);
    expect(RECENT_LIMIT).toBeGreaterThanOrEqual(12);
    expect(RECENT_LIMIT).toBeLessThanOrEqual(24);
    expect(recentFragments([many[0]!, many[0]!, many[1]!])).toHaveLength(2);
    expect(recentFragments(many, 5).map((f) => f.id)).toEqual([
      "r0",
      "r1",
      "r2",
      "r3",
      "r4",
    ]);
  });

  it("derives the aspect ratio from stored dimensions with a 4:3 fallback and clamps", () => {
    expect(aspectRatioOf({ width: 800, height: 400 })).toBe(2);
    expect(aspectRatioOf({ width: null, height: 400 })).toBeCloseTo(4 / 3);
    expect(aspectRatioOf({ width: 0, height: 0 })).toBeCloseTo(4 / 3);
    expect(aspectRatioOf({ width: 3000, height: 400 })).toBe(2.4);
    expect(aspectRatioOf({ width: 100, height: 1000 })).toBe(0.6);
  });

  it("fills rows until the aspect ratios reach the target and keeps order", () => {
    const items = [
      fragment("a", "f", { width: 400, height: 300 }), // 1.33
      fragment("b", "f", { width: 300, height: 300 }), // 1
      fragment("c", "f", { width: 600, height: 300 }), // 2
      fragment("d", "f", { width: 300, height: 400 }), // 0.75
      fragment("e", "f", { width: 400, height: 300 }), // 1.33
      fragment("g", "f", { width: 400, height: 300 }), // 1.33
    ];
    const rows = justifiedRows(items, 4);
    expect(rows.map((row) => row.items.map((item) => item.fragment.id))).toEqual(
      [["a", "b", "c"], ["d", "e", "g"]],
    );
    expect(rows[0]!.ratioSum).toBeCloseTo(1.33 + 1 + 2, 1);
    for (const row of rows) {
      expect(row.ratioSum).toBeGreaterThanOrEqual(
        row.items.reduce((sum, item) => sum + item.ratio, 0) - 1e-9,
      );
    }
  });

  it("pads a short last row to the target so one trailing image stays small", () => {
    const rows = justifiedRows(
      [fragment("only", "f", { width: 400, height: 300 })],
      RECENT_ROW_TARGET.comfortable,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ratioSum).toBe(RECENT_ROW_TARGET.comfortable);
  });

  it("takes an overflowing item when that lands closer to the target", () => {
    const rows = justifiedRows(
      [
        fragment("a", "f", { width: 600, height: 300 }), // 2
        fragment("b", "f", { width: 500, height: 300 }), // 1.67 -> 3.67 of 4
        fragment("c", "f", { width: 300, height: 300 }), // 1 -> 4.67 (closer than 3.67? no)
        fragment("d", "f", { width: 300, height: 300 }),
      ],
      4,
    );
    expect(rows[0]!.items.map((item) => item.fragment.id)).toEqual(["a", "b"]);
    expect(rows[1]!.items.map((item) => item.fragment.id)).toEqual(["c", "d"]);
    expect(justifiedRows([], 4)).toEqual([]);
  });

  it("gives every density a row target wider than the widest allowed image", () => {
    for (const target of Object.values(RECENT_ROW_TARGET)) {
      expect(target).toBeGreaterThan(2.4);
    }
  });
});

describe("first paint stagger", () => {
  it("steps by index and caps at eight slots", () => {
    expect(staggerIndex(0)).toBe(0);
    expect(staggerIndex(7)).toBe(STAGGER_CAP - 1);
    expect(staggerIndex(8)).toBe(STAGGER_CAP - 1);
    expect(staggerIndex(30)).toBe(STAGGER_CAP - 1);
    expect(staggerIndex(-1)).toBe(0);
  });
});

describe("empty Vault detection", () => {
  const inbox = { ...frame("inbox"), name: "Inbox" };

  it("is brand new only when nothing but Inbox exists and the snapshot arrived", () => {
    expect(
      isBrandNewVault({
        ready: true,
        frames: [inbox],
        fragments: [],
        systemFrameId: "inbox",
      }),
    ).toBe(true);
    expect(
      isBrandNewVault({ ready: false, frames: [], fragments: [], systemFrameId: "inbox" }),
    ).toBe(false);
    expect(
      isBrandNewVault({
        ready: true,
        frames: [inbox, frame("mine")],
        fragments: [],
        systemFrameId: "inbox",
      }),
    ).toBe(false);
    expect(
      isBrandNewVault({
        ready: true,
        frames: [inbox],
        fragments: [fragment("x", "inbox")],
        systemFrameId: "inbox",
      }),
    ).toBe(false);
    expect(
      isBrandNewVault({
        ready: true,
        frames: [inbox],
        fragments: [],
        systemFrameId: "inbox",
        searchQuery: "poster",
      }),
    ).toBe(false);
  });
});
