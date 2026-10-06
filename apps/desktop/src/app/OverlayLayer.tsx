import { X } from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Toast } from "../components/Toast";
import { CreateFrameModal } from "../features/frames/CreateFrameModal";
import { FragmentContextMenu } from "../features/fragments/FragmentContextMenu";
import { KeyboardShortcutsHelp } from "../features/library/KeyboardShortcutsHelp";
import { isDemoFragment } from "../lib/demo-vault";
import { isTauriRuntime } from "../lib/tauri";
import {
  closeContextMenu,
  closeFrameModal,
  deselectAll,
  openFragmentPreview,
  setShortcutsOpen,
} from "../store/library-actions";
import { setLibraryError } from "../store/library-feedback";
import {
  copyFragmentImageAction,
  linkFragmentsToFrame,
  moveFragmentToFrameAction,
  moveFragmentsToTrash,
  moveSelectedFragmentsToFrame,
  openFocusedSource,
  revealFragment,
  tagSelectedFragments,
} from "../store/library-fragments";
import { submitFrameModal } from "../store/library-frames";
import { retryImport, skipImport } from "../store/library-import";
import {
  isLibraryView,
  pluralize,
  selectDisplayFrames,
  selectSelectedCount,
  selectSelectedFragments,
  selectSelectedIds,
} from "../store/library-selectors";
import { libraryStore, useLibraryStore } from "../store/library-store";
import { SelectionActionBar } from "../v7/SelectionActionBar";
import { FocusedOverlayContainer } from "./FocusedOverlayContainer";
import { InteractionLayer } from "./InteractionLayer";

function clearError() {
  setLibraryError(null);
}

function NoticeStack() {
  const error = useLibraryStore((state) => state.error);
  const pendingImports = useLibraryStore((state) => state.pendingImports);
  if (!error && pendingImports.length === 0) return null;
  const failed = pendingImports.filter((item) => item.status === "failed");
  const active = pendingImports.length - failed.length;
  return (
    <div aria-live="polite" className="v7-notice-stack">
      {error ? (
        <div className="v7-notice" data-tone="error">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={clearError} type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      {pendingImports.length > 0 ? (
        <div className="v7-notice fragment-import-notice">
          <span>
            {active > 0
              ? `Importing ${pluralize(active, "Fragment")}`
              : "Import complete"}
            {failed.length > 0 ? ` · ${failed.length} failed` : ""}
          </span>
          {failed.length > 0 ? (
            <details className="fragment-import-failures">
              <summary>Show failed imports</summary>
              <ul>
                {failed.map((item) => (
                  <li key={item.id}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.error || "This file could not be imported."}
                    </span>
                    <div>
                      <button onClick={() => retryImport(item)} type="button">
                        Retry
                      </button>
                      <button onClick={() => skipImport(item)} type="button">
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function moveSelectedToFrame(frameId: string) {
  return moveSelectedFragmentsToFrame(
    selectSelectedIds(libraryStore.getState()),
    frameId,
  );
}

function previewSelected() {
  const first = selectSelectedFragments(libraryStore.getState())[0];
  if (!first) throw new Error("The selected Fragments are not loaded yet");
  openFragmentPreview(first);
}

async function trashSelected() {
  await moveFragmentsToTrash(selectSelectedIds(libraryStore.getState()));
}

function SelectionBarContainer() {
  const view = useLibraryStore((state) => state.view);
  const count = useLibraryStore(selectSelectedCount);
  const frames = useLibraryStore(selectDisplayFrames);
  const knownTags = useLibraryStore((state) => state.knownTags);
  if (!isLibraryView(view) || count === 0) return null;
  return (
    <SelectionActionBar
      count={count}
      frames={frames}
      knownTags={knownTags}
      onClear={deselectAll}
      onMove={moveSelectedToFrame}
      onPreview={previewSelected}
      onTag={tagSelectedFragments}
      onTrash={trashSelected}
    />
  );
}

function ContextMenuContainer() {
  const menu = useLibraryStore((state) => state.contextMenu);
  const view = useLibraryStore((state) => state.view);
  const frames = useLibraryStore(selectDisplayFrames);
  const closeShortcut = useLibraryStore(
    (state) => state.settings.shortcuts.closeOverlay,
  );
  if (!menu) return null;
  const { fragment } = menu;
  const demo = isDemoFragment(fragment);
  return (
    <FragmentContextMenu
      {...menu}
      canTrash={isLibraryView(view)}
      canUseNativeActions={isTauriRuntime() && !demo}
      closeShortcut={closeShortcut}
      frames={frames}
      onAddToFrame={(frameId) =>
        void (
          demo
            ? moveFragmentToFrameAction(fragment, frameId)
            : linkFragmentsToFrame(menu.fragmentIds, frameId)
        ).catch(() => undefined)
      }
      onClose={closeContextMenu}
      onCopy={() => void copyFragmentImageAction(fragment)}
      onOpen={() => openFragmentPreview(fragment)}
      onOpenSource={
        fragment.sourceUrl || fragment.pageUrl
          ? () => void openFocusedSource(fragment)
          : undefined
      }
      onReveal={() => void revealFragment(fragment)}
      onTrash={() => void moveFragmentsToTrash(menu.fragmentIds)}
    />
  );
}

function closeShortcuts() {
  setShortcutsOpen(false);
}

function ShortcutsHelpContainer() {
  const open = useLibraryStore((state) => state.shortcutsOpen);
  const shortcuts = useLibraryStore((state) => state.settings.shortcuts);
  if (!open) return null;
  return (
    <KeyboardShortcutsHelp
      closeShortcut={shortcuts.closeOverlay}
      onClose={closeShortcuts}
      shortcuts={shortcuts}
    />
  );
}

function FrameModalContainer() {
  const modal = useLibraryStore((state) => state.frameModal);
  if (!modal) return null;
  return (
    <CreateFrameModal
      actionLabel={modal.mode === "rename" ? "Save" : "Create"}
      initialName={modal.mode === "rename" ? modal.frame.name : ""}
      onCancel={closeFrameModal}
      onSubmit={submitFrameModal}
      title={
        modal.mode === "rename"
          ? "Rename Frame"
          : modal.parentId
            ? "New nested Frame"
            : "New Frame"
      }
    />
  );
}

/** Everything that floats above the page: notices, bars, menus, modals. */
export function OverlayLayer() {
  return (
    <>
      <NoticeStack />
      <SelectionBarContainer />
      <InteractionLayer />
      <ContextMenuContainer />
      <ShortcutsHelpContainer />
      <Toast />
      <FrameModalContainer />
      <FocusedOverlayContainer />
      <ConfirmDialog />
    </>
  );
}
