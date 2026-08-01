import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type PointerDragPayload =
  | {
      kind: "fragments";
      ids: string[];
      imageUrls: string[];
      label: string;
    }
  | {
      kind: "frame";
      id: string;
      imageUrls: string[];
      label: string;
    };

export type PointerDragSession = {
  payload: PointerDragPayload;
  x: number;
  y: number;
};

type PressState = {
  pointerId: number;
  startX: number;
  startY: number;
  payload: PointerDragPayload;
  dragging: boolean;
};

type UsePointerDragSessionOptions = {
  getPayload: (
    target: Element,
    event: ReactPointerEvent<HTMLElement>,
  ) => PointerDragPayload | null;
  onDrop: (payload: PointerDragPayload, target: string) => void | Promise<void>;
  onTargetChange?: (target: string | null) => void;
};

const DRAG_THRESHOLD = 5;

export function usePointerDragSession({
  getPayload,
  onDrop,
  onTargetChange,
}: UsePointerDragSessionOptions) {
  const getPayloadRef = useRef(getPayload);
  const onDropRef = useRef(onDrop);
  const onTargetChangeRef = useRef(onTargetChange);
  const pressRef = useRef<PressState | null>(null);
  const hoveredTargetRef = useRef<string | null>(null);
  const clickGuardTimerRef = useRef<number | null>(null);
  const [session, setSession] = useState<PointerDragSession | null>(null);
  getPayloadRef.current = getPayload;
  onDropRef.current = onDrop;
  onTargetChangeRef.current = onTargetChange;

  const setHoveredTarget = useCallback((target: string | null) => {
    if (hoveredTargetRef.current === target) {
      return;
    }
    hoveredTargetRef.current = target;
    onTargetChangeRef.current?.(target);
  }, []);

  const clearSourceState = useCallback(() => {
    document
      .querySelectorAll<HTMLElement>(
        ".fragment-card[data-dragging='true'], [data-frame-drag-id][data-dragging='true']",
      )
      .forEach((element) => element.removeAttribute("data-dragging"));
    delete document.body.dataset.dragActive;
  }, []);

  const markSourceState = useCallback((payload: PointerDragPayload) => {
    if (payload.kind === "fragments") {
      const ids = new Set(payload.ids);
      document
        .querySelectorAll<HTMLElement>(".fragment-card[data-fragment-id]")
        .forEach((element) => {
          if (
            element.dataset.fragmentId &&
            ids.has(element.dataset.fragmentId)
          ) {
            element.dataset.dragging = "true";
          }
        });
    } else {
      document
        .querySelectorAll<HTMLElement>("[data-frame-drag-id]")
        .forEach((element) => {
          if (element.dataset.frameDragId === payload.id) {
            element.dataset.dragging = "true";
          }
        });
    }
    document.body.dataset.dragActive = "true";
  }, []);

  const cleanup = useCallback(() => {
    pressRef.current = null;
    setSession(null);
    setHoveredTarget(null);
    clearSourceState();
  }, [clearSourceState, setHoveredTarget]);

  useEffect(
    () => () => {
      cleanup();
      if (clickGuardTimerRef.current !== null) {
        window.clearTimeout(clickGuardTimerRef.current);
      }
    },
    [cleanup],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        !(event.target instanceof Element)
      ) {
        return false;
      }
      const payload = getPayloadRef.current(event.target, event);
      if (!payload) {
        return false;
      }

      pressRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        payload,
        dragging: false,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const press = pressRef.current;
        if (!press || moveEvent.pointerId !== press.pointerId) {
          return;
        }
        const distance = Math.hypot(
          moveEvent.clientX - press.startX,
          moveEvent.clientY - press.startY,
        );
        if (!press.dragging && distance < DRAG_THRESHOLD) {
          return;
        }
        if (!press.dragging) {
          press.dragging = true;
          markSourceState(press.payload);
        }
        moveEvent.preventDefault();
        const hit = document.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const dropTarget = hit?.closest<HTMLElement>("[data-drop-target]");
        setHoveredTarget(dropTarget?.dataset.dropTarget ?? null);
        setSession({
          payload: press.payload,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
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
        const target = hoveredTargetRef.current;
        const completedDrag = press.dragging;
        const payload = press.payload;
        if (completedDrag) {
          upEvent.preventDefault();
          upEvent.stopPropagation();
          const swallowClick = (clickEvent: MouseEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopImmediatePropagation();
            if (clickGuardTimerRef.current !== null) {
              window.clearTimeout(clickGuardTimerRef.current);
              clickGuardTimerRef.current = null;
            }
          };
          document.addEventListener("click", swallowClick, {
            capture: true,
            once: true,
          });
          clickGuardTimerRef.current = window.setTimeout(() => {
            document.removeEventListener("click", swallowClick, true);
            clickGuardTimerRef.current = null;
          }, 500);
        }
        cleanup();
        if (completedDrag && target) {
          void onDropRef.current(payload, target);
        }
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pressRef.current?.pointerId) {
          return;
        }
        removeListeners();
        cleanup();
      };

      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") {
          return;
        }
        keyEvent.preventDefault();
        removeListeners();
        cleanup();
      };

      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("keydown", handleKeyDown, true);
      return true;
    },
    [cleanup, markSourceState, setHoveredTarget],
  );

  return {
    handlePointerDown,
    session,
  };
}
