type WheelDelta = Pick<WheelEvent, "deltaX" | "deltaY">;
type CancelableWheel = WheelDelta &
  Pick<WheelEvent, "cancelable" | "preventDefault">;

/**
 * WKWebView can rubber-band the whole page for a horizontal trackpad gesture,
 * even when the document itself has no horizontal overflow. Vertical and
 * diagonal scrolling that is primarily vertical must remain native.
 */
export function isHorizontalWheelGesture({ deltaX, deltaY }: WheelDelta) {
  return Math.abs(deltaX) > Math.abs(deltaY);
}

export function containHorizontalWheelGesture(event: CancelableWheel) {
  if (!event.cancelable || !isHorizontalWheelGesture(event)) {
    return false;
  }

  event.preventDefault();
  return true;
}
