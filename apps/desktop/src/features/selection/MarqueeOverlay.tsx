import { createPortal } from "react-dom";
import type { MarqueeRect } from "./useMarqueeSelection";

type MarqueeOverlayProps = {
  rect: MarqueeRect | null;
};

export function MarqueeOverlay({ rect }: MarqueeOverlayProps) {
  if (!rect) {
    return null;
  }
  return createPortal(
    <div
      aria-hidden="true"
      className="marquee-selection"
      style={{
        left: rect.left - window.scrollX,
        top: rect.top - window.scrollY,
        width: rect.width,
        height: rect.height,
      }}
    />,
    document.body,
  );
}
