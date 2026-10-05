import { describe, expect, it } from "vitest";
import {
  createPreviewTrashState,
  movePreviewItemsToTrash,
  previewIdsAtLocation,
  purgePreviewItems,
  purgePreviewTrash,
  restorePreviewItems,
} from "./preview-trash-state";

const ids = ["demo-a", "demo-b", "demo-c"];

describe("preview Trash state", () => {
  it("moves each item from active to Trash exactly once", () => {
    const moved = movePreviewItemsToTrash(createPreviewTrashState(), [
      "demo-a",
      "demo-b",
      "demo-a",
    ]);

    expect(previewIdsAtLocation(ids, moved, "active")).toEqual(["demo-c"]);
    expect(previewIdsAtLocation(ids, moved, "trashed")).toEqual([
      "demo-a",
      "demo-b",
    ]);
    expect(previewIdsAtLocation(ids, moved, "purged")).toEqual([]);
  });

  it("restores trashed items to active without leaving Trash copies", () => {
    const moved = movePreviewItemsToTrash(createPreviewTrashState(), [
      "demo-a",
      "demo-b",
    ]);
    const restored = restorePreviewItems(moved, ["demo-a", "demo-b"]);

    expect(previewIdsAtLocation(ids, restored, "active")).toEqual(ids);
    expect(previewIdsAtLocation(ids, restored, "trashed")).toEqual([]);
  });

  it("deletes selected trashed items now and leaves the rest recoverable", () => {
    const moved = movePreviewItemsToTrash(createPreviewTrashState(), [
      "demo-a",
      "demo-b",
    ]);
    const purged = purgePreviewItems(moved, ["demo-a", "demo-c"]);

    expect(previewIdsAtLocation(ids, purged, "purged")).toEqual(["demo-a"]);
    expect(previewIdsAtLocation(ids, purged, "trashed")).toEqual(["demo-b"]);
    expect(previewIdsAtLocation(ids, purged, "active")).toEqual(["demo-c"]);
    expect(purgePreviewItems(purged, ["demo-c"])).toBe(purged);
  });

  it("purges Trash without allowing restore or a later move to revive items", () => {
    const moved = movePreviewItemsToTrash(createPreviewTrashState(), [
      "demo-a",
    ]);
    const purged = purgePreviewTrash(moved);
    const restoreAttempt = restorePreviewItems(purged, ["demo-a"]);
    const moveAttempt = movePreviewItemsToTrash(restoreAttempt, ["demo-a"]);

    expect(previewIdsAtLocation(ids, moveAttempt, "active")).toEqual([
      "demo-b",
      "demo-c",
    ]);
    expect(previewIdsAtLocation(ids, moveAttempt, "trashed")).toEqual([]);
    expect(previewIdsAtLocation(ids, moveAttempt, "purged")).toEqual([
      "demo-a",
    ]);
  });
});
