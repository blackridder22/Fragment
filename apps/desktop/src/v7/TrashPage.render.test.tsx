import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrashPage } from "./TrashPage";

describe("TrashPage totals", () => {
  it("reports the global total even before every page is loaded", () => {
    const markup = renderToStaticMarkup(
      <TrashPage
        frameNameFor={() => "Vault"}
        frames={[]}
        items={[]}
        loading={false}
        retentionLabel="Permanently removed after 31 days"
        total={72}
        onEmptyTrash={vi.fn()}
        onRestoreFragment={vi.fn()}
        onRestoreFrame={vi.fn()}
      />,
    );

    expect(markup).toContain("72 items · Permanently removed after 31 days");
    expect(markup).toContain("Showing 0 of 72 items");
    expect(markup).toContain("No matching items");
    expect(markup).not.toContain("Trash is empty");
  });
});
