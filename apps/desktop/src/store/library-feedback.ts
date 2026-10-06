import { libraryStore } from "./library-store";
import type { ConfirmRequest, ToastAction, ToastTone } from "./library-types";

export const TOAST_DURATION_MS = 4000;

let toastSequence = 0;
let confirmSequence = 0;
let pendingConfirm: ((value: boolean) => void) | null = null;

export type ShowToastOptions = {
  tone?: ToastTone;
  action?: ToastAction;
  /** Auto-dismiss delay; `null` keeps the toast until dismissed. */
  duration?: number | null;
};

/**
 * Shows one toast at a time; a new toast replaces the visible one. An Undo
 * entry lives exactly as long as its toast (its only entry point), so
 * replacing or dismissing a toast also drops `undo`, unless Undo is running.
 */
export function showToast(message: string, options: ShowToastOptions = {}) {
  const id = ++toastSequence;
  libraryStore.setState((state) => ({
    toast: {
      id,
      message,
      tone: options.tone ?? "info",
      action: options.action,
      pending: false,
      duration:
        options.duration === undefined ? TOAST_DURATION_MS : options.duration,
    },
    undo: state.undoPending ? state.undo : null,
  }));
  return id;
}

export function setToastPending(
  id: number,
  pending: boolean,
  message?: string,
) {
  libraryStore.setState((state) =>
    state.toast?.id === id
      ? {
          toast: {
            ...state.toast,
            pending,
            message: message ?? state.toast.message,
          },
        }
      : {},
  );
}

export function dismissToast(id?: number) {
  libraryStore.setState((state) => {
    if (!state.toast || (id !== undefined && state.toast.id !== id)) return {};
    if (state.toast.pending) return {};
    return { toast: null, undo: state.undoPending ? state.undo : null };
  });
}

export function setLibraryError(message: string | null) {
  libraryStore.setState({ error: message });
}

export function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Records an error in the notice stack and returns its message. */
export function reportError(caught: unknown) {
  const message = errorMessage(caught);
  libraryStore.setState({ error: message });
  return message;
}

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** Opens the in-app confirm dialog and resolves with the user's choice. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  pendingConfirm?.(false);
  const request: ConfirmRequest = {
    id: ++confirmSequence,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? "Confirm",
    cancelLabel: options.cancelLabel ?? "Cancel",
    destructive: options.destructive ?? false,
  };
  libraryStore.setState({ confirm: request });
  return new Promise<boolean>((resolve) => {
    pendingConfirm = resolve;
  });
}

export function resolveConfirm(result: boolean) {
  const resolve = pendingConfirm;
  pendingConfirm = null;
  libraryStore.setState({ confirm: null });
  resolve?.(result);
}
