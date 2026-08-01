import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type MarqueeRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type UseMarqueeSelectionOptions = {
  matchingIds: readonly string[];
  selectedIds: readonly string[];
  onReplace: (ids: string[], visualOrder: string[]) => void;
};

type MarqueePress = {
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  dragging: boolean;
  additive: boolean;
  baseIds: string[];
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
    delete document.body.dataset.dragActive;
  }, [cancelFrame]);

  useEffect(() => clearInteractionState, [clearInteractionState]);

  const updateSelection = useCallback(() => {
    frameRef.current = null;
    const press = pressRef.current;
    if (!press?.dragging) {
      return;
    }

    const distanceFromTop = press.clientY;
    const distanceFromBottom = window.innerHeight - press.clientY;
    let scrollStep = 0;
    if (distanceFromTop < EDGE_ZONE) {
      scrollStep =
        -MAX_SCROLL_STEP * (1 - Math.max(0, distanceFromTop) / EDGE_ZONE);
    } else if (distanceFromBottom < EDGE_ZONE) {
      scrollStep =
        MAX_SCROLL_STEP * (1 - Math.max(0, distanceFromBottom) / EDGE_ZONE);
    }
    if (scrollStep !== 0) {
      window.scrollBy({ top: scrollStep, behavior: "auto" });
    }

    const currentX = press.clientX + window.scrollX;
    const currentY = press.clientY + window.scrollY;
    const nextRect = {
      left: Math.min(press.startX, currentX),
      top: Math.min(press.startY, currentY),
      width: Math.abs(currentX - press.startX),
      height: Math.abs(currentY - press.startY),
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
          left: bounds.left + window.scrollX,
          right: bounds.right + window.scrollX,
          top: bounds.top + window.scrollY,
          bottom: bounds.bottom + window.scrollY,
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
    const hits = cards
      .filter(
        (card) =>
          card.right >= nextRect.left &&
          card.left <= nextRect.left + nextRect.width &&
          card.bottom >= nextRect.top &&
          card.top <= nextRect.top + nextRect.height,
      )
      .map((card) => card.id);
    const nextIds = press.additive
      ? Array.from(new Set([...press.baseIds, ...hits]))
      : hits;
    const signature = nextIds.join("\u0000");
    if (signature !== press.lastSignature) {
      press.lastSignature = signature;
      onReplace(nextIds, selectionOrder);
    }

    if (scrollStep !== 0 && pressRef.current?.dragging) {
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
          "[data-fragment-id], [data-frame-drag-id], button, input, textarea, select, a, [contenteditable='true'], [data-drop-target]",
        )
      ) {
        return false;
      }
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      pressRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX + window.scrollX,
        startY: event.clientY + window.scrollY,
        clientX: event.clientX,
        clientY: event.clientY,
        dragging: false,
        additive,
        baseIds: additive ? [...selectedIds] : [],
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
            moveEvent.clientX + window.scrollX - press.startX,
            moveEvent.clientY + window.scrollY - press.startY,
          ) < MARQUEE_THRESHOLD
        ) {
          return;
        }
        if (!press.dragging) {
          press.dragging = true;
          document.body.dataset.dragActive = "true";
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
          onReplace([], [...matchingIds]);
        }
        clearInteractionState();
      };

      const restoreBaseAndCancel = () => {
        const press = pressRef.current;
        if (press?.dragging) {
          onReplace(press.baseIds, [...matchingIds]);
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
