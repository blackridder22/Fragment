import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaginationFooter } from "./PaginationFooter";

describe("PaginationFooter", () => {
  it("stays out of preview layouts when pagination is not configured", () => {
    const markup = renderToStaticMarkup(
      <PaginationFooter loadedCount={7} totalCount={286} />,
    );

    expect(markup).toBe("");
  });

  it("reports loaded progress and exposes a manual load action", () => {
    const markup = renderToStaticMarkup(
      <PaginationFooter
        hasMore
        loadedCount={60}
        onLoadMore={vi.fn()}
        totalCount={286}
      />,
    );

    expect(markup).toContain("Showing 60 of 286 Fragments");
    expect(markup).toContain("Load more");
    expect(markup).not.toContain("disabled");
  });

  it("announces and disables the action while loading", () => {
    const markup = renderToStaticMarkup(
      <PaginationFooter
        hasMore
        loadedCount={60}
        loading
        onLoadMore={vi.fn()}
        totalCount={286}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading…");
    expect(markup).toContain("disabled");
  });

  it("offers a retry instead of auto-loading after a page failure", () => {
    const markup = renderToStaticMarkup(
      <PaginationFooter
        error="The library is busy"
        hasMore
        loadedCount={120}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        totalCount={1000}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Couldn’t load more Fragments");
    expect(markup).toContain("Showing 120 of 1,000 Fragments");
    expect(markup).toContain(">Retry</span>");
    expect(markup).not.toContain("v7-pagination-sentinel");
  });
});
