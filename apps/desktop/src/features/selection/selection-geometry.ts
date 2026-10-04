import type { SelectableRect } from "./marquee-geometry";

/**
 * Returns client-coordinate rects for every selectable item in a container,
 * including items a virtualized list has not mounted.
 */
export type SelectableRectProvider = () => readonly SelectableRect[];

const providers = new WeakMap<Element, Set<SelectableRectProvider>>();

export function registerSelectableRects(
  container: Element,
  provider: SelectableRectProvider,
): () => void {
  let set = providers.get(container);
  if (!set) {
    set = new Set();
    providers.set(container, set);
  }
  set.add(provider);
  return () => {
    const current = providers.get(container);
    if (!current) return;
    current.delete(provider);
    if (current.size === 0) {
      providers.delete(container);
    }
  };
}

/**
 * Rects from every registered provider in registration order, or null when no
 * provider covers the container so callers can fall back to the DOM.
 */
export function selectableRectsFor(
  container: Element,
): SelectableRect[] | null {
  const set = providers.get(container);
  if (!set || set.size === 0) return null;
  const rects: SelectableRect[] = [];
  for (const provider of set) {
    rects.push(...provider());
  }
  return rects;
}

export function hasSelectableRectProvider(container: Element): boolean {
  return (providers.get(container)?.size ?? 0) > 0;
}
