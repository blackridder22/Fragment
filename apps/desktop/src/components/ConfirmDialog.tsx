import { resolveConfirm } from "../store/library-feedback";
import { useLibraryStore } from "../store/library-store";
import type { ConfirmRequest } from "../store/library-types";
import { Modal } from "./Modal";

/** In-app confirmation dialog: focus trapped, Esc cancels, destructive styling. */
export function ConfirmDialog() {
  const confirm = useLibraryStore((state) => state.confirm);
  if (!confirm) return null;
  return (
    <ConfirmDialogView
      key={confirm.id}
      onResolve={resolveConfirm}
      request={confirm}
    />
  );
}

export function ConfirmDialogView({
  request,
  onResolve,
}: {
  request: ConfirmRequest;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <Modal
      className="v7-frame-name-modal fragment-confirm-dialog"
      onClose={() => onResolve(false)}
      title={request.title}
    >
      <div className="v7-frame-name-form">
        <div className="v7-frame-name-copy">
          <p>{request.message}</p>
        </div>
        <div className="v7-frame-name-actions">
          <button
            className="v7-frame-dialog-button"
            data-modal-preferred-focus={
              request.destructive ? "true" : undefined
            }
            onClick={() => onResolve(false)}
            type="button"
          >
            {request.cancelLabel}
          </button>
          <button
            className={`v7-frame-dialog-button ${
              request.destructive
                ? "fragment-confirm-destructive"
                : "v7-frame-dialog-primary"
            }`}
            data-destructive={request.destructive}
            data-modal-preferred-focus={
              request.destructive ? undefined : "true"
            }
            onClick={() => onResolve(true)}
            type="button"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
