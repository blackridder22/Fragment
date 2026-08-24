import { ChevronRight, Layers3 } from "lucide-react";
import type { Frame } from "@fragment/shared";
import { frameBreadcrumbs } from "./frame-tree";

type FrameBreadcrumbsProps = {
  frames: Frame[];
  includeDescendants: boolean;
  selectedFrameId: string | null;
  onIncludeDescendantsChange: (value: boolean) => void;
  onSelectFrame: (frameId: string | null) => void;
};

export function FrameBreadcrumbs({
  frames,
  includeDescendants,
  selectedFrameId,
  onIncludeDescendantsChange,
  onSelectFrame,
}: FrameBreadcrumbsProps) {
  const trail = selectedFrameId
    ? frameBreadcrumbs(frames, selectedFrameId)
    : [];
  return (
    <div className="frame-breadcrumb-bar">
      <nav aria-label="Fragment path" className="frame-breadcrumbs">
        <button onClick={() => onSelectFrame(null)} type="button">
          Vault
        </button>
        {trail.map((frame) => (
          <span key={frame.id}>
            <ChevronRight aria-hidden="true" size={13} />
            <button onClick={() => onSelectFrame(frame.id)} type="button">
              {frame.name}
            </button>
          </span>
        ))}
      </nav>
      {selectedFrameId ? (
        <label className="frame-descendants-toggle">
          <input
            checked={includeDescendants}
            onChange={(event) =>
              onIncludeDescendantsChange(event.target.checked)
            }
            type="checkbox"
          />
          <Layers3 aria-hidden="true" size={14} />
          <span>Include Frames from nested Fragments</span>
        </label>
      ) : null}
    </div>
  );
}
