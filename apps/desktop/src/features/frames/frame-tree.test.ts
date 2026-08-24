import type { Frame } from "@fragment/shared";
import { describe, expect, it } from "vitest";
import {
  aggregateFrameCounts,
  descendantFrameIds,
  flattenFrameTree,
  frameBreadcrumbs,
  parseFrameNavigatorPreferences,
  resolveFrameDrop,
} from "./frame-tree";

const frames = [
  frame("inbox", "Inbox", null, 0),
  frame("work", "Work", null, 1),
  frame("identity", "Identity", "work", 0),
  frame("logos", "Logos", "identity", 0),
  frame("editorial", "Editorial", "work", 1),
  frame("personal", "Personal", null, 2),
];

describe("Frame tree model", () => {
  it("flattens expanded branches in visual order", () => {
    expect(
      flattenFrameTree(frames, new Set(["work", "identity"])).map(
        ({ frame, depth }) => `${depth}:${frame.id}`,
      ),
    ).toEqual([
      "0:inbox",
      "0:work",
      "1:identity",
      "2:logos",
      "1:editorial",
      "0:personal",
    ]);
  });

  it("keeps matching Frames and their ancestors visible during search", () => {
    const rows = flattenFrameTree(frames, new Set(), "logo");
    expect(rows.map(({ frame }) => frame.id)).toEqual([
      "work",
      "identity",
      "logos",
    ]);
    expect(rows.map(({ matchesQuery }) => matchesQuery)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("resolves descendants, breadcrumbs, and recursive counts", () => {
    expect(descendantFrameIds(frames, "work")).toEqual([
      "work",
      "identity",
      "logos",
      "editorial",
    ]);
    expect(frameBreadcrumbs(frames, "logos").map((item) => item.name)).toEqual([
      "Work",
      "Identity",
      "Logos",
    ]);
    const totals = aggregateFrameCounts(
      frames,
      new Map([
        ["work", 2],
        ["identity", 3],
        ["logos", 4],
        ["editorial", 5],
      ]),
    );
    expect(totals.get("identity")).toBe(7);
    expect(totals.get("work")).toBe(14);
  });

  it("computes reorder and reparent placements while rejecting cycles", () => {
    expect(
      resolveFrameDrop(frames, "personal", {
        kind: "inside",
        frameId: "work",
      }),
    ).toEqual({ parentId: "work", position: 2 });
    expect(
      resolveFrameDrop(frames, "editorial", {
        kind: "before",
        frameId: "identity",
      }),
    ).toEqual({ parentId: "work", position: 0 });
    expect(
      resolveFrameDrop(frames, "work", {
        kind: "inside",
        frameId: "logos",
      }),
    ).toBeNull();
  });

  it("sanitizes persisted navigator preferences", () => {
    expect(
      parseFrameNavigatorPreferences(
        JSON.stringify({
          collapsed: true,
          width: 900,
          expandedIds: ["work", "work", 3],
          pinnedIds: ["logos"],
          includeDescendants: true,
        }),
      ),
    ).toEqual({
      collapsed: true,
      width: 380,
      expandedIds: ["work"],
      pinnedIds: ["logos"],
      includeDescendants: true,
    });
    expect(parseFrameNavigatorPreferences("not json").width).toBe(240);
  });
});

function frame(
  id: string,
  name: string,
  parentId: string | null,
  sortOrder: number,
): Frame {
  return {
    id,
    name,
    parentId,
    sortOrder,
    createdAt: `2026-08-01T00:00:0${sortOrder}Z`,
    updatedAt: "2026-08-01T00:00:00Z",
  };
}
