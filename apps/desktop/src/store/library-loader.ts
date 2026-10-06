import type { Frame } from "@fragment/shared";
import {
  filterWithLibraryControls,
  type FragmentFilter,
} from "../features/filters/filter-model";
import { mergeUniqueFragments } from "../features/library/library-state";
import {
  listFragmentPage,
  listTrashedFrames,
  type FragmentPage,
  type FragmentPageSortMode,
} from "../lib/tauri";
import type { Store } from "./create-store";
import { LIBRARY_PAGE_SIZE, libraryStore } from "./library-store";
import type { LibraryState, LibraryView, PageState } from "./library-types";

export type PageName = "active" | "trash";

/** Everything that determines which server page is shown. */
export type PageQueryKey = {
  trashed: boolean;
  frameId: string | null;
  includeDescendants: boolean;
  filter: FragmentFilter;
  sort: FragmentPageSortMode;
};

export const QUERY_DEBOUNCE_MS = 150;

export function pageNameForView(view: LibraryView): PageName | null {
  if (view === "home" || view === "frames") return "active";
  if (view === "trash") return "trash";
  return null;
}

export function pageOf(state: LibraryState, page: PageName): PageState {
  return page === "active" ? state.activePage : state.trashPage;
}

export function activeQueryKey(state: LibraryState): PageQueryKey {
  const frameId = state.selectedFrameId;
  return {
    trashed: false,
    frameId,
    includeDescendants: Boolean(
      frameId && state.frameNavigator.includeDescendants,
    ),
    filter: filterWithLibraryControls(
      state.fragmentFilter,
      state.query,
      state.sourceFilter,
    ),
    sort: state.sortMode,
  };
}

export function trashQueryKey(state: LibraryState): PageQueryKey {
  return {
    trashed: true,
    frameId: null,
    includeDescendants: false,
    filter: filterWithLibraryControls(
      state.fragmentFilter,
      state.query,
      state.sourceFilter,
    ),
    sort: state.trashSort === "oldest" ? "deleted-oldest" : "deleted",
  };
}

