import { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, Save } from "lucide-react";
import { Modal } from "../../components/Modal";

type DuplicateImportModalProps = {
  canAddToFrame: boolean;
  existingFrameName: string;
  existingTitle: string;
  fileName: string;
  frameName: string;
  trashed: boolean;
  onAddToFrame: () => Promise<void>;
  onCancel: () => void;
  onOpenExisting: () => Promise<void>;
  onRenameExisting: (title: string) => Promise<void>;
};

export function DuplicateImportModal({
  canAddToFrame,
  existingFrameName,
  existingTitle,
  fileName,
  frameName,
  trashed,
  onAddToFrame,
  onCancel,
  onOpenExisting,
  onRenameExisting,
}: DuplicateImportModalProps) {
  const [title, setTitle] = useState(existingTitle);
  const [busy, setBusy] = useState(false);

  useEffect(() => setTitle(existingTitle), [existingTitle]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="frame-name-modal duplicate-import-modal"
      title={canAddToFrame ? "Already in your Vault" : "Already in this Frame"}
      onClose={onCancel}
    >
      <div className="frame-form">
        <div className="frame-form-copy">
          <p>
            <strong>{fileName}</strong> matches a Fragment already saved in{" "}
            <strong>{canAddToFrame ? existingFrameName : frameName}</strong>.
            {canAddToFrame
              ? ` Add the existing image to ${frameName} without creating another file.`
              : " Fragment keeps one image membership per Frame."}
          </p>
          {trashed ? (
            <p>
              The existing Fragment is in Trash. Open it there to restore it.
            </p>
          ) : null}
        </div>
        {!trashed && !canAddToFrame ? (
          <label>
            Existing title
            <input
              autoFocus
              maxLength={160}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        ) : null}
        <div className="form-actions duplicate-import-actions">
          <button
            className="button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Never mind
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(onOpenExisting)}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={16} />
            <span>{trashed ? "View in Trash" : "Open existing"}</span>
          </button>
          {canAddToFrame ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run(onAddToFrame)}
              type="button"
            >
              <FolderPlus aria-hidden="true" size={16} />
              <span>Add to {frameName}</span>
            </button>
          ) : !trashed ? (
            <button
              className="button primary"
              disabled={
                busy || !title.trim() || title.trim() === existingTitle.trim()
              }
              onClick={() => void run(() => onRenameExisting(title.trim()))}
              type="button"
            >
              <Save aria-hidden="true" size={16} />
              <span>Save name</span>
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
