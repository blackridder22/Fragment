import type { Frame } from "@fragment/shared";
import { FolderOpen, Undo2 } from "lucide-react";

type TrashedFramesListProps = {
  frames: readonly Frame[];
  onRestore: (frame: Frame) => void | Promise<void>;
};

export function TrashedFramesList({
  frames,
  onRestore,
}: TrashedFramesListProps) {
  return (
    <section className="trashed-frame-section">
      <div className="section-heading">
        <h2>Frames</h2>
        <span>{frames.length} in Trash</span>
      </div>
      <div className="trashed-frame-list">
        {frames.map((frame) => (
          <article className="trashed-frame-row" key={frame.id}>
            <div className="trashed-frame-icon" aria-hidden="true">
              <FolderOpen size={18} />
            </div>
            <div>
              <strong>{frame.name}</strong>
              <span>Frame</span>
            </div>
            <button
              className="button compact"
              onClick={() => void onRestore(frame)}
              type="button"
            >
              <Undo2 aria-hidden="true" size={15} />
              <span>Restore</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