export function queryKeyForPage(
  state: LibraryState,
  page: PageName,
): PageQueryKey {
  return page === "active" ? activeQueryKey(state) : trashQueryKey(state);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function serializeQueryKey(key: PageQueryKey): string {
  return stableStringify(key);
}

export function serializeQueryKeyWithoutQuery(key: PageQueryKey): string {
  return stableStringify({
    ...key,
    filter: { ...key.filter, query: undefined },
  });
}

/** The serialized key the current state expects for a page. */
export function currentPageKey(state: LibraryState, page: PageName): string {
  return serializeQueryKey(queryKeyForPage(state, page));
}

export type LoaderDeps = {
  fetchPage: typeof listFragmentPage;
  fetchTrashedFrames: () => Promise<Frame[]>;
  debounceMs: number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  pageSize: number;
};

type Desired = { serialized: string; noQuery: string; key: PageQueryKey };
type Inflight = { serialized: string; offset: number; promise: Promise<void> };

export type LibraryLoader = {
  start: () => () => void;
  sync: () => void;
  loadMore: (page: PageName) => Promise<void>;
  reload: (page: PageName) => Promise<void>;
  invalidate: (page: PageName) => void;
  /** Clears a page's failed marker and requests its first page again. */
  retry: (page: PageName) => Promise<void>;
};

/**
 * One loader drives both server pages. A serialized query key per page
 * decides when to fetch: identical keys never refetch, in-flight requests for
 * the same key and offset are shared, stale responses are dropped by sequence
 * number, and a key change always resets pagination. Only free-text query
 * changes are debounced. A key whose request failed is remembered per page
 * and not requested again on unrelated store changes; the key changing, or
 * an explicit `retry`, `reload` or `invalidate`, lifts that hold.
 */
export function createLibraryLoader(
  store: Store<LibraryState>,
  overrides: Partial<LoaderDeps> = {},
): LibraryLoader {
  const deps: LoaderDeps = {
    fetchPage: listFragmentPage,
    fetchTrashedFrames: listTrashedFrames,
    debounceMs: QUERY_DEBOUNCE_MS,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as number),
    pageSize: LIBRARY_PAGE_SIZE,
    ...overrides,
  };
  const sequence: Record<PageName, number> = { active: 0, trash: 0 };
  const inflight: Record<PageName, Inflight | null> = {
    active: null,
    trash: null,
  };
  const timers: Record<PageName, unknown | null> = {
    active: null,
    trash: null,
  };
  const lastDesired: Record<PageName, Desired | null> = {
    active: null,
    trash: null,
  };
  /** Serialized key whose last request failed; `sync` skips it. */
  const failed: Record<PageName, string | null> = {
    active: null,
    trash: null,
  };

  function desiredFor(state: LibraryState, page: PageName): Desired {
    const key = queryKeyForPage(state, page);
    return {
      key,
      serialized: serializeQueryKey(key),
      noQuery: serializeQueryKeyWithoutQuery(key),
    };
  }

  function setPage(page: PageName, patch: Partial<PageState>) {
    store.setState((state) => ({
      [page === "active" ? "activePage" : "trashPage"]: {
        ...pageOf(state, page),
        ...patch,
      },
    }));
  }

  function cancelTimer(page: PageName) {
    if (timers[page] !== null) {
      deps.clearTimeout(timers[page]);
      timers[page] = null;
    }
  }

  function apply(
    page: PageName,
    serialized: string,
    key: PageQueryKey,
    response: FragmentPage,
    reset: boolean,
    trashedFrames: Frame[] | null,
  ) {
    const state = store.getState();
    const current = pageOf(state, page);
    const paletteRevision = response.paletteRevision ?? null;
    if (
      !reset &&
      key.filter.color &&
      current.paletteRevision !== paletteRevision
    ) {
      setPage(page, { loading: false });
      store.setState({ colorResultsChanged: true });
      return;
    }
    const items = reset
      ? mergeUniqueFragments([], response.items)
      : mergeUniqueFragments(current.items, response.items);
    setPage(page, {
      key: serialized,
      items,
      total: response.total,
      hasMore: response.hasMore,
      loading: false,
      error: null,
      paletteRevision,
    });
    store.setState({
      revision: response.revision,
      colorResultsChanged: reset ? false : state.colorResultsChanged,
      ...(trashedFrames ? { trashedFrames, trashedFramesLoaded: true } : {}),
    });
  }

  function load(page: PageName, reset: boolean): Promise<void> {
    const state = store.getState();
    if (!state.booted || state.previewMode) return Promise.resolve();
    const current = pageOf(state, page);
    const desired = desiredFor(state, page);
    const offset = reset ? 0 : current.items.length;
    if (!reset && (!current.hasMore || current.key !== desired.serialized)) {
      return Promise.resolve();
    }
    const existing = inflight[page];
    if (
      existing &&
      existing.serialized === desired.serialized &&
      existing.offset === offset
    ) {
      return existing.promise;
    }
    const seq = ++sequence[page];
    const entry: Inflight = {
      serialized: desired.serialized,
      offset,
      promise: Promise.resolve(),
    };
    // Register before the first setState so the store notification that
    // re-enters sync() sees this request instead of starting another one.
    inflight[page] = entry;
    setPage(page, { loading: true, error: null });
    entry.promise = (async () => {
      try {
        const [response, trashedFrames] = await Promise.all([
          deps.fetchPage({
            frameId: desired.key.frameId,
            includeDescendants: desired.key.includeDescendants,
            trashed: desired.key.trashed,
            offset,
            limit: deps.pageSize,
            filter: desired.key.filter,
            sortMode: desired.key.sort,
          }),
          page === "trash" && reset
            ? deps.fetchTrashedFrames()
            : Promise.resolve(null),
        ]);
        if (seq !== sequence[page]) return;
        failed[page] = null;
        apply(
          page,
          desired.serialized,
          desired.key,
          response,
          reset,
          trashedFrames,
        );
      } catch (caught) {
        if (seq !== sequence[page]) return;
        failed[page] = desired.serialized;
        const message =
          caught instanceof Error ? caught.message : String(caught);
        setPage(page, { loading: false, error: message });
        store.setState({ error: message });
      } finally {
        if (inflight[page] === entry) inflight[page] = null;
      }
    })();
    return entry.promise;
  }

  function sync() {
    const state = store.getState();
    if (!state.booted || state.previewMode) return;
    const page = pageNameForView(state.view);
    if (!page) return;
    const desired = desiredFor(state, page);
    const previous = lastDesired[page];
    lastDesired[page] = desired;
    const current = pageOf(state, page);
    if (current.key === desired.serialized) {
      cancelTimer(page);
      return;
    }
    if (failed[page] !== null && failed[page] !== desired.serialized) {
      failed[page] = null;
    }
    if (failed[page] === desired.serialized) {
      cancelTimer(page);
      return;
    }
    const pending = inflight[page];
    if (
      pending &&
      pending.serialized === desired.serialized &&
      pending.offset === 0
    ) {
      return;
    }
    if (previous && previous.serialized === desired.serialized) {
      if (timers[page] !== null) return;
      void load(page, true);
      return;
    }
    cancelTimer(page);
    const onlyQueryChanged =
      previous !== null && previous.noQuery === desired.noQuery;
    if (onlyQueryChanged) {
      timers[page] = deps.setTimeout(() => {
        timers[page] = null;
        void load(page, true);
      }, deps.debounceMs);
      return;
    }
    void load(page, true);
  }

  return {
    start() {
      const unsubscribe = store.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        cancelTimer("active");
        cancelTimer("trash");
      };
    },
    sync,
    loadMore: (page) => load(page, false),
    reload(page) {
      failed[page] = null;
      setPage(page, { key: null });
      return load(page, true);
    },
    invalidate(page) {
      failed[page] = null;
      setPage(page, { key: null });
      sync();
    },
    retry(page) {
      failed[page] = null;
      return load(page, true);
    },
  };
}

export const libraryLoader = createLibraryLoader(libraryStore);
