export type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectableRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function marqueeRectFromPoints(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): MarqueeRect {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

export function intersectingCardIds(
  marquee: MarqueeRect,
  cards: readonly SelectableRect[],
) {
  const marqueeRight = marquee.left + marquee.width;
  const marqueeBottom = marquee.top + marquee.height;

  return cards
    .filter(
      (card) =>
        card.right >= marquee.left &&
        card.left <= marqueeRight &&
        card.bottom >= marquee.top &&
        card.top <= marqueeBottom,
    )
    .map((card) => card.id);
}

export function edgeScrollStep(
  pointer: number,
  start: number,
  end: number,
  edgeZone: number,
  maxStep: number,
) {
  const distanceFromStart = pointer - start;
  if (distanceFromStart < edgeZone) {
    return -maxStep * (1 - Math.max(0, distanceFromStart) / edgeZone);
  }

  const distanceFromEnd = end - pointer;
  if (distanceFromEnd < edgeZone) {
    return maxStep * (1 - Math.max(0, distanceFromEnd) / edgeZone);
  }

  return 0;
}

export function selectionAfterEmptyCanvasClick(
  startingIds: readonly string[],
  additive: boolean,
) {
  return additive ? [...startingIds] : [];
}
