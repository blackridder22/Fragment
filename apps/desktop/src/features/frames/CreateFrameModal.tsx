import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";

type CreateFrameModalProps = {
  initialName?: string;
  title: string;
  actionLabel: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
};

export function CreateFrameModal({
  initialName = "",
  title,
  actionLabel,
  onCancel,
  onSubmit,
}: CreateFrameModalProps) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const description =
    actionLabel === "Save"
      ? "Update the name used throughout your Vault."
      : "Create a folder for related Frames.";

  useEffect(() => setName(initialName), [initialName]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      return;
    }
    setBusy(true);
    try {
      await onSubmit(nextName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="frame-name-modal v7-frame-name-modal"
      title={title}
      onClose={onCancel}
    >
      <form
        aria-busy={busy}
        className="frame-form v7-frame-name-form"
        onSubmit={submit}
      >
        <div className="frame-form-copy v7-frame-name-copy">
          <p>{description}</p>
        </div>
        <label className="v7-frame-name-field">
          <span>Name</span>
          <input
            autoFocus
            className="v7-frame-name-input"
            data-modal-preferred-focus="true"
            maxLength={48}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mood references"
          />
        </label>
        <div className="form-actions v7-frame-name-actions">
          <button
            className="button v7-frame-dialog-button"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button primary v7-frame-dialog-button v7-frame-dialog-primary"
            disabled={busy || !name.trim()}
            type="submit"
          >
            {actionLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
