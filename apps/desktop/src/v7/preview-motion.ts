export type Rect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

/** Parses a CSS time such as `120ms` or `0.2s` into milliseconds. */
export function parseDurationMs(value: string | null | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const match = /^(-?\d*\.?\d+)\s*(ms|s)?$/i.exec(trimmed);
  if (!match) return 0;
  const amount = Number.parseFloat(match[1]!);
  if (!Number.isFinite(amount)) return 0;
  const unit = (match[2] ?? "ms").toLowerCase();
  return Math.max(0, unit === "s" ? amount * 1000 : amount);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Reads a duration custom property from an element, in milliseconds. */
export function readDurationToken(element: Element, token: string): number {
  if (typeof getComputedStyle !== "function") return 0;
  return parseDurationMs(getComputedStyle(element).getPropertyValue(token));
}

/**
 * Finds the on-screen rect of the gallery card image for a Fragment so the
 * preview can FLIP from it. Returns null when the card is not rendered or is
 * fully off screen.
 */
export function cardImageRect(fragmentId: string): Rect | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") {
    return null;
  }
  const selector = `.v7-frame-card[data-fragment-id="${CSS.escape(fragmentId)}"] .v7-frame-image`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  if (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  ) {
    return null;
  }
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Focuses the gallery card the preview was opened from, when it still exists. */
export function focusCard(fragmentId: string): boolean {
  if (typeof document === "undefined" || typeof CSS === "undefined") {
    return false;
  }
  const selector = `.v7-frame-card-action[data-fragment-id="${CSS.escape(fragmentId)}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return false;
  element.focus({ preventScroll: false });
  return document.activeElement === element;
}
