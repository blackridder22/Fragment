import {
  matchesShortcut,
  type KeyboardEventLike,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";

export type PreviewKeyContext = Readonly<{
  closeBinding: ShortcutBinding;
  /** Another layer (context menu) owns the close shortcut right now. */
  closeDisabled?: boolean;
  /** Focus is inside an input, textarea, select or contenteditable. */
  editing: boolean;
  /** The title editor, tag editor or trash confirmation is open. */
  innerEditorOpen: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canCopy: boolean;
  canTrash: boolean;
  canSaveNotes: boolean;
}>;

export type PreviewKeyAction =
  | "close"
  | "close-editor"
  | "previous"
  | "next"
  | "copy"
  | "trash"
  | "save-notes"
  | "none";

function hasModifier(event: KeyboardEventLike) {
  return event.metaKey === true || event.ctrlKey === true;
}

function plainModifier(event: KeyboardEventLike) {
  return hasModifier(event) && event.shiftKey !== true && event.altKey !== true;
}

function keyIs(event: KeyboardEventLike, code: string, key: string) {
  return event.code === code || event.key?.toLowerCase() === key;
}

/**
 * Maps a key press inside the focused preview to the action the overlay runs.
 * Space is deliberately absent: the host keeps owning quick preview.
 */
export function resolvePreviewKey(
  event: KeyboardEventLike,
  context: PreviewKeyContext,
): PreviewKeyAction {
  if (plainModifier(event) && keyIs(event, "KeyS", "s")) {
    return context.canSaveNotes ? "save-notes" : "none";
  }

  if (matchesShortcut(event, context.closeBinding)) {
    if (context.closeDisabled) return "none";
    return context.innerEditorOpen ? "close-editor" : "close";
  }

  if (context.editing) return "none";

  if (keyIs(event, "ArrowLeft", "arrowleft")) {
    return context.canGoPrevious ? "previous" : "none";
  }
  if (keyIs(event, "ArrowRight", "arrowright")) {
    return context.canGoNext ? "next" : "none";
  }

  if (plainModifier(event) && event.repeat !== true) {
    if (keyIs(event, "KeyC", "c")) return context.canCopy ? "copy" : "none";
    if (keyIs(event, "Backspace", "backspace")) {
      return context.canTrash ? "trash" : "none";
    }
  }

  return "none";
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
