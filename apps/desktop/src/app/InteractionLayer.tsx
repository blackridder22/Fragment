import { useLayoutEffect, type PointerEvent } from "react";
import { DragGhost } from "../features/dragdrop/DragGhost";
import { usePointerDragSession } from "../features/dragdrop/usePointerDragSession";
import { MarqueeOverlay } from "../features/selection/MarqueeOverlay";
import { useMarqueeSelection } from "../features/selection/useMarqueeSelection";
import { replaceSelection } from "../store/library-actions";
import {
  handlePointerDrop,
  pointerDragPayloadFor,
  setPointerDropTarget,
} from "../store/library-dragdrop";
import {
  selectSelectableIds,
  selectSelectedIds,
} from "../store/library-selectors";
import { useLibraryStore } from "../store/library-store";

type PointerHandler = (event: PointerEvent<HTMLElement>) => void;

const handlers: {
  canvas: PointerHandler | null;
  shell: PointerHandler | null;
} = { canvas: null, shell: null };

/** Stable entry points so pages and the shell keep referentially stable props. */
export function onCanvasPointerDown(event: PointerEvent<HTMLElement>) {
  handlers.canvas?.(event);
}

export function onShellPointerDown(event: PointerEvent<HTMLElement>) {
  handlers.shell?.(event);
}

/**
 * Owns pointer drag and marquee selection. It re-renders on pointer moves,
 * which is why it lives outside the page tree.
 */
export function InteractionLayer() {
  const selectableIds = useLibraryStore(selectSelectableIds);
  const selectedIds = useLibraryStore(selectSelectedIds);
  const pointerDrag = usePointerDragSession({
    getPayload: pointerDragPayloadFor,
    onDrop: handlePointerDrop,
    onTargetChange: setPointerDropTarget,
  });
  const marquee = useMarqueeSelection({
    matchingIds: selectableIds,
    selectedIds,
    onReplace: replaceSelection,
  });

  useLayoutEffect(() => {
    handlers.canvas = (event) => {
      if (pointerDrag.handlePointerDown(event)) return;
      marquee.handlePointerDown(event);
    };
    handlers.shell = (event) => {
      pointerDrag.handlePointerDown(event);
    };
  });

  useLayoutEffect(
    () => () => {
      handlers.canvas = null;
      handlers.shell = null;
    },
    [],
  );

  return (
    <>
      <DragGhost session={pointerDrag.session} />
      <MarqueeOverlay rect={marquee.rect} />
    </>
  );
}
