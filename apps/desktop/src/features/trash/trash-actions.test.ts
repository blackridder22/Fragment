import type { Frame } from "@fragment/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: unknown = null;
  },
  convertFileSrc: (path: string) => path,
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  deleteFragmentsForever,
  deleteFrameForever,
  emptyTrashNow,
  moveFragmentsBackToTrash,
  previewRestoredFrameName,
  restoreFragmentsNow,
  restoreFrameWithUniqueName,
  tauriTrashBackend,
} from "./trash-actions";

const invokeMock = vi.mocked(invoke);

function frame(id: string, name: string, parentId: string | null = null): Frame {
  return {
    id,
    parentId,
    name,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function commandsInvoked() {
  return invokeMock.mock.calls.map(([command]) => command);
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("restoring Fragments from the Trash page", () => {
  it("restores 50 of 1,000 trashed Fragments with exactly one invoke and no list reload", async () => {
    const trashed = Array.from({ length: 1_000 }, (_, index) => `fragment-${index}`);
    const selected = trashed.slice(200, 250);
    invokeMock.mockResolvedValueOnce(50);

    const restored = await restoreFragmentsNow(tauriTrashBackend, selected);

    expect(restored).toEqual(selected);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("restore_fragments", { ids: selected });
    expect(commandsInvoked()).not.toContain("list_fragment_page");
    expect(commandsInvoked()).not.toContain("load_library_snapshot");
  });

  it("deduplicates ids and skips demo rows without calling the backend", async () => {
    invokeMock.mockResolvedValueOnce(1);

    const restored = await restoreFragmentsNow(tauriTrashBackend, ["a", "a", "demo-1"]);

    expect(restored).toEqual(["a"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(await restoreFragmentsNow(tauriTrashBackend, ["demo-1"])).toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("restoring a Frame", () => {
  it("keeps the name and uses one invoke when nothing conflicts", async () => {
    const restored = frame("f1", "Posters");
    invokeMock.mockResolvedValueOnce(restored);

    const result = await restoreFrameWithUniqueName(tauriTrashBackend, restored, [
      frame("other", "Motion"),
    ]);

    expect(result).toEqual({ frame: restored, renamedFrom: null });
    expect(commandsInvoked()).toEqual(["restore_frame"]);
  });

  it("renames to the resolved name when an active sibling has the same name", async () => {
    const restored = frame("f1", "Posters");
    const renamed = frame("f1", "Posters 2");
    invokeMock.mockResolvedValueOnce(restored).mockResolvedValueOnce(renamed);

    const result = await restoreFrameWithUniqueName(tauriTrashBackend, restored, [
      frame("existing", "posters"),
      frame("nested", "Posters", "someone-else"),
    ]);

    expect(result).toEqual({ frame: renamed, renamedFrom: "Posters" });
    expect(commandsInvoked()).toEqual(["restore_frame", "rename_frame"]);
    expect(invokeMock).toHaveBeenLastCalledWith("rename_frame", {
      id: "f1",
      name: "Posters 2",
    });
    expect(previewRestoredFrameName(restored, [frame("existing", "Posters")])).toBe(
      "Posters 2",
    );
    expect(previewRestoredFrameName(restored, [])).toBeNull();
  });

  it("keeps the restore when the rename fails", async () => {
    const restored = frame("f1", "Posters");
    invokeMock
      .mockResolvedValueOnce(restored)
      .mockRejectedValueOnce(new Error("rename failed"));

    const result = await restoreFrameWithUniqueName(tauriTrashBackend, restored, [
      frame("existing", "Posters"),
    ]);

    expect(result).toEqual({ frame: restored, renamedFrom: null });
  });
});

describe("deleting now and emptying", () => {
  it("hard deletes selected Fragments with one invoke", async () => {
    invokeMock.mockResolvedValueOnce(3);

    await deleteFragmentsForever(tauriTrashBackend, ["a", "b", "c"]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("delete_fragments", {
      ids: ["a", "b", "c"],
      retentionDays: null,
    });
  });

  it("hard deletes a Frame through the dedicated command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteFrameForever(tauriTrashBackend, "f1");

    expect(invokeMock).toHaveBeenCalledWith("hard_delete_frame", { id: "f1" });
  });

  it("summarizes what Empty Trash removed", async () => {
    invokeMock.mockResolvedValueOnce({
      fragments: 120,
      frames: 4,
      assets: 90,
      cleanup: { removed: 90, deferred: 0 },
    });

    expect(await emptyTrashNow(tauriTrashBackend)).toEqual({
      fragments: 120,
      frames: 4,
    });
  });
});

describe("undoing a restore", () => {
  it("moves the rows back to Trash under the current retention", async () => {
    invokeMock.mockResolvedValueOnce(2);

    await moveFragmentsBackToTrash(tauriTrashBackend, ["a", "b"], {
      kind: "days",
      days: 14,
    });

    expect(invokeMock).toHaveBeenCalledWith("delete_fragments", {
      ids: ["a", "b"],
      retentionDays: 14,
    });
  });

  it("refuses when retention is off so Undo can never delete forever", async () => {
    await expect(
      moveFragmentsBackToTrash(tauriTrashBackend, ["a"], { kind: "forever" }),
    ).rejects.toThrow(/Retention is off/);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
