import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export type PaginationFooterProps = {
  hasMore?: boolean;
  loadedCount: number;
  loading?: boolean;
  noun?: string;
  onLoadMore?: () => void;
  totalCount?: number;
};

export function PaginationFooter({
  hasMore = false,
  loadedCount,
  loading = false,
  noun = "Frames",
  onLoadMore,
  totalCount,
}: PaginationFooterProps) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const canLoadMore = hasMore && Boolean(onLoadMore);
  const normalizedTotal = Math.max(loadedCount, totalCount ?? loadedCount);
  const shouldRender = Boolean(onLoadMore) && (hasMore || loading);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      !canLoadMore ||
      loading ||
      !onLoadMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: "0px 0px 480px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoadMore, loadedCount, loading, onLoadMore]);

  if (!shouldRender) return null;

  const progressLabel = `Showing ${loadedCount.toLocaleString()} of ${normalizedTotal.toLocaleString()} ${noun}`;

  return (
    <div
      aria-busy={loading}
      aria-live="polite"
      className="v7-pagination-footer"
      data-canvas-control
    >
      <span
        aria-hidden="true"
        className="v7-pagination-sentinel"
        ref={sentinelRef}
      />
      <span className="v7-pagination-progress">{progressLabel}</span>
      <button
        aria-label={`Load more ${noun}. ${progressLabel}`}
        className="v7-pagination-button"
        disabled={!canLoadMore || loading}
        onClick={onLoadMore}
        type="button"
      >
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="v7-pagination-spinner"
            size={14}
            strokeWidth={1.8}
          />
        ) : (
          <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
        )}
        <span>{loading ? "Loading…" : "Load more"}</span>
      </button>
    </div>
  );
}
