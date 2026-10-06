import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  addTag,
  removeTag,
  tagValidationError,
} from "../features/tags/tag-editor-model";

export type FocusedTagsSectionProps = {
  fragmentId: string;
  tags: string[];
  tagsLoading?: boolean;
  onTagsChange?: (tags: string[]) => void | Promise<void>;
};

/** Tag chips with inline add/remove for the focused Fragment. */
export function FocusedTagsSection({
  fragmentId,
  tags,
  tagsLoading = false,
  onTagsChange,
}: FocusedTagsSectionProps) {
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagChangePending, setTagChangePending] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    setTagEditorOpen(false);
    setTagDraft("");
    setTagError(null);
  }, [fragmentId]);

  useEffect(() => {
    if (tagEditorOpen) tagInputRef.current?.focus();
  }, [tagEditorOpen]);

  async function persistTags(nextTags: string[]) {
    if (!onTagsChange || tagChangePending || tagsLoading) return false;

    setTagChangePending(true);
    setTagError(null);
    try {
      await onTagsChange(nextTags);
      return true;
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setTagChangePending(false);
    }
  }

  async function addTagFromDraft() {
    const validationError = tagValidationError(tags, tagDraft);
    if (validationError) {
      setTagError(validationError);
      return;
    }

    const nextTags = addTag(tags, tagDraft);
    const unchanged =
      nextTags.length === tags.length &&
      nextTags.every((tag, index) => tag === tags[index]);
    if (unchanged || (await persistTags(nextTags))) {
      setTagDraft("");
      setTagEditorOpen(false);
      setTagError(null);
    }
  }

  function closeEditor() {
    setTagDraft("");
    setTagEditorOpen(false);
    setTagError(null);
  }

  return (
    <section className="v7-focused-detail-section">
      <span className="v7-focused-label">Tags</span>
      <div className="v7-focused-tags">
        {tags.map((tag) => (
          <button
            aria-label={`Remove tag ${tag}`}
            className="v7-focused-tag"
            disabled={!onTagsChange || tagChangePending || tagsLoading}
            key={tag}
            onClick={() => void persistTags(removeTag(tags, tag))}
            title={`Remove ${tag}`}
            type="button"
          >
            <span>{tag}</span>
            <X aria-hidden="true" size={11} strokeWidth={1.8} />
          </button>
        ))}
        {tagEditorOpen ? (
          <form
            className="v7-focused-tag-editor"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                closeEditor();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void addTagFromDraft();
            }}
          >
            <input
              aria-label="Tag name"
              autoComplete="off"
              disabled={tagChangePending || tagsLoading}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder="Tag name"
              ref={tagInputRef}
              value={tagDraft}
            />
            <button disabled={tagChangePending || tagsLoading} type="submit">
              Add
            </button>
            <button
              aria-label="Cancel adding tag"
              disabled={tagChangePending}
              onClick={closeEditor}
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
            type="button"
          >
            {tagsLoading ? "Loading…" : "+ Add"}
          </button>
        )}
      </div>
      {tagError ? (
        <span className="v7-focused-tag-error" role="alert">
          {tagError}
        </span>
      ) : null}
    </section>
  );
}
