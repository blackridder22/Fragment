import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  children: ReactNode;
  className?: string;
  headerActions?: ReactNode;
  onClose: () => void;
};

const FOCUSABLE_SELECTOR = [
  "[autofocus]",
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  title,
  children,
  className,
  headerActions,
  onClose,
}: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusDialog = window.requestAnimationFrame(() => {
      const initialFocus =
        dialog.querySelector<HTMLElement>("[data-modal-preferred-focus]") ??
        dialog.querySelector<HTMLElement>("[autofocus]") ??
        dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
        dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (initialFocus ?? dialog).focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        dialog!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      dialog.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        className={["modal", className].filter(Boolean).join(" ")}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <div className="modal-header-actions">
            {headerActions}
            <button
              aria-label="Close dialog"
              className="icon-button"
              data-modal-initial-focus="true"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
