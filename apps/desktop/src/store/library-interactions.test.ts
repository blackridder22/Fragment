import type { Fragment, Frame } from "@fragment/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let failPageRequests = false;
function count(name: string) {
  return calls.filter((call) => call === name).length;
}

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
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
const FRAMES = [frame("inbox", "Inbox"), frame("posters", "Posters")];
const ROOT_ITEMS = [
  fragment("a", "inbox"),
  fragment("b", "posters"),
  fragment("c", "posters"),
];

vi.mock("../lib/tauri", () => {
  const record = (name: string) => calls.push(name);
  return {
    isTauriRuntime: () => true,
    assetUrl: (root: string, path: string) => `${root}/${path}`,
    loadLibrarySnapshot: async () => {
      record("load_library_snapshot");
      return {
        defaultFrame: FRAMES[0],
        frames: FRAMES,
        fragments: ROOT_ITEMS,
        fragmentTotal: 3,
        trashTotal: 0,
        frameCounts: { inbox: 1, posters: 2 },
        revision: "r1",
        assetRoot: "/vault",
      };
    },
    listSmartFrames: async () => {
      record("list_smart_frames");
      return [];
    },
    listTags: async () => {
      record("list_tags");
      return ["poster"];
    },
    listFragmentPage: async (options: {
      frameId?: string | null;
      trashed?: boolean;
    }) => {
      record("list_fragment_page");
      if (failPageRequests) throw new Error("disk gone");
      const items = options.trashed
        ? []
        : ROOT_ITEMS.filter(
            (item) => !options.frameId || item.frameId === options.frameId,
          );
      return {
        items,
        offset: 0,
        limit: 60,
        total: items.length,
        hasMore: false,
        revision: "r1",
        paletteRevision: null,
      };
    },
    listTrashedFrames: async () => {
      record("list_trashed_frames");
      return [];
    },
    getFragmentTags: async () => {
      record("get_fragment_tags");
      return ["poster"];
    },
    setPalettePriority: async () => {
      record("set_palette_priority");
    },
    getLibraryRevision: async () => {
      record("get_library_revision");
      return "r1";
    },
    deleteFragments: async (ids: string[]) => {
      record("delete_fragments");
      return ids.length;
    },
    restoreFragments: async (ids: string[]) => {
      record("restore_fragments");
      return ids.length;
    },
    renameFrame: async (id: string, name: string) => {
      record("rename_frame");
      return { ...FRAMES.find((item) => item.id === id)!, name };
    },
    moveFragmentToFrame: async (id: string, frameId: string) => {
      record("move_fragment_to_frame");
      return { ...ROOT_ITEMS.find((item) => item.id === id)!, frameId };
    },
    setFragmentTags: async (_id: string, tags: string[]) => {
      record("set_fragment_tags");
      return tags;
    },
    nativeHostStatus: async () => ({ ready: true, label: "Ready" }),
  };
});

