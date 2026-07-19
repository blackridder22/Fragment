import { ImagePlus } from "lucide-react";

type EmptyStateProps = {
  title: string;
  actionLabel: string;
  onAction: () => void;
};

export function EmptyState({ title, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <ImagePlus size={28} />
      </div>
      <h2>{title}</h2>
      <button className="button primary" onClick={onAction} type="button">
        {actionLabel}
      </button>
    </div>
  );
}
