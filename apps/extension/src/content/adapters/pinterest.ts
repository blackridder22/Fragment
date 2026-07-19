export function pinterestTitle(element: Element): string | undefined {
  return element.closest("[aria-label]")?.getAttribute("aria-label") ?? undefined;
}
