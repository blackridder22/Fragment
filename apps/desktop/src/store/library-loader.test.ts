import type { Fragment } from "@fragment/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "./create-store";
import {
  activeQueryKey,
  createLibraryLoader,
  currentPageKey,
  serializeQueryKey,
  serializeQueryKeyWithoutQuery,
  trashQueryKey,
} from "./library-loader";
import { createInitialLibraryState } from "./library-store";
import type { LibraryState } from "./library-types";

function fragment(id: string, frameId = "frame-a"): Fragment {
  const now = "2026-10-04T00:00:00.000Z";
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

function page(ids: string[], total = ids.length, offset = 0) {
  return {
    items: ids.map((id) => fragment(id)),
    offset,
    limit: 60,
    total,
    hasMore: offset + ids.length < total,
    revision: "rev-1",
    paletteRevision: null,
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bootedState(): LibraryState {
  return {
    ...createInitialLibraryState({ storage: null, previewMode: false }),
    booted: true,
  };
}

async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("query keys", () => {
  it("serialize deterministically regardless of key order", () => {
    const state = bootedState();
    const left = serializeQueryKey(activeQueryKey(state));
    const right = serializeQueryKey({
      sort: "newest",
      filter: activeQueryKey(state).filter,
      includeDescendants: false,
      frameId: null,
      trashed: false,
    });
    expect(left).toBe(right);
    expect(currentPageKey(state, "active")).toBe(left);
  });

  it("change with Frame, filter, sort and view but strip only the query", () => {
    const base = bootedState();
    const root = serializeQueryKey(activeQueryKey(base));
    expect(
      serializeQueryKey(activeQueryKey({ ...base, selectedFrameId: "f" })),
    ).not.toBe(root);
    expect(
      serializeQueryKey(activeQueryKey({ ...base, sortMode: "name" })),
    ).not.toBe(root);
    expect(
      serializeQueryKey(activeQueryKey({ ...base, sourceFilter: "local" })),
    ).not.toBe(root);
    expect(serializeQueryKey(trashQueryKey(base))).not.toBe(root);
    expect(
      serializeQueryKey(trashQueryKey({ ...base, trashSort: "oldest" })),
    ).toContain("deleted-oldest");

    const typed = activeQueryKey({ ...base, query: "poster" });
    expect(serializeQueryKey(typed)).not.toBe(root);
    expect(serializeQueryKeyWithoutQuery(typed)).toBe(
      serializeQueryKeyWithoutQuery(activeQueryKey(base)),
    );
  });
});

describe("library loader", () => {
  let fetchPage: ReturnType<typeof vi.fn>;
  let fetchTrashedFrames: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchPage = vi.fn(async () => page(["a", "b"], 2));
    fetchTrashedFrames = vi.fn(async () => []);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(state: LibraryState = bootedState()) {
    const store = createStore(state);
    const loader = createLibraryLoader(store, {
      fetchPage: fetchPage as never,
      fetchTrashedFrames,
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as number),
    });
    return { store, loader };
  }

  it("does nothing before boot or in browser preview", () => {
    setup({ ...bootedState(), booted: false }).loader.start();
    setup({ ...bootedState(), previewMode: true }).loader.start();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("loads the first page once and records its key", async () => {
    const { store, loader } = setup();
    loader.start();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await flush();
    const state = store.getState();
    expect(state.activePage.key).toBe(currentPageKey(state, "active"));
    expect(state.activePage.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(state.activePage.total).toBe(2);
    expect(state.activePage.loading).toBe(false);
    expect(state.revision).toBe("rev-1");

    store.setState({ shortcutsOpen: true });
    store.setState({ view: "frames" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a page the snapshot already provided", () => {
    const state = bootedState();
    state.activePage = {
      ...state.activePage,
      key: currentPageKey(state, "active"),
      items: [fragment("snap")],
      total: 1,
    };
    setup(state).loader.start();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("loads immediately on Frame, filter and sort changes and resets pagination", async () => {
    const { store, loader } = setup();
    loader.start();
    await flush();
    fetchPage.mockClear();

    store.setState({ selectedFrameId: "frame-a" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      frameId: "frame-a",
      offset: 0,
    });
    await flush();

    store.setState({ sortMode: "name" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({
      sortMode: "name",
      offset: 0,
    });
    await flush();

    store.setState({ fragmentFilter: { tags: ["poster"], mimeTypes: [] } });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[2]?.[0].filter).toMatchObject({
      tags: ["poster"],
    });
  });

  it("debounces only the free-text query", async () => {
    const { store, loader } = setup();
    loader.start();
    await flush();
    fetchPage.mockClear();

    store.setState({ query: "p" });
    store.setState({ query: "po" });
    store.setState({ query: "pos" });
    expect(fetchPage).not.toHaveBeenCalled();
    store.setState({ shortcutsOpen: true });
    vi.advanceTimersByTime(149);
    expect(fetchPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[0].filter).toMatchObject({ query: "pos" });

    await flush();
    store.setState({ query: "post" });
    store.setState({ selectedFrameId: "frame-b" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(200);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("drops stale responses when the key changes while loading", async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    fetchPage
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { store, loader } = setup();
    loader.start();
    store.setState({ selectedFrameId: "frame-b" });
    expect(fetchPage).toHaveBeenCalledTimes(2);

    second.resolve(page(["b1"], 1));
    await flush();
    first.resolve(page(["root1", "root2"], 2));
    await flush();

    const state = store.getState();
    expect(state.activePage.items.map((item) => item.id)).toEqual(["b1"]);
    expect(state.activePage.key).toBe(currentPageKey(state, "active"));
  });

  it("shares in-flight requests for the same key and offset", async () => {
    fetchPage.mockImplementation(async () => page(["a", "b"], 5));
    const { store, loader } = setup();
    loader.start();
    await flush();
    fetchPage.mockClear();
    fetchPage.mockImplementation(async () => page(["c", "d"], 5, 2));

    const more = loader.loadMore("active");
    const again = loader.loadMore("active");
    expect(again).toBe(more);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ offset: 2 });
    await flush();
    expect(store.getState().activePage.items).toHaveLength(4);
  });

  it("reloads invalidated pages and loads the Trash lazily with its Frames", async () => {
    const { store, loader } = setup();
    loader.start();
    await flush();
    fetchPage.mockClear();

    loader.invalidate("active");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await flush();

    store.setState({ view: "trash" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({
      trashed: true,
      sortMode: "deleted",
    });
    expect(fetchTrashedFrames).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.getState().trashPage.key).toBe(
      currentPageKey(store.getState(), "trash"),
    );

    store.setState({ view: "home" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("records page errors without clearing loaded items", async () => {
    const { store, loader } = setup();
    loader.start();
    await flush();
    fetchPage.mockImplementationOnce(async () => {
      throw new Error("disk gone");
    });
    store.setState({ sortMode: "oldest" });
    await flush();
    const state = store.getState();
    expect(state.activePage.error).toBe("disk gone");
    expect(state.error).toBe("disk gone");
    expect(state.activePage.loading).toBe(false);
    expect(state.activePage.items).toHaveLength(2);
  });
});