import { libraryStore, resetLibraryStore } from "./library-store";
import {
  refreshSnapshot,
  subscribeLibrarySideEffects,
} from "./library-bootstrap";
import { libraryLoader } from "./library-loader";
import {
  applyFragmentFilter,
  changeView,
  openFragmentPreview,
  retryPage,
  selectFrame,
  setSortMode,
  setSourceFilter,
} from "./library-actions";
import {
  moveFragmentToFrameAction,
  moveFragmentsToTrash,
  saveFocusedTags,
} from "./library-fragments";
import { renameFrameAction } from "./library-frames";
import { undoLastAction } from "./library-undo";
import { selectActiveCards, selectSelectedIds } from "./library-selectors";

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe("invoke counts per interaction", () => {
  let dispose: () => void;

  beforeEach(async () => {
    calls.length = 0;
    failPageRequests = false;
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
  });

  afterEach(() => {
    dispose();
  });

  it("boots with one snapshot round-trip and no duplicate first page", () => {
    expect(count("load_library_snapshot")).toBe(1);
    expect(count("list_smart_frames")).toBe(1);
    expect(count("list_tags")).toBe(1);
    expect(count("list_fragment_page")).toBe(0);
    expect(libraryStore.getState().activePage.items).toHaveLength(3);
    expect(selectActiveCards(libraryStore.getState())).toHaveLength(3);
  });

  it("switch view: at most 1 page request (0 when the key is unchanged)", async () => {
    calls.length = 0;
    changeView("frames");
    await flush();
    expect(count("list_fragment_page")).toBe(0);
    changeView("trash");
    await flush();
    expect(count("list_fragment_page")).toBe(1);
    expect(count("list_trashed_frames")).toBe(1);
    expect(calls.filter((call) => call !== "list_trashed_frames")).toHaveLength(
      1,
    );
  });

  it("select Frame: exactly 1 invoke", async () => {
    calls.length = 0;
    selectFrame("posters");
    await flush();
    expect(calls).toEqual(["list_fragment_page"]);
    expect(
      libraryStore.getState().activePage.items.map((item) => item.id),
    ).toEqual(["b", "c"]);
  });

  it("failed page: no auto-retry on unrelated changes, 1 invoke on retryPage", async () => {
    failPageRequests = true;
    calls.length = 0;
    selectFrame("posters");
    await flush();
    expect(calls).toEqual(["list_fragment_page"]);
    expect(libraryStore.getState().activePage.error).toBe("disk gone");

    libraryStore.setState({ error: null, shortcutsOpen: true });
    openFragmentPreview(ROOT_ITEMS[0]!);
    await flush();
    expect(count("list_fragment_page")).toBe(1);
    expect(libraryStore.getState().error).toBeNull();

    failPageRequests = false;
    calls.length = 0;
    await retryPage();
    expect(calls).toEqual(["list_fragment_page"]);
    expect(libraryStore.getState().activePage.error).toBeNull();
    expect(
      libraryStore.getState().activePage.items.map((item) => item.id),
    ).toEqual(["b", "c"]);
  });

  it("filter pill and sort: exactly 1 invoke each", async () => {
    calls.length = 0;
    applyFragmentFilter({ tags: ["poster"], mimeTypes: [] });
    await flush();
    expect(calls).toEqual(["list_fragment_page"]);
    calls.length = 0;
    setSourceFilter("local");
    await flush();
    expect(calls).toEqual(["list_fragment_page"]);
    calls.length = 0;
    setSortMode("name");
    await flush();
    expect(calls).toEqual(["list_fragment_page"]);
  });

  it("open preview: tags once, no duplicate tag fetch, at most 3 invokes", async () => {
    calls.length = 0;
    const item = libraryStore.getState().activePage.items[0]!;
    openFragmentPreview(item);
    await flush();
    expect(count("get_fragment_tags")).toBe(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    openFragmentPreview(item);
    await flush();
    expect(count("get_fragment_tags")).toBe(1);
    expect(libraryStore.getState().fragmentTagsById[item.id]).toEqual([
      "poster",
    ]);
  });

  it("rename, move and tag patch the store without a snapshot reload", async () => {
    calls.length = 0;
    await renameFrameAction(FRAMES[1]!, "Print");
    expect(calls).toEqual(["rename_frame"]);
    expect(
      libraryStore.getState().frames.find((f) => f.id === "posters")?.name,
    ).toBe("Print");
    expect(selectActiveCards(libraryStore.getState())[1]?.folderName).toBe(
      "Print",
    );

    calls.length = 0;
    const moved = libraryStore.getState().activePage.items[0]!;
    await moveFragmentToFrameAction(moved, "posters");
    await flush();
    expect(calls.filter((c) => c !== "list_fragment_page")).toEqual([
      "move_fragment_to_frame",
    ]);
    expect(libraryStore.getState().frameCounts).toEqual({
      inbox: 0,
      posters: 3,
    });

    calls.length = 0;
    await saveFocusedTags(moved, ["poster", "red"]);
    expect(calls).toEqual(["set_fragment_tags", "list_tags"]);
    expect(libraryStore.getState().fragmentTagsById[moved.id]).toEqual([
      "poster",
      "red",
    ]);
    expect(libraryStore.getState().toast?.message).toBe("Tags saved");
  });

  it("move to Trash patches the page and Undo restores the items in place", async () => {
    calls.length = 0;
    const before = libraryStore
      .getState()
      .activePage.items.map((item) => item.id);
    await moveFragmentsToTrash(["b"]);
    expect(calls).toEqual(["delete_fragments"]);
    const trashed = libraryStore.getState();
    expect(trashed.activePage.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(trashed.activePage.total).toBe(2);
    expect(trashed.trashTotal).toBe(1);
    expect(trashed.frameCounts.posters).toBe(1);
    expect(trashed.toast?.message).toBe("1 Fragment moved to Trash");
    expect(trashed.toast?.action?.label).toBe("Undo");
    expect(selectSelectedIds(trashed)).toEqual([]);

    calls.length = 0;
    await undoLastAction();
    expect(calls).toEqual(["restore_fragments"]);
    const restored = libraryStore.getState();
    expect(restored.activePage.items.map((item) => item.id)).toEqual(before);
    expect(restored.activePage.total).toBe(3);
    expect(restored.trashTotal).toBe(0);
    expect(restored.frameCounts.posters).toBe(2);
    expect(restored.toast?.message).toBe("Restored 1 Fragment");
    expect(restored.undo).toBeNull();
  });
});
