export function googleImagesSourceUrl(element: Element): string | undefined {
  const anchor = element.closest<HTMLAnchorElement>("a[href]");
  return anchor?.href;
}
