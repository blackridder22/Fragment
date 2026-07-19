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
    <Modal className="frame-name-modal" title={title} onClose={onCancel}>
      <form className="frame-form" onSubmit={submit}>
        <div className="frame-form-copy">
          <p>
            Frames keep related Fragments together. Keep the name short enough
            to scan in the Vault.
          </p>
        </div>
        <label>
          Name
          <input
            autoFocus
            maxLength={48}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mood references"
          />
        </label>
        <div className="form-actions">
          <button className="button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="button primary"
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
