import type { Fragment, Frame } from "@fragment/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Drives the real store, loader and side-effect subscriber against a small
 * in-memory backend so each Trash action can be checked for what it invokes
 * and how it patches the loaded Trash page, the totals and the revision.
 */

const calls: string[] = [];
function count(name: string) {
  return calls.filter((call) => call === name).length;
}

const now = "2026-10-04T00:00:00.000Z";
function frame(id: string, name: string, parentId: string | null = null): Frame {
  return { id, parentId, name, sortOrder: 0, createdAt: now, updatedAt: now };
}
function fragment(id: string, frameId: string): Fragment {
  return {
    id,
    frameId,
    title: id,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
    deleteAfter: "2026-11-04T00:00:00.000Z",
  };
}

type Backend = {
  revision: number;
  activeFrames: Frame[];
  /** Trashed tree roots, as `list_trashed_frames` returns them. */
  trashedRoots: Frame[];
  /** Trashed descendants: never listed, but hard-deleted with their root. */
  trashedDescendants: Frame[];
  trashedFragments: Fragment[];
  activeFragments: Fragment[];
  failRestoreFrame: Set<string>;
};
const backend: Backend = {
  revision: 1,
  activeFrames: [],
  trashedRoots: [],
  trashedDescendants: [],
  trashedFragments: [],
  activeFragments: [],
  failRestoreFrame: new Set(),
};

function resetBackend() {
  backend.revision = 1;
  backend.activeFrames = [frame("inbox", "Inbox"), frame("posters", "Posters")];
  // "attic" is a trashed root whose trashed child "attic-box" holds a Fragment
  // that was trashed on its own; the other trashed Fragment lives in Posters.
  backend.trashedRoots = [frame("attic", "Attic")];
  backend.trashedDescendants = [frame("attic-box", "Box", "attic")];
  backend.trashedFragments = [fragment("t1", "attic-box"), fragment("t2", "posters")];
  backend.activeFragments = [];
  backend.failRestoreFrame = new Set();
}

function treeOf(rootId: string) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of [...backend.trashedDescendants, ...backend.activeFrames]) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

vi.mock("../lib/tauri", () => {
  const record = (name: string) => calls.push(name);
  const write = () => {
    backend.revision += 1;
  };
  return {
    isTauriRuntime: () => true,
    assetUrl: (root: string, path: string) => `${root}/${path}`,
    loadLibrarySnapshot: async () => {
      record("load_library_snapshot");
      const frameCounts: Record<string, number> = {};
      for (const item of backend.activeFrames) frameCounts[item.id] = 0;
      for (const item of backend.activeFragments) {
        frameCounts[item.frameId] = (frameCounts[item.frameId] ?? 0) + 1;
      }
      return {
        defaultFrame: backend.activeFrames[0],
        frames: backend.activeFrames,
        fragments: backend.activeFragments,
        fragmentTotal: backend.activeFragments.length,
        trashTotal: backend.trashedFragments.length,
        frameCounts,
        revision: `r${backend.revision}`,
        assetRoot: "/vault",
      };
    },
    listSmartFrames: async () => {
      record("list_smart_frames");
      return [];
    },
    listTags: async () => {
      record("list_tags");
      return [];
    },
    listFragmentPage: async (options: { trashed?: boolean }) => {
      record(options.trashed ? "list_fragment_page:trashed" : "list_fragment_page");
      const items = options.trashed ? backend.trashedFragments : backend.activeFragments;
      return {
        items: [...items],
        offset: 0,
        limit: 60,
        total: items.length,
        hasMore: false,
        revision: `r${backend.revision}`,
        paletteRevision: null,
      };
    },
    listTrashedFrames: async () => {
      record("list_trashed_frames");
      return [...backend.trashedRoots];
    },
    listFragmentIds: async () => {
      record("list_fragment_ids");
      return backend.trashedFragments.map((item) => item.id);
    },
    getLibraryRevision: async () => {
      record("get_library_revision");
      return `r${backend.revision}`;
    },
    restoreFragments: async (ids: string[]) => {
      record("restore_fragments");
      write();
      const restored = backend.trashedFragments.filter((item) => ids.includes(item.id));
      backend.trashedFragments = backend.trashedFragments.filter(
        (item) => !ids.includes(item.id),
      );
      backend.activeFragments.push(...restored);
      return restored.length;
    },
    deleteFragments: async (ids: string[]) => {
      record("delete_fragments");
      write();
      backend.trashedFragments = backend.trashedFragments.filter(
        (item) => !ids.includes(item.id),
      );
      return ids.length;
    },
    deleteFrame: async (id: string, retentionDays: number | null) => {
      record(retentionDays === null ? "hard_delete_frame" : "delete_frame");
      write();
      const tree = treeOf(id);
      backend.trashedRoots = backend.trashedRoots.filter((item) => !tree.has(item.id));
      backend.trashedDescendants = backend.trashedDescendants.filter(
        (item) => !tree.has(item.id),
      );
      if (retentionDays === null) {
        backend.trashedFragments = backend.trashedFragments.filter(
          (item) => !tree.has(item.frameId),
        );
      } else {
        const moved = backend.activeFrames.filter((item) => tree.has(item.id));
        backend.activeFrames = backend.activeFrames.filter((item) => !tree.has(item.id));
        backend.trashedRoots.push(...moved.filter((item) => item.id === id));
        backend.trashedDescendants.push(...moved.filter((item) => item.id !== id));
      }
    },
    restoreFrame: async (id: string) => {
      record("restore_frame");
      if (backend.failRestoreFrame.has(id)) throw new Error("restore the parent Frame first");
      write();
      const root = backend.trashedRoots.find((item) => item.id === id)!;
      backend.trashedRoots = backend.trashedRoots.filter((item) => item.id !== id);
      backend.activeFrames.push(root);
      return root;
    },
    renameFrame: async (id: string, name: string) => {
      record("rename_frame");
      write();
      backend.activeFrames = backend.activeFrames.map((item) =>
        item.id === id ? { ...item, name } : item,
      );
      return backend.activeFrames.find((item) => item.id === id)!;
    },
    emptyTrash: async () => {
      record("empty_trash");
      write();
      const report = {
        fragments: backend.trashedFragments.length,
        frames: backend.trashedRoots.length,
        assets: 0,
        cleanup: { removed: 0, deferred: 0 },
      };
      backend.trashedFragments = [];
      backend.trashedRoots = [];
      backend.trashedDescendants = [];
      return report;
    },
    setPalettePriority: async () => {
      record("set_palette_priority");
    },
    nativeHostStatus: async () => ({ ready: true, label: "Ready" }),
  };
});

