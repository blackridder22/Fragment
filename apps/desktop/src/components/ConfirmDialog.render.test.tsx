import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialogView } from "./ConfirmDialog";

describe("ConfirmDialogView", () => {
  it("renders the title, consequence and a destructive confirm button", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialogView
        onResolve={vi.fn()}
        request={{
          title: "Delete 3 Fragments now?",
          message: "This permanently removes 3 Fragments. This cannot be undone.",
          confirmLabel: "Delete now",
          cancelLabel: "Cancel",
          destructive: true,
        }}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Delete 3 Fragments now?");
    expect(markup).toContain("This permanently removes 3 Fragments.");
    expect(markup).toContain("fragment-confirm-destructive");
    expect(markup).toMatch(/data-modal-preferred-focus="true"[^>]*>Cancel/);
    expect(markup).toContain(">Delete now</button>");
    expect(markup).not.toContain("fragment-confirm-error");
  });

  it("uses the primary style, the pending label and the detail block for a restore", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialogView
        detail={<p>A Frame named Posters already exists.</p>}
        pending
        pendingLabel="Restoring…"
        onResolve={vi.fn()}
        request={{
          title: "Restore 2 Frames?",
          message: "2 Frames will return to your Vault.",
          confirmLabel: "Restore",
          cancelLabel: "Cancel",
          destructive: false,
        }}
      />,
    );

    expect(markup).toContain("v7-frame-dialog-primary");
    expect(markup).not.toContain("fragment-confirm-destructive");
    expect(markup).toContain("Restoring…");
    expect(markup).toContain('data-pending="true"');
    expect(markup).toContain("fragment-confirm-detail");
    expect(markup).toContain("A Frame named Posters already exists.");
    expect(markup).toContain("disabled");
  });

  it("keeps the dialog open with the failure after a failed attempt", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialogView
        error="restore the parent Frame first"
        onResolve={vi.fn()}
        request={{
          title: "Restore 1 Frame?",
          message: "“Posters” will leave the Trash.",
          confirmLabel: "Restore",
          cancelLabel: "Cancel",
          destructive: false,
        }}
      />,
    );

    expect(markup).toContain('class="fragment-confirm-error" role="alert"');
    expect(markup).toContain("restore the parent Frame first");
    expect(markup).not.toContain("disabled");
  });
});
