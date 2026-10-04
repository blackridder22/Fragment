import { FilterX, ImageOff, LoaderCircle, RefreshCw } from "lucide-react";

export type GalleryEmptyStateProps = {
  /** Message shown when the first page failed to load. */
  error?: string | null;
  /** Name of the open Frame, used by the empty copy. */
  frameName?: string | null;
  hasActiveFilters?: boolean;
  loading?: boolean;
  onClearFilters?: () => void;
  onRetry?: () => void;
};

/** Copy uses Fragment for images and Frame for collections. */
export function GalleryEmptyState({
  error,
  frameName,
  hasActiveFilters = false,
  loading = false,
  onClearFilters,
  onRetry,
}: GalleryEmptyStateProps) {
  if (loading) {
    return (
      <div
        aria-busy="true"
        className="v7-gallery-empty"
        data-state="loading"
        role="status"
      >
        <LoaderCircle
          aria-hidden="true"
          className="v7-gallery-spinner"
          size={24}
        />
        <strong>Loading Fragments…</strong>
      </div>
    );
  }
  if (error) {
    return (
      <div className="v7-gallery-empty" data-state="error" role="alert">
        <ImageOff aria-hidden="true" size={24} />
        <strong>Couldn’t load Fragments</strong>
        <span>{error}</span>
        {onRetry ? (
          <button
            className="v7-gallery-empty-action"
            onClick={onRetry}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
            <span>Retry</span>
          </button>
        ) : null}
      </div>
    );
  }
  if (hasActiveFilters) {
    return (
      <div className="v7-gallery-empty" data-state="no-matches" role="status">
        <FilterX aria-hidden="true" size={24} />
        <strong>No Fragments match these filters</strong>
        <span>Try removing a filter, or clear them all.</span>
        {onClearFilters ? (
          <button
            className="v7-gallery-empty-action"
            onClick={onClearFilters}
            type="button"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="v7-gallery-empty" data-state="empty" role="status">
      <ImageOff aria-hidden="true" size={24} />
      <strong>
        {frameName
          ? `No Fragments in ${frameName} yet`
          : "No Fragments in your Vault yet"}
      </strong>
      <span>Import an image or save one from Capture Mode.</span>
    </div>
  );
}
