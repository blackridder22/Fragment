import type { Frame } from "@fragment/shared";

type FrameChipBarProps = {
  frames: Frame[];
  selectedFrameId: string | null;
  counts: Map<string, number>;
  dropFrameId?: string | null;
  onSelect: (frameId: string | null) => void;
};

export function FrameChipBar({
  frames,
  selectedFrameId,
  counts,
  dropFrameId = null,
  onSelect,
}: FrameChipBarProps) {
  return (
    <div
      className="frame-chip-bar"
      aria-label="Fragment filters"
      role="toolbar"
    >
      <button
        aria-pressed={selectedFrameId === null}
        className="frame-chip"
        data-active={selectedFrameId === null}
        onClick={() => onSelect(null)}
        type="button"
      >
        All
      </button>
      {frames.map((frame) => (
        <button
          aria-pressed={selectedFrameId === frame.id}
          className="frame-chip"
          data-active={selectedFrameId === frame.id}
          data-drop-state={dropFrameId === frame.id ? "armed" : "idle"}
          data-drop-target={`frame-chip:${frame.id}`}
          key={frame.id}
          onClick={() => onSelect(frame.id)}
          type="button"
        >
          {frame.name}
          <span>{counts.get(frame.id) ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
