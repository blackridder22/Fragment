import { X } from "lucide-react";
import { useEffect } from "react";
import {
  formatShortcutBinding,
  matchesShortcut,
  type ShortcutBinding,
  type ShortcutActionId,
} from "../shortcuts/shortcut-model";

type KeyboardShortcutsHelpProps = {
  closeShortcut: ShortcutBinding;
  shortcuts: Readonly<Record<ShortcutActionId, ShortcutBinding>>;
  onClose: () => void;
};

export function KeyboardShortcutsHelp({
  closeShortcut,
  shortcuts,
  onClose,
}: KeyboardShortcutsHelpProps) {
  const shortcutRows = [
    ["Search Vault", formatShortcutBinding(shortcuts.search)],
    ["Advanced filters", "⌘ ⇧ F"],
    ["New Frame", "⌘ N"],
    ["Import images", formatShortcutBinding(shortcuts.importFrames)],
    ["Masonry / Grid / List", "⌘ 1 / 2 / 3"],
    ["Quick Preview", formatShortcutBinding(shortcuts.quickPreview)],
    ["Open Preview", "Enter"],
    ["Previous / next Fragment", "← / →"],
    ["Select all matching", "⌘ A"],
    ["Copy selected image", "⌘ C"],
    ["Move selection to Trash", "⌫"],
    ["Clear selection / close", formatShortcutBinding(shortcuts.closeOverlay)],
  ] as const;

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (matchesShortcut(event, closeShortcut)) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeShortcut, onClose]);

  return (
    <div
      className="shortcuts-backdrop"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-label="Keyboard shortcuts"
        className="shortcuts-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Fragment fluency</span>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div>
          {shortcutRows.map(([label, shortcut]) => (
            <div key={label}>
              <span>{label}</span>
              <kbd>{shortcut}</kbd>
            </div>
          ))}
        </div>
        <footer>Press ? or ⌘ / to show this guide.</footer>
      </section>
    </div>
  );
}
