import { describe, expect, it } from "vitest";
import {
  createPreviewTrashState,
  movePreviewItemsToTrash,
  previewIdsAtLocation,
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
