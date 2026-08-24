import { useEffect, useRef } from "react";

type LoadMoreSentinelProps = {
  hasMore: boolean;
  loading: boolean;
  loadedCount: number;
  totalCount: number;
  noun?: string;
  onLoadMore: () => void;
};

export function LoadMoreSentinel({
  hasMore,
  loading,
  loadedCount,
  totalCount,
  noun = "Frames",
  onLoadMore,
}: LoadMoreSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "0px 0px 700px 0px",
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadedCount, loading, onLoadMore]);

  return (
    <div className="load-more-control" aria-live="polite">
      <div
        aria-hidden="true"
        className="load-more-sentinel"
        ref={sentinelRef}
      />
      <span>
        Showing {loadedCount} of {totalCount}
      </span>
      <button
        aria-label={`Load more ${noun}. Showing ${loadedCount} of ${totalCount}`}
        className="button compact"
        disabled={loading || !hasMore}
        onClick={onLoadMore}
        type="button"
      >
        {loading ? "Loading" : "Load More"}
      </button>
    </div>
  );
}
