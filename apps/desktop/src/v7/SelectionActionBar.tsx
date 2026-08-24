import type { Frame } from "@fragment/shared";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { tagValidationError } from "../features/tags/tag-editor-model";
import "../styles/v7-preview.css";

type SelectionPanel = "move" | "tag" | null;
type MaybeAsyncAction = () => void | Promise<void>;

export type SelectionActionBarProps = {
  count: number;
  frames: Frame[];
  knownTags: string[];
  onPreview: MaybeAsyncAction;
  onMove: (frameId: string) => void | Promise<void>;
  onTag: (tag: string) => void | Promise<void>;
  onTrash: MaybeAsyncAction;
  onClear: () => void;
};

export function SelectionActionBar({
  count,
  frames,
  knownTags,
  onPreview,
  onMove,
  onTag,
  onTrash,
  onClear,
}: SelectionActionBarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const [panel, setPanel] = useState<SelectionPanel>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!panel) return;

    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        toolbarRef.current?.contains(event.target) ||
        panelRef.current?.contains(event.target)
      ) {
        return;
      }
      setPanel(null);
      setActionError(null);
    };

    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [panel]);

  useEffect(() => {
    if (panel === "tag") {
      window.setTimeout(() => tagInputRef.current?.focus(), 0);
    }
  }, [panel]);

  if (count <= 0) return null;

  function togglePanel(nextPanel: Exclude<SelectionPanel, null>) {
    if (pending) return;
    setActionError(null);
    setPanel((current) => (current === nextPanel ? null : nextPanel));
  }

  async function runAction(action: MaybeAsyncAction) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await action();
      setPanel(null);
      setTagDraft("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }

  function closePanelOnEscape(event: ReactKeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape" && panel) {
      event.preventDefault();
      setPanel(null);
      setActionError(null);
    }
  }

  function submitTag(value: string) {
    const validationError = tagValidationError([], value);
    if (validationError) {
      setActionError(validationError);
      return;
    }
    void runAction(() => onTag(value.trim()));
  }

  return (
    <>
      <div
        aria-busy={pending}
        aria-label="Frame selection actions"
        className="v7-selection-action-bar"
        onKeyDown={closePanelOnEscape}
        ref={toolbarRef}
        role="toolbar"
      >
        <span className="v7-selection-count">{count} selected</span>
        <span aria-hidden="true" className="v7-selection-divider" />
        <button
          disabled={pending}
          onClick={() => void runAction(onPreview)}
          type="button"
        >
          Preview
        </button>
        <button
          aria-expanded={panel === "move"}
          disabled={pending}
          onClick={() => togglePanel("move")}
          type="button"
        >
          Move to Fragment
        </button>
        <button
          aria-expanded={panel === "tag"}
          disabled={pending}
          onClick={() => togglePanel("tag")}
          type="button"
        >
          Tag
        </button>
        <button
          className="v7-selection-trash"
          disabled={pending}
          onClick={() => void runAction(onTrash)}
          type="button"
        >
          Trash
        </button>
        <button
          aria-label="Clear Frame selection"
          className="v7-selection-clear"
          disabled={pending}
          onClick={onClear}
          title="Clear selection"
          type="button"
        >
          Esc
        </button>
      </div>

      {panel ? (
        <div
          aria-busy={pending}
          aria-label={
            panel === "move" ? "Move selected Frames" : "Tag selected Frames"
          }
          className="v7-selection-action-panel"
          onKeyDown={closePanelOnEscape}
          ref={panelRef}
          role="dialog"
        >
          <header>
            <strong>
              {panel === "move" ? "Move to Fragment" : "Add a tag"}
            </strong>
            <span>{count} selected</span>
          </header>
          {panel === "move" ? (
            <div className="v7-selection-destinations">
              {frames.map((frame) => (
                <button
                  disabled={pending}
                  key={frame.id}
                  onClick={() => void runAction(() => onMove(frame.id))}
                  type="button"
                >
                  {frame.name}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="v7-selection-tag-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitTag(tagDraft);
              }}
            >
              <div>
                <input
                  aria-label="Tag name"
                  autoComplete="off"
                  disabled={pending}
                  onChange={(event) => {
                    setTagDraft(event.target.value);
                    setActionError(null);
                  }}
                  placeholder="Editorial, motion, color…"
                  ref={tagInputRef}
                  value={tagDraft}
                />
                <button disabled={pending} type="submit">
                  {pending ? "Adding…" : "Add"}
                </button>
              </div>
              {knownTags.length > 0 ? (
                <div
                  aria-label="Existing tags"
                  className="v7-selection-tag-suggestions"
                >
                  {knownTags.slice(0, 8).map((tag) => (
                    <button
                      disabled={pending}
                      key={tag}
                      onClick={() => submitTag(tag)}
                      type="button"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          )}
          {actionError ? <span role="alert">{actionError}</span> : null}
        </div>
      ) : null}
    </>
  );
}
