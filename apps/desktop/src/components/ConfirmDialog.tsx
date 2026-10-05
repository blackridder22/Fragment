import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Modal } from "./Modal";

export type ConfirmDialogProps = {
  title: string;
  /** The consequence of confirming, stated with the exact count. */
  description: ReactNode;
  /** Optional extra block under the description, such as a resolved name. */
  detail?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * In-app replacement for `window.confirm`. Focus is trapped inside the dialog,
 * Escape and the backdrop cancel, and the confirm button receives initial focus.
 */
export function ConfirmDialog({
  title,
  description,
  detail,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  pendingLabel,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);

  useEffect(() => {
    cancelRef.current = onCancel;
    pendingRef.current = pending;
  }, [onCancel, pending]);

  // Escape cancels wherever focus is, even in the frame before the Modal has
  // moved focus inside, and never reaches page-level listeners.
  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!pendingRef.current) cancelRef.current();
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, []);

  function cancel() {
    if (!pending) onCancel();
  }

  function containKeys(event: KeyboardEvent<HTMLDivElement>) {
    // The Modal already closes on Escape; stop the key from also reaching
    // page-level listeners such as "clear selection" or "delete selection".
    if (
      event.key === "Escape" ||
      event.key === "Backspace" ||
      event.key === "Delete"
    ) {
      event.stopPropagation();
    }
  }

  return (
    <Modal
      className="v7-frame-name-modal v7-confirm-modal"
      title={title}
      onClose={cancel}
    >
      <div
        className="v7-frame-name-form v7-confirm-dialog"
        data-destructive={destructive}
        onKeyDown={containKeys}
      >
        <div className="v7-frame-name-copy">
          {typeof description === "string" ? <p>{description}</p> : description}
          {detail}
          {error ? (
            <p className="v7-confirm-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="v7-frame-name-actions">
          <button
            className="v7-frame-dialog-button"
            disabled={pending}
            onClick={cancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={`v7-frame-dialog-button ${
              destructive ? "v7-trash-confirm-button" : "v7-frame-dialog-primary"
            }`}
            data-modal-preferred-focus="true"
            disabled={pending}
            onClick={() => void onConfirm()}
            type="button"
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
