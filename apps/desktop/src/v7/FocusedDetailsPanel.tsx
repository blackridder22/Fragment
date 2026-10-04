import type { ColorFilter, Fragment, Frame } from "@fragment/shared";
import {
  ChevronDown,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import { PaletteSection } from "../features/colors/PaletteSection";
import { normalizeFragmentTitle } from "../features/fragments/fragment-title-policy";
import {
  addTag,
  removeTag,
  suggestTags,
  tagValidationError,
} from "../features/tags/tag-editor-model";
import {
  compactSource,
  formatMetadata,
  formatProvenance,
  sourceName,
} from "./preview-details-format";

export type PreviewNotice = {
  tone: "success" | "error" | "info";
  message: string;
};

export type FocusedDetailsHandle = {
  /** True while the title editor or tag editor is open. */
  hasOpenEditor(): boolean;
  /** Closes the open editor; false when nothing was open. */
  closeEditor(): boolean;
  /** Saves the notes now and reports the outcome (Cmd+S). */
  saveNotes(): Promise<void>;
  /** Saves unsaved notes without waiting, before navigation or close. */
  flushNotes(): void;
};

type MaybeAsyncAction = () => void | Promise<void>;

export type FocusedDetailsPanelProps = {
  ref?: Ref<FocusedDetailsHandle>;
  fragment: Fragment;
  frames: Frame[];
  tags: string[];
  knownTags: string[];
  tagsLoading: boolean;
  actionsOpen: boolean;
  title: string;
  sourceUrl: string | null;
  showPalette: boolean;
  notice: PreviewNotice | null;
  onReport: (notice: PreviewNotice) => void;
  onFindColor?: (color: ColorFilter) => void;
  onFrameChange?: (frameId: string) => void | Promise<void>;
  onMoreActions?: (anchor: { x: number; y: number }) => void;
  onNotesChange?: (notes: string) => void | Promise<void>;
  onTitleChange?: (title: string) => void | Promise<void>;
  onTagsChange?: (tags: string[]) => void | Promise<void>;
  onReveal?: MaybeAsyncAction;
  onOpenSource?: MaybeAsyncAction;
};

const MAX_TAG_SUGGESTIONS = 6;

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

export function FocusedDetailsPanel({
  ref,
  fragment,
  frames,
  tags,
  knownTags,
  tagsLoading,
  actionsOpen,
  title,
  sourceUrl,
  showPalette,
  notice,
  onReport,
  onFindColor,
  onFrameChange,
  onMoreActions,
  onNotesChange,
  onTitleChange,
  onTagsChange,
  onReveal,
  onOpenSource,
}: FocusedDetailsPanelProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleEditButtonRef = useRef<HTMLButtonElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const tagAddButtonRef = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(false);
  const savedNote = useRef(fragment.note ?? "");
  const noteDraftRef = useRef(fragment.note ?? "");
  const noteFragmentId = useRef<string | null>(null);
  const titleOpenRef = useRef(false);
  const tagOpenRef = useRef(false);

  const [titleEditorOpen, setTitleEditorOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(
    normalizeFragmentTitle(fragment.title ?? ""),
  );
  const [titlePending, setTitlePending] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagPending, setTagPending] = useState(false);
  const [noteDraft, setNoteDraft] = useState(fragment.note ?? "");
  const [notePending, setNotePending] = useState(false);
  const [framePending, setFramePending] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const [revealPending, setRevealPending] = useState(false);

  const activeFrame = frames.find((frame) => frame.id === fragment.frameId);
  const noteDirty = noteDraft !== savedNote.current;
  const suggestions = tagEditorOpen
    ? suggestTags(knownTags, tags, tagDraft, MAX_TAG_SUGGESTIONS)
    : [];

  useLayoutEffect(() => {
    noteDraftRef.current = noteDraft;
    titleOpenRef.current = titleEditorOpen;
    tagOpenRef.current = tagEditorOpen;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const incoming = fragment.note ?? "";
    const changedFragment = noteFragmentId.current !== fragment.id;
    if (changedFragment || noteDraftRef.current === savedNote.current) {
      setNoteDraft(incoming);
    }
    savedNote.current = incoming;
    noteFragmentId.current = fragment.id;
  }, [fragment.id, fragment.note]);

  useEffect(() => {
    setTitleEditorOpen(false);
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTagEditorOpen(false);
    setTagDraft("");
  }, [fragment.id, fragment.title]);

  useEffect(() => {
    if (titleEditorOpen) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [titleEditorOpen]);

  useEffect(() => {
    if (tagEditorOpen) tagInputRef.current?.focus();
  }, [tagEditorOpen]);

  const saveNotes = useCallback(
    async (reason: "blur" | "shortcut" | "flush") => {
      if (!onNotesChange) return;
      const draft = noteDraftRef.current;
      if (draft === savedNote.current) {
        if (reason === "shortcut") {
          onReport({ tone: "info", message: "Notes are up to date" });
        }
        return;
      }
      if (mounted.current) setNotePending(true);
      try {
        await onNotesChange(draft);
        savedNote.current = draft;
        onReport({ tone: "success", message: "Saved" });
      } catch (caught) {
        onReport({
          tone: "error",
          message: `Notes could not be saved: ${errorMessage(caught)}`,
        });
      } finally {
        if (mounted.current) setNotePending(false);
      }
    },
    [onNotesChange, onReport],
  );

  function beginTitleEdit() {
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTitleEditorOpen(true);
  }

  function cancelTitleEdit() {
    if (titlePending) return;
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTitleEditorOpen(false);
    titleEditButtonRef.current?.focus();
  }

  async function saveTitle() {
    if (!onTitleChange || titlePending) return;
    const nextTitle = normalizeFragmentTitle(titleDraft);
    if (!nextTitle) {
      onReport({ tone: "error", message: "Enter a title before saving." });
      titleInputRef.current?.focus();
      return;
    }
    const currentTitle = normalizeFragmentTitle(fragment.title ?? "");
    setTitleDraft(nextTitle);
    if (nextTitle === currentTitle) {
      setTitleEditorOpen(false);
      return;
    }
    setTitlePending(true);
    try {
      await onTitleChange(nextTitle);
      if (!mounted.current) return;
      setTitleEditorOpen(false);
      onReport({ tone: "success", message: "Title saved" });
    } catch (caught) {
      onReport({ tone: "error", message: errorMessage(caught) });
    } finally {
      if (mounted.current) setTitlePending(false);
    }
  }

  function closeTagEditor(restoreFocus = true) {
    setTagDraft("");
    setTagEditorOpen(false);
    if (restoreFocus) tagAddButtonRef.current?.focus();
  }

  async function persistTags(nextTags: string[], success: string) {
    if (!onTagsChange || tagPending || tagsLoading) return false;
    setTagPending(true);
    try {
      await onTagsChange(nextTags);
      onReport({ tone: "success", message: success });
      return true;
    } catch (caught) {
      onReport({ tone: "error", message: errorMessage(caught) });
      return false;
    } finally {
      if (mounted.current) setTagPending(false);
    }
  }

  async function addTagValue(value: string) {
    const validationError = tagValidationError(tags, value);
    if (validationError) {
      onReport({ tone: "error", message: validationError });
      return;
    }
    const nextTags = addTag(tags, value);
    const unchanged =
      nextTags.length === tags.length &&
      nextTags.every((tag, index) => tag === tags[index]);
    if (unchanged) {
      onReport({
        tone: "info",
        message: "That tag is already on this Fragment",
      });
      setTagDraft("");
      return;
    }
    if (await persistTags(nextTags, `Added “${value.trim()}”`)) {
      setTagDraft("");
      tagInputRef.current?.focus();
    }
  }

  async function removeTagValue(tag: string) {
    await persistTags(removeTag(tags, tag), `Removed “${tag}”`);
  }

  async function changeFrame(frameId: string) {
    if (!onFrameChange || frameId === fragment.frameId || framePending) return;
    const target = frames.find((frame) => frame.id === frameId);
    setFramePending(true);
    try {
      await onFrameChange(frameId);
      onReport({
        tone: "success",
        message: `Moved to ${target?.name ?? "Frame"}`,
      });
    } catch (caught) {
      onReport({
        tone: "error",
        message: `Move failed: ${errorMessage(caught)}`,
      });
    } finally {
      if (mounted.current) setFramePending(false);
    }
  }

  async function runAction(
    action: MaybeAsyncAction | undefined,
    setPending: (pending: boolean) => void,
    failure: string,
  ) {
    if (!action) return;
    setPending(true);
    try {
      await action();
    } catch (caught) {
      onReport({
        tone: "error",
        message: `${failure}: ${errorMessage(caught)}`,
      });
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  useImperativeHandle(ref, () => ({
    hasOpenEditor: () => titleOpenRef.current || tagOpenRef.current,
    closeEditor: () => {
      if (titleOpenRef.current) {
        cancelTitleEdit();
        return true;
      }
      if (tagOpenRef.current) {
        closeTagEditor();
        return true;
      }
      return false;
    },
    saveNotes: () => saveNotes("shortcut"),
    flushNotes: () => {
      void saveNotes("flush");
    },
  }));

  const sourceLabel = sourceName(fragment, sourceUrl);

  return (
    <aside className="v7-focused-details" aria-label="Fragment details">
      <header className="v7-focused-details-header">
        <div className="v7-focused-title-row">
          {titleEditorOpen ? (
            <form
              aria-busy={titlePending}
              className="v7-focused-title-editor"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelTitleEdit();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void saveTitle();
              }}
            >
              <input
                aria-label="Fragment title"
                autoComplete="off"
                disabled={titlePending}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder="Untitled Fragment"
                ref={titleInputRef}
                value={titleDraft}
              />
              <button disabled={titlePending} type="submit">
                {titlePending ? "Saving…" : "Save"}
              </button>
              <button
                aria-label="Cancel editing title"
                disabled={titlePending}
                onClick={cancelTitleEdit}
                type="button"
              >
                <X aria-hidden="true" size={12} strokeWidth={1.8} />
              </button>
            </form>
          ) : (
            <>
              <div className="v7-focused-title-display">
                <h2 title={title}>{title}</h2>
                {onTitleChange ? (
                  <button
                    aria-label="Edit Fragment title"
                    className="v7-focused-title-edit"
                    onClick={beginTitleEdit}
                    ref={titleEditButtonRef}
                    title="Edit title"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={15} strokeWidth={2} />
                  </button>
                ) : null}
              </div>
              <button
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
                aria-label="More Fragment actions"
                className="v7-focused-more"
                disabled={!onMoreActions}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onMoreActions?.({ x: bounds.right, y: bounds.bottom + 6 });
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <MoreHorizontal aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </>
          )}
        </div>
        <span className="v7-focused-metadata">{formatMetadata(fragment)}</span>
        <span className="v7-focused-metadata">
          {formatProvenance(fragment, sourceUrl)}
        </span>
        <span
          aria-live="polite"
          className="v7-focused-status"
          data-tone={notice?.tone ?? "idle"}
          role={notice?.tone === "error" ? "alert" : undefined}
        >
          {notice?.message ?? ""}
        </span>
      </header>

      <div className="v7-focused-details-body">
        {showPalette ? (
          <PaletteSection
            id={fragment.id}
            key={fragment.id}
            onFindColor={onFindColor}
            onNotify={onReport}
          />
        ) : null}

        <section className="v7-focused-detail-section">
          <label className="v7-focused-label" htmlFor="v7-fragment-frame">
            Frame
          </label>
          <div className="v7-focused-select-wrap">
            <select
              aria-busy={framePending}
              disabled={!onFrameChange || framePending}
              id="v7-fragment-frame"
              onChange={(event) => void changeFrame(event.target.value)}
              value={fragment.frameId}
            >
              {!activeFrame ? (
                <option value={fragment.frameId}>Vault</option>
              ) : null}
              {frames.map((frame) => (
                <option key={frame.id} value={frame.id}>
                  {frame.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={13} strokeWidth={1.7} />
          </div>
        </section>

        <section className="v7-focused-detail-section v7-focused-source">
          <span className="v7-focused-label">Source</span>
          {sourceUrl ? (
            <button
              aria-busy={sourcePending}
              className="v7-focused-source-link"
              disabled={!onOpenSource || sourcePending}
              onClick={() =>
                void runAction(
                  onOpenSource,
                  setSourcePending,
                  "Source could not be opened",
                )
              }
              title={sourceUrl}
              type="button"
            >
              <strong>{sourceLabel}</strong>
              <span>{compactSource(sourceUrl)}</span>
              <ExternalLink aria-hidden="true" size={12} strokeWidth={1.8} />
            </button>
          ) : (
            <>
              <strong>{sourceLabel}</strong>
              <span className="v7-focused-empty-detail">No source URL</span>
            </>
          )}
        </section>

        <section className="v7-focused-detail-section">
          <span className="v7-focused-label">Tags</span>
          <div className="v7-focused-tags">
            {tags.map((tag) => (
              <button
                aria-label={`Remove tag ${tag}`}
                className="v7-focused-tag"
                disabled={!onTagsChange || tagPending || tagsLoading}
                key={tag}
                onClick={() => void removeTagValue(tag)}
                title={`Remove ${tag}`}
                type="button"
              >
                <span>{tag}</span>
                <X aria-hidden="true" size={11} strokeWidth={1.8} />
              </button>
            ))}
            {tagEditorOpen ? (
              <form
                aria-busy={tagPending}
                className="v7-focused-tag-editor"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeTagEditor();
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void addTagValue(tagDraft);
                }}
              >
                <input
                  aria-label="Tag name"
                  autoComplete="off"
                  disabled={tagPending || tagsLoading}
                  list={undefined}
                  onChange={(event) => setTagDraft(event.target.value)}
                  placeholder="Tag name"
                  ref={tagInputRef}
                  value={tagDraft}
                />
                <button disabled={tagPending || tagsLoading} type="submit">
                  Add
                </button>
                <button
                  aria-label="Cancel adding tag"
                  disabled={tagPending}
                  onClick={() => closeTagEditor()}
                  type="button"
                >
                  <X aria-hidden="true" size={12} strokeWidth={1.8} />
                </button>
              </form>
            ) : (
              <button
                className="v7-focused-tag v7-focused-tag-add"
                disabled={!onTagsChange || tagsLoading}
                onClick={() => setTagEditorOpen(true)}
                ref={tagAddButtonRef}
                type="button"
              >
                {tagsLoading ? "Loading…" : "+ Add"}
              </button>
            )}
          </div>
          {tagEditorOpen && suggestions.length > 0 ? (
            <div
              aria-label="Tag suggestions"
              className="v7-focused-tag-suggestions"
              role="group"
            >
              {suggestions.map((tag) => (
                <button
                  disabled={tagPending || tagsLoading}
                  key={tag}
                  onClick={() => void addTagValue(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="v7-focused-notes">
          <div className="v7-focused-notes-head">
            <label className="v7-focused-label" htmlFor="v7-fragment-notes">
              Notes
            </label>
            <span
              aria-live="polite"
              className="v7-focused-hint"
              data-dirty={noteDirty}
            >
              {notePending
                ? "Saving…"
                : noteDirty
                  ? "Unsaved · ⌘S or click away to save"
                  : ""}
            </span>
          </div>
          <textarea
            aria-busy={notePending}
            id="v7-fragment-notes"
            onBlur={() => void saveNotes("blur")}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Add notes about this Fragment…"
            readOnly={!onNotesChange}
            value={noteDraft}
          />
        </section>
      </div>

      <footer className="v7-focused-actions">
        <button
          aria-busy={revealPending}
          disabled={!onReveal || revealPending}
          onClick={() =>
            void runAction(onReveal, setRevealPending, "Reveal failed")
          }
          type="button"
        >
          Reveal Original
        </button>
        <button
          aria-busy={sourcePending}
          className="v7-focused-primary-action"
          disabled={!onOpenSource || !sourceUrl || sourcePending}
          onClick={() =>
            void runAction(
              onOpenSource,
              setSourcePending,
              "Source could not be opened",
            )
          }
          type="button"
        >
          Open Source
        </button>
      </footer>
    </aside>
  );
}
