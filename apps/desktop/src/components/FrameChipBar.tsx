import type { Frame } from "@fragment/shared";

type FrameChipBarProps = {
  frames: Frame[];
  selectedFrameId: string | null;
  counts: Map<string, number>;
  onSelect: (frameId: string | null) => void;
};

export function FrameChipBar({
  frames,
  selectedFrameId,
  counts,
  onSelect
}: FrameChipBarProps) {
  return (
    <div className="frame-chip-bar" aria-label="Frame filters">
      <button
        className="frame-chip"
        data-active={selectedFrameId === null}
        onClick={() => onSelect(null)}
        type="button"
      >
        All
      </button>
      {frames.map((frame) => (
        <button
          className="frame-chip"
          data-active={selectedFrameId === frame.id}
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
