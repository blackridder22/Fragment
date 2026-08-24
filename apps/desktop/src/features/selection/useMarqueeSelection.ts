import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  edgeScrollStep,
  intersectingCardIds,
  marqueeRectFromPoints,
  selectionAfterEmptyCanvasClick,
  type MarqueeRect,
} from "./marquee-geometry";

export type { MarqueeRect } from "./marquee-geometry";

type UseMarqueeSelectionOptions = {
  matchingIds: readonly string[];
  selectedIds: readonly string[];
  onReplace: (ids: string[], visualOrder: string[]) => void;
};

type MarqueePress = {
  pointerId: number;
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  dragging: boolean;
  additive: boolean;
  baseIds: string[];
  startingIds: string[];
  container: HTMLElement;
  lastSignature: string;
};

const MARQUEE_THRESHOLD = 5;
const EDGE_ZONE = 48;
const MAX_SCROLL_STEP = 18;

export function useMarqueeSelection({
  matchingIds,
  selectedIds,
  onReplace,
}: UseMarqueeSelectionOptions) {
  const pressRef = useRef<MarqueePress | null>(null);
  const frameRef = useRef<number | null>(null);
  const [rect, setRect] = useState<MarqueeRect | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const clearInteractionState = useCallback(() => {
    cancelFrame();
    pressRef.current = null;
    setRect(null);
    delete document.body.dataset.marqueeActive;
  }, [cancelFrame]);

  useEffect(() => clearInteractionState, [clearInteractionState]);

  const updateSelection = useCallback(() => {
    frameRef.current = null;
    const press = pressRef.current;
    if (!press?.dragging) {
      return;
    }

    const containerBounds = press.container.getBoundingClientRect();
    const scrollStep = edgeScrollStep(
      press.clientY,
      containerBounds.top,
      containerBounds.bottom,
      EDGE_ZONE,
      MAX_SCROLL_STEP,
    );
    const previousScrollTop = press.container.scrollTop;
    if (scrollStep !== 0) {
      press.container.scrollBy({ top: scrollStep, behavior: "auto" });
    }
    const didScroll = press.container.scrollTop !== previousScrollTop;

    const currentX =
      press.clientX - containerBounds.left + press.container.scrollLeft;
    const currentY =
      press.clientY - containerBounds.top + press.container.scrollTop;
    const contentRect = marqueeRectFromPoints(
      press.startX,
      press.startY,
      currentX,
      currentY,
    );
    const nextRect = {
      left:
        containerBounds.left + contentRect.left - press.container.scrollLeft,
      top: containerBounds.top + contentRect.top - press.container.scrollTop,
      width: contentRect.width,
      height: contentRect.height,
    };
    setRect(nextRect);

    const matching = new Set(matchingIds);
    const cards = Array.from(
      press.container.querySelectorAll<HTMLElement>(
        ".fragment-card[data-fragment-id]",
      ),
    )
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          id: element.dataset.fragmentId ?? "",
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      })
      .filter((card) => card.id && matching.has(card.id))
      .sort((left, right) => left.top - right.top || left.left - right.left);
    const cardVisualOrder = cards.map((card) => card.id);
    const selectionOrder = Array.from(
      new Set([
        ...(press.additive ? press.baseIds : []),
        ...cardVisualOrder,
        ...matchingIds,
      ]),
    );
    const hits = intersectingCardIds(nextRect, cards);
    const nextIds = press.additive
      ? Array.from(new Set([...press.baseIds, ...hits]))
      : hits;
    const signature = nextIds.join("\u0000");
    if (signature !== press.lastSignature) {
      press.lastSignature = signature;
      onReplace(nextIds, selectionOrder);
    }

    if (didScroll && pressRef.current?.dragging) {
      frameRef.current = window.requestAnimationFrame(updateSelection);
    }
  }, [matchingIds, onReplace]);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(updateSelection);
    }
  }, [updateSelection]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        !(event.target instanceof Element) ||
        event.target.closest(
          "[data-fragment-id], [data-frame-drag-id], [data-canvas-control], button, input, textarea, select, a, [contenteditable='true'], [data-drop-target]",
        )
      ) {
        return false;
      }
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const containerBounds = event.currentTarget.getBoundingClientRect();
      pressRef.current = {
        pointerId: event.pointerId,
        startX:
          event.clientX - containerBounds.left + event.currentTarget.scrollLeft,
        startY:
          event.clientY - containerBounds.top + event.currentTarget.scrollTop,
        startClientX: event.clientX,
        startClientY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        dragging: false,
        additive,
        baseIds: additive ? [...selectedIds] : [],
        startingIds: [...selectedIds],
        container: event.currentTarget,
        lastSignature: additive ? selectedIds.join("\u0000") : "",
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const press = pressRef.current;
        if (!press || moveEvent.pointerId !== press.pointerId) {
          return;
        }
        press.clientX = moveEvent.clientX;
        press.clientY = moveEvent.clientY;
        if (
          !press.dragging &&
          Math.hypot(
            moveEvent.clientX - press.startClientX,
            moveEvent.clientY - press.startClientY,
          ) < MARQUEE_THRESHOLD
        ) {
          return;
        }
        if (!press.dragging) {
          press.dragging = true;
          document.body.dataset.marqueeActive = "true";
        }
        moveEvent.preventDefault();
        scheduleUpdate();
      };

      const removeListeners = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("keydown", handleKeyDown, true);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        const press = pressRef.current;
        if (!press || upEvent.pointerId !== press.pointerId) {
          return;
        }
        removeListeners();
        if (press.dragging) {
          upEvent.preventDefault();
          updateSelection();
        } else {
          onReplace(
            selectionAfterEmptyCanvasClick(press.startingIds, press.additive),
            [...matchingIds],
          );
        }
        clearInteractionState();
      };

      const restoreBaseAndCancel = () => {
        const press = pressRef.current;
        if (press?.dragging) {
          onReplace(press.startingIds, [...matchingIds]);
        }
        removeListeners();
        clearInteractionState();
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pressRef.current?.pointerId) {
          restoreBaseAndCancel();
        }
      };

      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          restoreBaseAndCancel();
        }
      };

      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("keydown", handleKeyDown, true);
      return true;
    },
    [
      clearInteractionState,
      matchingIds,
      onReplace,
      scheduleUpdate,
      selectedIds,
      updateSelection,
    ],
  );

  return {
    handlePointerDown,
    rect,
  };
}
