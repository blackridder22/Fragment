import type { Fragment, Frame } from "@fragment/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

type Preview = { frameId: string; fragments: Fragment[] };
const previewRequests: Array<Deferred<Preview[]>> = [];
// Read while the store module initializes, so it must exist before the mock.
const runtime = vi.hoisted(() => ({ tauri: true }));

vi.mock("../lib/tauri", () => ({
  isTauriRuntime: () => runtime.tauri,
  assetUrl: (root: string, path: string) => `${root}/${path}`,
  listFramePreviews: () => {
    const request = deferred<Preview[]>();
    previewRequests.push(request);
    return request.promise;
  },
}));

import {
  insertFramePreviewFragments,
  pruneFramePreviews,
  pruneFramePreviewsByFrame,
  refreshFramePreviews,
  replaceFramePreviewFragment,
  resetFramePreviewLoader,
  syncFramePreviews,
} from "./library-previews";
import { selectFolderCovers } from "./library-selectors";
import {
  createInitialLibraryState,
  libraryStore,
  resetLibraryStore,
} from "./library-store";
import type { LibraryState } from "./library-types";

const now = "2026-10-04T00:00:00.000Z";
function frame(
  id: string,
  name: string,
  parentId: string | null = null,
): Frame {
  return { id, parentId, name, sortOrder: 0, createdAt: now, updatedAt: now };
}
function fragment(
  id: string,
  frameId: string,
  capturedAt = now,
  assetId: string | null = null,
): Fragment {
  return {
    id,
    assetId,
    frameId,
    title: id,
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.png`,
    capturedAt,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

const FRAMES = [
  frame("inbox", "Inbox"),
  frame("posters", "Posters"),
  frame("deep", "Deep", "posters"),
];

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function seed(state: Partial<LibraryState> = {}) {
  resetLibraryStore(
    {
      frames: FRAMES,
      revision: "r1",
      assetRoot: "/vault",
      booted: true,
      ...state,
    },
    { storage: null, previewMode: false, systemPrefersDark: false },
  );
}

describe("refreshFramePreviews", () => {
  beforeEach(() => {
    previewRequests.length = 0;
    runtime.tauri = true;
    resetFramePreviewLoader();
    seed();
  });

  afterEach(() => {
    resetFramePreviewLoader();
  });

  it("fetches once per revision and stores the previews by Frame id", async () => {
    const first = refreshFramePreviews();
    expect(refreshFramePreviews()).toBe(first);
    expect(previewRequests).toHaveLength(1);
    previewRequests[0]!.resolve([
      { frameId: "posters", fragments: [fragment("p2", "deep")] },
    ]);
    await first;
    const state = libraryStore.getState();
    expect(state.framePreviewsRevision).toBe("r1");
    expect(state.framePreviews?.posters?.map((f) => f.id)).toEqual(["p2"]);

    await refreshFramePreviews();
    expect(previewRequests).toHaveLength(1);
  });

  it("refetches when the snapshot revision changes and drops a superseded response", async () => {
    const stale = refreshFramePreviews();
    libraryStore.setState({ revision: "r2" });
    const fresh = refreshFramePreviews();
    expect(previewRequests).toHaveLength(2);
    previewRequests[0]!.resolve([
      { frameId: "inbox", fragments: [fragment("old", "inbox")] },
    ]);
    await stale;
    expect(libraryStore.getState().framePreviews).toBeNull();
    previewRequests[1]!.resolve([
      { frameId: "inbox", fragments: [fragment("new", "inbox")] },
    ]);
    await fresh;
    expect(libraryStore.getState().framePreviewsRevision).toBe("r2");
    expect(libraryStore.getState().framePreviews?.inbox?.[0]?.id).toBe("new");
  });

  it("clears stale previews, reports the error and does not retry the same revision", async () => {
    libraryStore.setState({
      framePreviews: { inbox: [fragment("trashed", "inbox")] },
      framePreviewsRevision: "r0",
    });
    const attempt = refreshFramePreviews();
    previewRequests[0]!.reject(new Error("vault locked"));
    await attempt;
    const state = libraryStore.getState();
    expect(state.framePreviews).toBeNull();
    expect(state.framePreviewsRevision).toBeNull();
    expect(state.error).toBe("vault locked");

    await refreshFramePreviews();
    expect(previewRequests).toHaveLength(1);
    libraryStore.setState({ revision: "r2" });
    void refreshFramePreviews();
    expect(previewRequests).toHaveLength(2);
  });

  it("drops a response that a local write overtook and fetches again", async () => {
    const racing = refreshFramePreviews();
    // The user trashes a Fragment while the read is in flight.
    libraryStore.setState((state) =>
      pruneFramePreviews(
        { ...state, framePreviews: { inbox: [fragment("a", "inbox")] } },
        new Set(["a"]),
      ),
    );
    previewRequests[0]!.resolve([
      { frameId: "inbox", fragments: [fragment("a", "inbox")] },
    ]);
    await racing;
    expect(libraryStore.getState().framePreviewsRevision).toBeNull();
    void refreshFramePreviews();
    expect(previewRequests).toHaveLength(2);
  });

  it("is a no-op outside the Tauri runtime and before the first snapshot", async () => {
    runtime.tauri = false;
    await refreshFramePreviews();
    runtime.tauri = true;
    libraryStore.setState({ revision: "" });
    await refreshFramePreviews();
    expect(previewRequests).toHaveLength(0);
  });

  it("syncs only while the home dashboard is showing", () => {
    syncFramePreviews({ ...libraryStore.getState(), view: "frames" });
    syncFramePreviews({ ...libraryStore.getState(), selectedFrameId: "inbox" });
    expect(previewRequests).toHaveLength(0);
    syncFramePreviews(libraryStore.getState());
    syncFramePreviews(libraryStore.getState());
    expect(previewRequests).toHaveLength(1);
  });
});

describe("preview patches", () => {
  const base = (): LibraryState => ({
    ...createInitialLibraryState({ storage: null, previewMode: false }),
    frames: FRAMES,
    framePreviews: {
      inbox: [fragment("i1", "inbox", "2026-01-03T00:00:00Z")],
      posters: [
        fragment("p3", "posters", "2026-01-03T00:00:00Z"),
        fragment("p2", "deep", "2026-01-02T00:00:00Z"),
        fragment("p1", "posters", "2026-01-01T00:00:00Z"),
      ],
    },
    framePreviewsRevision: "r1",
  });

  it("prunes trashed Fragments and keeps the reference when nothing matched", () => {
    const state = base();
    expect(pruneFramePreviews(state, new Set(["nope"])).framePreviews).toBe(
      state.framePreviews,
    );
    const pruned = pruneFramePreviews(state, new Set(["p2", "i1"]));
    expect(pruned.framePreviews).toEqual({
      posters: [
        state.framePreviews!.posters![0],
        state.framePreviews!.posters![2],
      ],
    });
  });

  it("drops trashed Frames and the Fragments that lived in nested ones", () => {
    const state = base();
    expect(
      pruneFramePreviewsByFrame(
        state,
        new Set(["deep"]),
      ).framePreviews?.posters?.map((f) => f.id),
    ).toEqual(["p3", "p1"]);
    expect(
      pruneFramePreviewsByFrame(state, new Set(["posters"])).framePreviews,
    ).toEqual({ inbox: state.framePreviews!.inbox });
  });

  it("inserts a newcomer into its top-level Frame's collage, newest first, bounded", () => {
    const state = base();
    const newest = fragment("p4", "deep", "2026-01-04T00:00:00Z");
    const older = fragment("p0", "posters", "2025-12-31T00:00:00Z");
    const next = insertFramePreviewFragments(state, [newest, older]);
    expect(next.framePreviews?.posters?.map((f) => f.id)).toEqual([
      "p4",
      "p3",
      "p2",
    ]);
    // A Frame without previews gets one; an unknown Frame id is its own root.
    const fresh = insertFramePreviewFragments(state, [fragment("x", "other")]);
    expect(fresh.framePreviews?.other?.map((f) => f.id)).toEqual(["x"]);
  });

  it("shows one tile per asset when the same asset is linked twice", () => {
    const state = base();
    const linked = fragment("p3-link", "deep", "2026-01-05T00:00:00Z", "asset");
    const withAsset: LibraryState = {
      ...state,
      framePreviews: {
        posters: [fragment("p3", "posters", "2026-01-03T00:00:00Z", "asset")],
      },
    };
    expect(
      insertFramePreviewFragments(withAsset, [
        linked,
      ]).framePreviews?.posters?.map((f) => f.id),
    ).toEqual(["p3-link"]);
  });

  it("replaces an edited Fragment in place and moves one across top-level Frames", () => {
    const state = base();
    const renamed = { ...state.framePreviews!.posters![0]!, title: "Renamed" };
    expect(
      replaceFramePreviewFragment(state, renamed).framePreviews?.posters?.[0]
        ?.title,
    ).toBe("Renamed");
    const moved = {
      ...state.framePreviews!.posters![1]!,
      frameId: "inbox",
      capturedAt: "2026-01-02T00:00:00Z",
    };
    const next = replaceFramePreviewFragment(state, moved).framePreviews;
    expect(next?.posters?.map((f) => f.id)).toEqual(["p3", "p1"]);
    expect(next?.inbox?.map((f) => f.id)).toEqual(["i1", "p2"]);
    expect(
      replaceFramePreviewFragment(state, fragment("unknown", "inbox"))
        .framePreviews,
    ).toBe(state.framePreviews);
  });

  it("feeds the collage selector, with the snapshot page as the per-Frame fallback", () => {
    const state: LibraryState = {
      ...base(),
      coverFragments: [fragment("c1", "inbox"), fragment("c2", "inbox")],
      framePreviews: {
        posters: [fragment("p9", "deep")],
      },
    };
    const covers = selectFolderCovers(state);
    expect(covers.get("posters")?.map((card) => card.fragment.id)).toEqual([
      "p9",
    ]);
    expect(covers.get("inbox")?.map((card) => card.fragment.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(covers.has("deep")).toBe(false);
  });
});
