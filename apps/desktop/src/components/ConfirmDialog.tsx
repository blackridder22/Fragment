import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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

export type ConfirmDialogViewProps = {
  /** The store's request, or one a page builds itself (no id needed). */
  request: Omit<ConfirmRequest, "id"> & { id?: number };
  onResolve: (confirmed: boolean) => void;
  /** Optional block under the message, such as a resolved Frame name. */
  detail?: ReactNode;
  /** Keeps the dialog open with its buttons disabled while the action runs. */
  pending?: boolean;
  /** Confirm button label while pending, for example "Restoring…". */
  pendingLabel?: string;
  /** Shown after a failed attempt; the dialog stays open for a retry. */
  error?: string | null;
};

/**
 * The presentational dialog. The store-driven `ConfirmDialog` resolves a plain
 * yes/no; a page that must keep the dialog open while its action runs (and
 * show the failure in place) renders this directly with `pending`/`error`.
 */
export function ConfirmDialogView({
  request,
  onResolve,
  detail,
  pending = false,
  pendingLabel,
  error,
}: ConfirmDialogViewProps) {
  const resolveRef = useRef(onResolve);
  const pendingRef = useRef(pending);

  useEffect(() => {
    resolveRef.current = onResolve;
    pendingRef.current = pending;
  }, [onResolve, pending]);

  // Escape cancels wherever focus is, even in the frame before the Modal has
  // moved focus inside, and never reaches page-level listeners.
  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!pendingRef.current) resolveRef.current(false);
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, []);

  function cancel() {
    if (!pending) onResolve(false);
  }

  function containKeys(event: KeyboardEvent<HTMLDivElement>) {
    // Backspace and Delete must not reach the page's "delete selection" keys.
    if (event.key === "Backspace" || event.key === "Delete") {
      event.stopPropagation();
    }
  }

  return (
    <Modal
      className="v7-frame-name-modal fragment-confirm-dialog"
      onClose={cancel}
      title={request.title}
    >
      <div
        aria-busy={pending}
        className="v7-frame-name-form"
        data-pending={pending}
        onKeyDown={containKeys}
      >
        <div className="v7-frame-name-copy">
          <p>{request.message}</p>
          {detail ? (
            <div className="fragment-confirm-detail">{detail}</div>
          ) : null}
          {error ? (
            <p className="fragment-confirm-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="v7-frame-name-actions">
          <button
            className="v7-frame-dialog-button"
            data-modal-preferred-focus={
              request.destructive ? "true" : undefined
            }
            disabled={pending}
            onClick={cancel}
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
            disabled={pending}
            onClick={() => onResolve(true)}
            type="button"
          >
            {pending ? (pendingLabel ?? request.confirmLabel) : request.confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
