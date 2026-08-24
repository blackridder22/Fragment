import { CheckSquare, RotateCcw, Trash2, X } from "lucide-react";

type SelectionToolbarProps = {
  count: number;
  totalCount: number;
  context: "vault" | "trash";
  allMatching: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
};

export function SelectionToolbar({
  count,
  totalCount,
  context,
  allMatching,
  onClear,
  onSelectAll,
  onDelete,
  onRestore,
}: SelectionToolbarProps) {
  if (count === 0) {
    return null;
  }

  const allSelected = count === totalCount;
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label={`${context === "trash" ? "Trash" : "Frame"} selection actions`}
    >
      <span className="selection-count" aria-live="polite">
        {allMatching && allSelected ? "All " : ""}
        {count} selected
      </span>
      {!allSelected ? (
        <button
          className="button compact"
          onClick={onSelectAll}
          title="Select every matching Frame (Command+A)"
          type="button"
        >
          <CheckSquare aria-hidden="true" size={15} />
          <span>Select All</span>
        </button>
      ) : null}
      <button
        className="button compact"
        onClick={onClear}
        title="Clear selection (Escape)"
        type="button"
      >
        <X aria-hidden="true" size={15} />
        <span>Clear</span>
      </button>
      {context === "trash" && onRestore ? (
        <button className="button compact" onClick={onRestore} type="button">
          <RotateCcw aria-hidden="true" size={15} />
          <span>Restore</span>
        </button>
      ) : null}
      {context === "vault" && onDelete ? (
        <button
          className="button compact danger"
          onClick={onDelete}
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
          <span>Delete</span>
        </button>
      ) : null}
    </div>
  );
}
