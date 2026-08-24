export const CONTEXT_MENU_VIEWPORT_INSET = 8;

export type ContextMenuPosition = {
  left: number;
  top: number;
};

type ContextMenuPositionInput = {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  inset?: number;
};

function clampToViewport(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function clampContextMenuPosition({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  inset = CONTEXT_MENU_VIEWPORT_INSET,
}: ContextMenuPositionInput): ContextMenuPosition {
  const safeInset = Math.max(CONTEXT_MENU_VIEWPORT_INSET, inset);

  return {
    left: clampToViewport(x, safeInset, viewportWidth - menuWidth - safeInset),
    top: clampToViewport(y, safeInset, viewportHeight - menuHeight - safeInset),
  };
}