import { resetTrashSession, getTrashSessionSnapshot } from "../features/trash/trash-session";
import { changeView } from "./library-actions";
import { refreshSnapshot, subscribeLibrarySideEffects } from "./library-bootstrap";
import { moveFragmentsToTrash } from "./library-fragments";
import { libraryLoader } from "./library-loader";
import { libraryStore, resetLibraryStore } from "./library-store";
import {
  deleteTrashedFragmentsNow,
  deleteTrashedFramesNow,
  emptyTrashAction,
  notifyFromTrash,
  restoreTrashedFragments,
  restoreTrashedFrames,
  retrashFragments,
} from "./library-trash";
import { undoLastAction } from "./library-undo";

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("Trash page actions", () => {
  let dispose: () => void;

  beforeEach(async () => {
    calls.length = 0;
    resetBackend();
    resetTrashSession();
    resetLibraryStore(
      {},
      { storage: null, previewMode: false, systemPrefersDark: false },
    );
    const stopEffects = subscribeLibrarySideEffects();
    const stopLoader = libraryLoader.start();
    dispose = () => {
      stopLoader();
      stopEffects();
    };
    await refreshSnapshot();
    await flush();
    changeView("trash");
    await flush();
    calls.length = 0;
  });

  afterEach(() => {
    dispose();
  });

  it("lists the Trash once on entry and counts Frames only after that listing", () => {
    const state = libraryStore.getState();
    expect(state.trashPage.items.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(state.trashedFrames.map((item) => item.id)).toEqual(["attic"]);
    expect(state.trashedFramesLoaded).toBe(true);
    expect(state.trashTotal).toBe(2);
  });

  it("restores Fragments with one call, patches once and remembers the revision", async () => {
    await restoreTrashedFragments(["t2"]);
    await flush();

    expect(calls).toEqual(["restore_fragments", "get_library_revision"]);
    const state = libraryStore.getState();
    expect(state.trashPage.items.map((item) => item.id)).toEqual(["t1"]);
    expect(state.trashPage.total).toBe(1);
    expect(state.trashTotal).toBe(1);
    expect(state.frameCounts.posters).toBe(1);
    // The next focus check compares against the revision our write produced.
    expect(state.revision).toBe(`r${backend.revision}`);
  });

  it("Restore all takes the unloaded rows' counts from one snapshot", async () => {
    libraryStore.setState((state) => ({
      trashPage: { ...state.trashPage, items: state.trashPage.items.slice(0, 1), hasMore: true },
    }));
    await restoreTrashedFragments(["t1", "t2"]);
    await flush();

    expect(count("restore_fragments")).toBe(1);
    expect(count("load_library_snapshot")).toBe(1);
    const state = libraryStore.getState();
    expect(state.trashTotal).toBe(0);
    expect(state.frameCounts.posters).toBe(1);
    expect(state.revision).toBe(`r${backend.revision}`);
  });

  it("Delete now on Fragments patches the page once and remembers the revision", async () => {
    await deleteTrashedFragmentsNow(["t1"]);
    await flush();

    expect(calls).toEqual(["delete_fragments", "get_library_revision"]);
    const state = libraryStore.getState();
    expect(state.trashPage.items.map((item) => item.id)).toEqual(["t2"]);
    expect(state.trashTotal).toBe(1);
    expect(state.revision).toBe(`r${backend.revision}`);
  });

  it("Delete now on a Frame also drops the tree's individually trashed Fragments and fixes the total", async () => {
    const attic = libraryStore.getState().trashedFrames[0]!;
    const report = await deleteTrashedFramesNow([attic]);
    await flush();

    expect(report).toEqual({ deleted: [attic], failed: [] });
    expect(count("hard_delete_frame")).toBe(1);
    expect(count("load_library_snapshot")).toBe(1);
    expect(count("list_fragment_page:trashed")).toBe(1);
    const state = libraryStore.getState();
    expect(state.trashedFrames).toEqual([]);
    // t1 lived in the deleted tree's hidden child and is gone with it.
    expect(state.trashPage.items.map((item) => item.id)).toEqual(["t2"]);
    expect(state.trashPage.total).toBe(1);
    expect(state.trashTotal).toBe(1);
    expect(state.revision).toBe(`r${backend.revision}`);
  });

  it("restores several Frames with one snapshot at the end and accumulating names", async () => {
    backend.trashedRoots = [frame("p1", "Posters"), frame("p2", "Posters")];
    await libraryLoader.reload("trash");
    await flush();
    calls.length = 0;

    const report = await restoreTrashedFrames(libraryStore.getState().trashedFrames);
    await flush();

    expect(report.failed).toEqual([]);
    expect(report.restored.map((item) => item.frame.name)).toEqual(["Posters 2", "Posters 3"]);
    expect(count("restore_frame")).toBe(2);
    expect(count("rename_frame")).toBe(2);
    expect(count("load_library_snapshot")).toBe(1);
    const state = libraryStore.getState();
    expect(state.trashedFrames).toEqual([]);
    expect(state.frames.map((item) => item.name)).toEqual([
      "Inbox",
      "Posters",
      "Posters 2",
      "Posters 3",
    ]);
  });

  it("reports a failed Frame restore without throwing and keeps it in the Trash", async () => {
    backend.trashedRoots = [frame("ok", "Motion"), frame("bad", "Nested")];
    backend.failRestoreFrame.add("bad");
    await libraryLoader.reload("trash");
    await flush();
    calls.length = 0;

    const report = await restoreTrashedFrames(libraryStore.getState().trashedFrames);
    await flush();

    expect(report.restored.map((item) => item.frame.id)).toEqual(["ok"]);
    expect(report.failed.map((item) => item.frame.id)).toEqual(["bad"]);
    expect(libraryStore.getState().trashedFrames.map((item) => item.id)).toEqual(["bad"]);
    expect(count("load_library_snapshot")).toBe(1);
  });

  it("Empty Trash clears everything locally and reports what the backend removed", async () => {
    const summary = await emptyTrashAction();
    await flush();

    expect(summary).toEqual({ fragments: 2, frames: 1 });
    expect(calls).toEqual(["empty_trash", "get_library_revision"]);
    const state = libraryStore.getState();
    expect(state.trashPage.items).toEqual([]);
    expect(state.trashedFrames).toEqual([]);
    expect(state.trashTotal).toBe(0);
    expect(state.revision).toBe(`r${backend.revision}`);
  });

  it("Undo of a restore re-trashes through the shared toast with the days the row had left", async () => {
    await restoreTrashedFragments(["t2"]);
    const inFiveDays = new Date(Date.now() + 5 * 86_400_000 - 60_000).toISOString();
    notifyFromTrash({
      label: "Restored 1 Fragment",
      undo: {
        doneLabel: "Moved 1 Fragment back to Trash",
        run: () => retrashFragments([{ id: "t2", deleteAfter: inFiveDays }]),
      },
    });
    const state = libraryStore.getState();
    expect(state.toast?.message).toBe("Restored 1 Fragment");
    expect(state.toast?.action?.label).toBe("Undo");
    expect(state.undo?.kind).toBe("custom");

    calls.length = 0;
    await undoLastAction();
    await flush();

    expect(count("delete_fragments")).toBe(1);
    expect(count("load_library_snapshot")).toBe(1);
    expect(libraryStore.getState().toast?.message).toBe("Moved 1 Fragment back to Trash");
    expect(libraryStore.getState().undo).toBeNull();
  });

  it("does not pulse the Empty Trash button when the Trash held only Frames at launch", async () => {
    // Launch again with a Frames-only Trash, then open the Trash page.
    dispose();
    backend.trashedFragments = [];
    resetTrashSession();
    resetLibraryStore({}, { storage: null, previewMode: false, systemPrefersDark: false });
    const stopEffects = subscribeLibrarySideEffects();
    const stopLoader = libraryLoader.start();
    dispose = () => {
      stopLoader();
      stopEffects();
    };
    await refreshSnapshot();
    await flush();
    expect(libraryStore.getState().trashTotal).toBe(0);
    changeView("trash");
    await flush();
    expect(libraryStore.getState().trashedFrames).toHaveLength(1);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);

    // A Fragment landing in a Trash that already held a Frame is not "first non-empty" either.
    changeView("home");
    backend.activeFragments = [fragment("live", "posters")];
    libraryStore.setState((state) => ({
      activePage: { ...state.activePage, items: backend.activeFragments, total: 1 },
    }));
    await moveFragmentsToTrash(["live"]);
    await flush();
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
  });
});
