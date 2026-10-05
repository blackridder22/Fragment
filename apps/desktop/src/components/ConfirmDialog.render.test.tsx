import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders the title, consequence and a destructive confirm button", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        confirmLabel="Delete now"
        description="This permanently removes 3 Fragments. This cannot be undone."
        destructive
        title="Delete 3 Fragments now?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Delete 3 Fragments now?");
    expect(markup).toContain("This permanently removes 3 Fragments.");
    expect(markup).toContain("v7-trash-confirm-button");
    expect(markup).toContain('data-modal-preferred-focus="true"');
    expect(markup).toContain(">Cancel</button>");
    expect(markup).toContain(">Delete now</button>");
  });

  it("uses the primary style and pending label for non-destructive confirms", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialog
        confirmLabel="Restore"
        description="2 Frames will return to your Vault."
        detail={<p>A Frame named Posters already exists.</p>}
        pending
        pendingLabel="Restoring…"
        title="Restore 2 Frames?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain("v7-frame-dialog-primary");
    expect(markup).not.toContain("v7-trash-confirm-button");
    expect(markup).toContain("Restoring…");
    expect(markup).toContain("A Frame named Posters already exists.");
    expect(markup).toContain("disabled");
  });
});
