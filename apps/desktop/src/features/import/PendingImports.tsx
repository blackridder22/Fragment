import type { ImportQueueItem } from "./import-state";

type PendingImportStatusProps = {
  activeCount: number;
  failedCount: number;
};

type PendingImportCardsProps = {
  items: readonly ImportQueueItem[];
  onCancel: (item: ImportQueueItem) => void;
  onRetry: (item: ImportQueueItem) => void;
  onSkip: (item: ImportQueueItem) => void;
};

export function PendingImportStatus({
  activeCount,
  failedCount,
}: PendingImportStatusProps) {
  return (
    <div className="import-status" aria-live="polite">
      <span />
      <strong>
        {failedCount > 0
          ? `${failedCount} ${failedCount === 1 ? "import needs" : "imports need"} attention${activeCount > 0 ? ` · ${activeCount} importing` : ""}`
          : `Importing ${activeCount} ${activeCount === 1 ? "Frame" : "Frames"}`}
      </strong>
      <small>
        {failedCount > 0
          ? "Retry or skip failed items below."
          : "You can keep using Fragment while this finishes."}
      </small>
    </div>
  );
}

export function PendingImportCards({
  items,
  onCancel,
  onRetry,
  onSkip,
}: PendingImportCardsProps) {
  return (
    <div className="pending-import-grid" aria-live="polite">
      {items.map((item) => (
        <article className="pending-import-card" key={item.id}>
          <div className="pending-import-preview" />
          <span>{item.frameName}</span>
          <strong>{item.name}</strong>
          <small>
            {item.status === "failed"
              ? (item.error ?? "Import failed")
              : item.status === "preparing"
                ? "Preparing Frame"
                : "Waiting to import"}
          </small>
          {item.status === "failed" ? (
            <div className="detail-actions">
              <button
                className="button compact"
                onClick={() => onRetry(item)}
                type="button"
              >
                Retry
              </button>
              <button
                className="button compact"
                onClick={() => onSkip(item)}
                type="button"
              >
                Skip
              </button>
            </div>
          ) : (
            <div className="detail-actions">
              <button
                className="button compact"
                onClick={() => onCancel(item)}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
