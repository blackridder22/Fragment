import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmAction,
  dismissToast,
  resolveConfirm,
  setToastPending,
  showToast,
} from "../store/library-feedback";
import { libraryStore, resetLibraryStore } from "../store/library-store";
import { ConfirmDialogView } from "./ConfirmDialog";
import { ToastView } from "./Toast";

describe("Toast", () => {
  it("renders a live region with the message and an action", () => {
    const markup = renderToStaticMarkup(
      <ToastView
        onDismiss={vi.fn()}
        toast={{
          id: 1,
          message: "3 Fragments moved to Trash",
          tone: "success",
          action: { label: "Undo", onAction: vi.fn() },
          pending: false,
          duration: 4000,
        }}
      />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("3 Fragments moved to Trash");
    expect(markup).toContain(">Undo</span>");
    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain('aria-label="Dismiss"');
  });

  it("shows one toast at a time and ignores dismiss while pending", () => {
    resetLibraryStore({}, { storage: null, previewMode: true });
    const first = showToast("Image copied");
    const second = showToast("Tags saved", { tone: "success" });
    expect(second).not.toBe(first);
    expect(libraryStore.getState().toast?.id).toBe(second);
    expect(libraryStore.getState().toast?.message).toBe("Tags saved");
    expect(libraryStore.getState().toast?.duration).toBe(4000);

    setToastPending(second, true, "Restoring…");
    dismissToast(second);
    expect(libraryStore.getState().toast?.message).toBe("Restoring…");

    setToastPending(second, false);
    dismissToast(first);
    expect(libraryStore.getState().toast).not.toBeNull();
    dismissToast(second);
    expect(libraryStore.getState().toast).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  it("styles the destructive action and focuses cancel by default", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialogView
        onResolve={vi.fn()}
        request={{
          id: 1,
          title: "Delete 3 Fragments forever?",
          message: "This cannot be undone.",
          confirmLabel: "Delete forever",
          cancelLabel: "Cancel",
          destructive: true,
        }}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Delete 3 Fragments forever?");
    expect(markup).toContain("fragment-confirm-destructive");
    expect(markup).toMatch(/data-modal-preferred-focus="true"[^>]*>Cancel/);
  });

  it("resolves the pending promise from the store", async () => {
    resetLibraryStore({}, { storage: null, previewMode: true });
    const pending = confirmAction({ title: "Move to Trash?", message: "" });
    expect(libraryStore.getState().confirm?.title).toBe("Move to Trash?");
    resolveConfirm(true);
    await expect(pending).resolves.toBe(true);
    expect(libraryStore.getState().confirm).toBeNull();

    const cancelled = confirmAction({ title: "Again?", message: "" });
    const replaced = confirmAction({ title: "Replaced", message: "" });
    await expect(cancelled).resolves.toBe(false);
    resolveConfirm(false);
    await expect(replaced).resolves.toBe(false);
  });
});
