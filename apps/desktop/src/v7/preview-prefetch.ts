/**
 * Bookkeeping for the decoded previews kept alive around the focused Fragment.
 *
 * The overlay keeps at most `limit` decoded previews: the one on the stage plus
 * its neighbours. Entries are evicted least-recently-used, never the pinned
 * current one, and an evicted image drops its source so WebKit can release the
 * decoded bitmap instead of holding every preview the user has walked past.
 */

export type PrefetchImage = {
  src: string;
  decoding?: string;
  onload: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
  decode?: () => Promise<void>;
};

export type PrefetchStatus = "loading" | "ready" | "failed";

type PrefetchEntry = {
  url: string;
  image: PrefetchImage;
  status: PrefetchStatus;
  settled: Promise<PrefetchStatus>;
  resolve: (status: PrefetchStatus) => void;
};

export type PreviewPrefetcher = {
  /** Pins the URL on the stage so it is tracked and never evicted first. */
  markCurrent(url: string | null): void;
  /** Starts loading and decoding the URLs in order, skipping tracked ones. */
  prefetch(urls: readonly string[]): void;
  /** Resolves with the final status, or null when the URL is not tracked. */
  whenSettled(url: string): Promise<PrefetchStatus | null>;
  isReady(url: string): boolean;
  has(url: string): boolean;
  /** Tracked URLs from least to most recently used. */
  urls(): string[];
  readonly size: number;
  /** Drops every tracked image. Safe to call more than once. */
  cancel(): void;
  /** Cancels and ignores every later call. */
  dispose(): void;
};

export type PreviewPrefetcherOptions = {
  limit?: number;
  createImage?: () => PrefetchImage;
};

export const DEFAULT_PREFETCH_LIMIT = 3;

function createDomImage(): PrefetchImage {
  return new Image();
}

export function createPreviewPrefetcher(
  options: PreviewPrefetcherOptions = {},
): PreviewPrefetcher {
  const limit = Math.max(
    1,
    Math.floor(options.limit ?? DEFAULT_PREFETCH_LIMIT),
  );
  const createImage = options.createImage ?? createDomImage;
  const entries = new Map<string, PrefetchEntry>();
  let current: string | null = null;
  let disposed = false;

  function release(entry: PrefetchEntry) {
    entry.image.onload = null;
    entry.image.onerror = null;
    entry.image.src = "";
    if (entry.status === "loading") {
      entry.status = "failed";
      entry.resolve("failed");
    }
  }

  function touch(url: string): PrefetchEntry | undefined {
    const entry = entries.get(url);
    if (!entry) return undefined;
    entries.delete(url);
    entries.set(url, entry);
    return entry;
  }

  function evict() {
    for (const [url, entry] of entries) {
      if (entries.size <= limit) break;
      if (url === current) continue;
      entries.delete(url);
      release(entry);
    }
  }

  function track(url: string): PrefetchEntry {
    const existing = touch(url);
    if (existing) return existing;

    const image = createImage();
    image.decoding = "async";
    let resolve: (status: PrefetchStatus) => void = () => undefined;
    const settled = new Promise<PrefetchStatus>((done) => {
      resolve = done;
    });
    const entry: PrefetchEntry = {
      url,
      image,
      status: "loading",
      settled,
      resolve,
    };
    const finish = (status: PrefetchStatus) => {
      if (entry.status !== "loading") return;
      entry.status = status;
      entry.resolve(status);
    };

    image.onload = () => {
      const decoded =
        typeof image.decode === "function" ? image.decode() : Promise.resolve();
      decoded.then(
        () => finish("ready"),
        () => finish("failed"),
      );
    };
    image.onerror = () => finish("failed");
    entries.set(url, entry);
    image.src = url;
    return entry;
  }

  function cancel() {
    for (const entry of entries.values()) release(entry);
    entries.clear();
    current = null;
  }

  return {
    markCurrent(url) {
      if (disposed) return;
      current = url;
      if (url) {
        track(url);
        evict();
      }
    },
    prefetch(urls) {
      if (disposed) return;
      for (const url of urls) {
        if (!url || url === current) continue;
        track(url);
      }
      evict();
    },
    whenSettled(url) {
      const entry = entries.get(url);
      return entry ? entry.settled : Promise.resolve(null);
    },
    isReady(url) {
      return entries.get(url)?.status === "ready";
    },
    has(url) {
      return entries.has(url);
    },
    urls() {
      return [...entries.keys()];
    },
    get size() {
      return entries.size;
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}
