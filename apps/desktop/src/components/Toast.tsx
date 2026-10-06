import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dismissToast } from "../store/library-feedback";
import { useLibraryStore } from "../store/library-store";
import type { ToastState } from "../store/library-types";

/** Bottom-center feedback surface; one toast at a time, auto-dismissed. */
export function Toast() {
  const toast = useLibraryStore((state) => state.toast);
  if (!toast) return null;
  return <ToastView key={toast.id} toast={toast} onDismiss={dismissToast} />;
}

export function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (toast.pending || paused || toast.duration === null) return;
    const timer = window.setTimeout(
      () => dismiss.current(toast.id),
      toast.duration,
    );
    return () => window.clearTimeout(timer);
  }, [paused, toast.duration, toast.id, toast.pending]);

  return (
    <div
      aria-atomic="true"
      aria-busy={toast.pending}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className="fragment-toast"
      data-pending={toast.pending}
      data-tone={toast.tone}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
    >
      <span className="fragment-toast-message">{toast.message}</span>
      {toast.action ? (
        <button
          className="fragment-toast-action"
          disabled={toast.pending}
          onClick={() => void toast.action?.onAction()}
          type="button"
        >
          {toast.pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="fragment-toast-spinner"
              size={14}
            />
          ) : null}
          <span>{toast.action.label}</span>
        </button>
      ) : null}
      <button
        aria-label="Dismiss"
        className="fragment-toast-dismiss"
        disabled={toast.pending}
        onClick={() => onDismiss(toast.id)}
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
