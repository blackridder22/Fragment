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
import { DAY_MS } from "./retention";
import {
  deleteFragmentsForever,
  deleteFrameForever,
  deleteFramesForever,
  emptyTrashNow,
  moveFragmentsBackToTrash,
  moveFrameBackToTrash,
  previewRestoredFrameName,
  restoreFragmentsNow,
  restoreFramesWithUniqueNames,
  restoreFrameWithUniqueName,
  tauriTrashBackend,
} from "./trash-actions";

const invokeMock = vi.mocked(invoke);
const now = new Date("2026-10-04T12:00:00.000Z");

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

describe("restoring several Frames together", () => {
  it("accumulates the names, so two same-named Frames do not collide with each other", async () => {
    const first = frame("f1", "Posters");
    const second = frame("f2", "Posters");
    invokeMock.mockImplementation(async (command, args) => {
      const payload = args as { id: string; name?: string };
      if (command === "restore_frame") return payload.id === "f1" ? first : second;
      if (command === "rename_frame") {
        return { ...(payload.id === "f1" ? first : second), name: payload.name };
      }
      throw new Error(`unexpected ${command}`);
    });

    const report = await restoreFramesWithUniqueNames(
      tauriTrashBackend,
      [first, second],
      [frame("existing", "Posters")],
    );

    expect(report.failed).toEqual([]);
    expect(report.restored.map((item) => item.frame.name)).toEqual([
      "Posters 2",
      "Posters 3",
    ]);
    expect(commandsInvoked()).toEqual([
      "restore_frame",
      "rename_frame",
      "restore_frame",
      "rename_frame",
    ]);
  });

  it("reports a failed Frame and still restores the rest", async () => {
    const ok = frame("ok", "Motion");
    invokeMock.mockImplementation(async (command, args) => {
      const payload = args as { id: string };
      if (command === "restore_frame" && payload.id === "bad") {
        throw new Error("restore the parent Frame first");
      }
      return ok;
    });

    const report = await restoreFramesWithUniqueNames(
      tauriTrashBackend,
      [frame("bad", "Nested", "gone"), ok],
      [],
    );

    expect(report.restored.map((item) => item.frame.id)).toEqual(["ok"]);
    expect(report.failed).toEqual([
      { frame: frame("bad", "Nested", "gone"), message: "restore the parent Frame first" },
    ]);
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

  it("hard deletes Frames one by one and reports the failures", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      if ((args as { id: string }).id === "locked") throw new Error("busy");
      return undefined;
    });

    const report = await deleteFramesForever(tauriTrashBackend, [
      frame("a", "A"),
      frame("locked", "Locked"),
      frame("b", "B"),
    ]);

    expect(report.deleted.map((item) => item.id)).toEqual(["a", "b"]);
    expect(report.failed).toEqual([{ frame: frame("locked", "Locked"), message: "busy" }]);
    expect(commandsInvoked()).toEqual(["hard_delete_frame", "hard_delete_frame", "hard_delete_frame"]);
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
  it("moves the rows back with the days they had left, one call per distinct window", async () => {
    invokeMock.mockResolvedValue(1);
    const inFiveDays = new Date(now.getTime() + 5 * DAY_MS - 60_000).toISOString();
    const inTwelveDays = new Date(now.getTime() + 12 * DAY_MS - 60_000).toISOString();

    const ids = await moveFragmentsBackToTrash(
      tauriTrashBackend,
      [
        { id: "a", deleteAfter: inFiveDays },
        { id: "b", deleteAfter: inTwelveDays },
        { id: "c", deleteAfter: inFiveDays },
        { id: "d", deleteAfter: null },
        { id: "a", deleteAfter: inFiveDays },
        { id: "demo-1", deleteAfter: null },
      ],
      { kind: "days", days: 14 },
      now,
    );

    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(invokeMock.mock.calls).toEqual([
      ["delete_fragments", { ids: ["a", "c"], retentionDays: 5 }],
      ["delete_fragments", { ids: ["b"], retentionDays: 12 }],
      ["delete_fragments", { ids: ["d"], retentionDays: 14 }],
    ]);
  });

  it("gives a renamed Frame its name back before re-trashing it with its window", async () => {
    const restored = frame("f1", "Posters 2");
    invokeMock.mockResolvedValue(restored);
    const inThreeDays = new Date(now.getTime() + 3 * DAY_MS - 60_000).toISOString();

    await moveFrameBackToTrash(
      tauriTrashBackend,
      { frame: restored, renamedFrom: "Posters", deleteAfter: inThreeDays },
      { kind: "days", days: 31 },
      now,
    );

    expect(invokeMock.mock.calls).toEqual([
      ["rename_frame", { id: "f1", name: "Posters" }],
      ["delete_frame", { id: "f1", retentionDays: 3 }],
    ]);
  });

  it("refuses when retention is off so Undo can never delete forever", async () => {
    await expect(
      moveFragmentsBackToTrash(tauriTrashBackend, [{ id: "a", deleteAfter: null }], {
        kind: "forever",
      }),
    ).rejects.toThrow(/Retention is off/);
    await expect(
      moveFrameBackToTrash(
        tauriTrashBackend,
        { frame: frame("f1", "Posters"), renamedFrom: null, deleteAfter: null },
        { kind: "forever" },
      ),
    ).rejects.toThrow(/Retention is off/);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
