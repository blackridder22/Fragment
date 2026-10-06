import { useEffect } from "react";
import { selectionKeyboardIntent } from "../features/selection/selection-model";
import { matchesShortcut } from "../features/shortcuts/shortcut-model";
import { isDemoFragment } from "../lib/demo-vault";
import { isTauriRuntime } from "../lib/tauri";
import {
  changeView,
  closeContextMenu,
  closeFocused,
  closeFrameModal,
  closeQuickPreview,
  deselectAll,
  openCreateFrame,
  openFragmentPreview,
  openQuickPreview,
  selectAdjacent,
  selectAllMatching,
  setBrowsingLayout,
  setShortcutsOpen,
} from "../store/library-actions";
import {
  copyFragmentImageAction,
  moveFragmentsToTrash,
} from "../store/library-fragments";
import { chooseImages } from "../store/library-import";
import {
  isLibraryView,
  selectCanSelectAll,
  selectInspectedFragment,
  selectSelectedIds,
} from "../store/library-selectors";
import { libraryStore } from "../store/library-store";

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

const LAYOUT_KEYS = { "1": "masonry", "2": "grid", "3": "list" } as const;

/** Window-level keyboard handling for the library; reads the store directly. */
export function useGlobalShortcuts() {
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const state = libraryStore.getState();
      const shortcuts = state.settings.shortcuts;
      const focused = state.focused;
      const inspected = selectInspectedFragment(state);
      const editable = isEditableTarget(event.target);

      if (matchesShortcut(event, shortcuts.quickPreview) && !event.repeat) {
        if (
          !inspected ||
          focused?.mode === "preview" ||
          state.frameModal ||
          editable
        ) {
          return;
        }
        event.preventDefault();
        openQuickPreview(inspected);
        return;
      }
      if (event.key === "Enter" && focused?.mode === "quick") {
        event.preventDefault();
        openFragmentPreview(focused.fragment);
        return;
      }
      if (
        matchesShortcut(event, shortcuts.closeOverlay) &&
        focused?.mode === "quick"
      ) {
        event.preventDefault();
        closeFocused();
        return;
      }

      const selectedIds = selectSelectedIds(state);
      const nothingOpen =
        !focused &&
        !state.contextMenu &&
        !state.shortcutsOpen &&
        !state.frameModal &&
        !state.confirm;
      if (
        (isLibraryView(state.view) || state.view === "trash") &&
        nothingOpen &&
        !editable
      ) {
        const intent = selectionKeyboardIntent(event.key, {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
        const allowed =
          intent === "select-all"
            ? selectCanSelectAll(state)
            : intent === "clear"
              ? selectedIds.length > 0
              : intent === "delete-selection"
                ? isLibraryView(state.view) && selectedIds.length > 0
                : false;
        if (allowed) {
          event.preventDefault();
          if (intent === "select-all") void selectAllMatching();
          else if (intent === "clear") deselectAll();
          else void moveFragmentsToTrash(selectedIds);
          return;
        }
      }

      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (matchesShortcut(event, shortcuts.search)) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(".v7-global-search input")
          ?.focus();
        return;
      }
      if (matchesShortcut(event, shortcuts.importFrames)) {
        event.preventDefault();
        void chooseImages();
        return;
      }
      if (matchesShortcut(event, shortcuts.closeOverlay)) {
        if (state.contextMenu) {
          event.preventDefault();
          closeContextMenu();
          return;
        }
        if (state.shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen(false);
          return;
        }
        if (state.frameModal) {
          event.preventDefault();
          closeFrameModal();
          return;
        }
        if (focused) {
          event.preventDefault();
          closeFocused();
          return;
        }
      }
      if (
        editable ||
        focused?.mode === "preview" ||
        state.frameModal ||
        state.confirm
      ) {
        return;
      }

      if ((event.key === "?" && !command) || (command && key === "/")) {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (command && event.shiftKey && key === "f") {
        event.preventDefault();
        changeView("frames");
        window.setTimeout(() => {
          document
            .querySelector<HTMLButtonElement>('[data-v7-filter="fragment"]')
            ?.click();
        }, 0);
      } else if (command && !event.shiftKey && key === "n") {
        event.preventDefault();
        openCreateFrame(state.selectedFrameId);
      } else if (command && key in LAYOUT_KEYS) {
        event.preventDefault();
        setBrowsingLayout(LAYOUT_KEYS[key as keyof typeof LAYOUT_KEYS]);
      } else if (command && key === "c" && inspected) {
        if (isTauriRuntime() && !isDemoFragment(inspected)) {
          event.preventDefault();
          void copyFragmentImageAction(inspected);
        }
      } else if (event.key === "Enter" && inspected) {
        event.preventDefault();
        openFragmentPreview(inspected);
      } else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        selectedIds.length === 1
      ) {
        const nextId = selectAdjacent(event.key === "ArrowRight" ? 1 : -1);
        if (!nextId) return;
        event.preventDefault();
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>(
              `.fragment-card[data-fragment-id="${CSS.escape(nextId)}"]`,
            )
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 0);
      }
    }

    function keyUp(event: KeyboardEvent) {
      if (
        event.code ===
        libraryStore.getState().settings.shortcuts.quickPreview.code
      ) {
        closeQuickPreview();
      }
    }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);
}
