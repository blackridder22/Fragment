import type { Frame } from "@fragment/shared";
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

const now = "2026-10-04T00:00:00.000Z";
const INBOX: Frame = {
  id: "inbox",
  parentId: null,
  name: "Inbox",
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
};

type Snapshot = Awaited<
  ReturnType<typeof import("../lib/tauri").loadLibrarySnapshot>
>;
function snapshot(revision: string): Snapshot {
  return {
    defaultFrame: INBOX,
    frames: [INBOX],
    fragments: [],
    fragmentTotal: 0,
    trashTotal: 0,
    frameCounts: { inbox: 0 },
    revision,
    assetRoot: "/vault",
  } as Snapshot;
}

const snapshotRequests: Array<Deferred<Snapshot>> = [];
const dragDrop = {
  subscribe: deferred<() => void>(),
  unlisten: vi.fn(),
};

vi.mock("../lib/tauri", () => ({
  isTauriRuntime: () => true,
  assetUrl: (root: string, path: string) => `${root}/${path}`,
  loadLibrarySnapshot: () => {
    const request = deferred<Snapshot>();
    snapshotRequests.push(request);
    return request.promise;
  },
  listSmartFrames: async () => [],
  listTags: async () => [],
  listFragmentPage: async () => ({
    items: [],
    offset: 0,
    limit: 60,
    total: 0,
    hasMore: false,
    revision: "r1",
    paletteRevision: null,
  }),
  listTrashedFrames: async () => [],
  listFramePreviews: async () => [],
  getLibraryRevision: async () => "r1",
  getPaletteIndexStatus: async () => null,
  startPaletteIndexing: async () => undefined,
  setPalettePriority: async () => undefined,
  nativeHostStatus: async () => ({ ready: true, label: "Ready" }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => dragDrop.subscribe.promise,
  }),
}));

import { refreshSnapshot, startLibrary } from "./library-bootstrap";
import { libraryStore, resetLibraryStore } from "./library-store";

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe("refreshSnapshot", () => {
  beforeEach(() => {
    snapshotRequests.length = 0;
    resetLibraryStore(
      {},
      { storage: null, previewMode: false, systemPrefersDark: false },
    );
  });

  it("shares an in-flight refresh with plain callers", async () => {
    const first = refreshSnapshot();
    const second = refreshSnapshot();
    expect(second).toBe(first);
    expect(snapshotRequests).toHaveLength(1);
    snapshotRequests[0]!.resolve(snapshot("r1"));
    await Promise.all([first, second]);
    expect(libraryStore.getState().revision).toBe("r1");
  });

  it("queues one forced refresh behind an in-flight one instead of rejecting", async () => {
    const background = refreshSnapshot();
    const forced = refreshSnapshot(true);
    const forcedAgain = refreshSnapshot(true);
    expect(forcedAgain).toBe(forced);
    expect(snapshotRequests).toHaveLength(1);

    snapshotRequests[0]!.resolve(snapshot("r1"));
    await background;
    await flush();
    expect(snapshotRequests).toHaveLength(2);
    expect(libraryStore.getState().revision).toBe("r1");

    snapshotRequests[1]!.resolve(snapshot("r2"));
    await expect(forced).resolves.toBeUndefined();
    await expect(forcedAgain).resolves.toBeUndefined();
    expect(libraryStore.getState().revision).toBe("r2");
    expect(snapshotRequests).toHaveLength(2);
  });

  it("still rejects a forced refresh when its own request fails", async () => {
    const background = refreshSnapshot();
    const forced = refreshSnapshot(true);
    snapshotRequests[0]!.resolve(snapshot("r1"));
    await background;
    await flush();
    snapshotRequests[1]!.reject(new Error("vault locked"));
    await expect(forced).rejects.toThrow("vault locked");
    expect(libraryStore.getState().error).toBe("vault locked");
  });
});

describe("startLibrary", () => {
  const windowStub = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  beforeEach(() => {
    snapshotRequests.length = 0;
    dragDrop.subscribe = deferred<() => void>();
    dragDrop.unlisten = vi.fn();
    vi.stubGlobal("window", windowStub);
    resetLibraryStore(
      {},
      { storage: null, previewMode: false, systemPrefersDark: false },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a drag-drop listener that resolves after dispose", async () => {
    const dispose = startLibrary();
    dispose();
    expect(dragDrop.unlisten).not.toHaveBeenCalled();
    dragDrop.subscribe.resolve(dragDrop.unlisten);
    await flush();
    expect(dragDrop.unlisten).toHaveBeenCalledTimes(1);
  });

  it("removes a drag-drop listener that resolved before dispose", async () => {
    const dispose = startLibrary();
    dragDrop.subscribe.resolve(dragDrop.unlisten);
    await flush();
    expect(dragDrop.unlisten).not.toHaveBeenCalled();
    dispose();
    expect(dragDrop.unlisten).toHaveBeenCalledTimes(1);
  });
});
