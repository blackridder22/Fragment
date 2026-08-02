import { X } from "lucide-react";
import { useEffect } from "react";

type KeyboardShortcutsHelpProps = { onClose: () => void };

const SHORTCUTS = [
  ["Search Vault", "⌘ K"],
  ["Advanced filters", "⌘ ⇧ F"],
  ["New Frame", "⌘ N"],
  ["Import images", "⌘ I"],
  ["Masonry / Grid / List", "⌘ 1 / 2 / 3"],
  ["Quick Preview", "Space"],
  ["Open Preview", "Enter"],
  ["Previous / next Fragment", "← / →"],
  ["Select all matching", "⌘ A"],
  ["Copy selected image", "⌘ C"],
  ["Move selection to Trash", "⌫"],
  ["Clear selection / close", "Esc"],
] as const;

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="shortcuts-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Keyboard shortcuts"
        className="shortcuts-sheet"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><span>Fragment fluency</span><h2>Keyboard Shortcuts</h2></div>
          <button className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div>
          {SHORTCUTS.map(([label, shortcut]) => (
            <div key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>
          ))}
        </div>
        <footer>Press ? or ⌘ / to show this guide.</footer>
      </section>
    </div>
  );
}
