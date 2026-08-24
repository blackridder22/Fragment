import {
  Clipboard,
  ExternalLink,
  FolderInput,
  FolderOpen,
  ImageOff,
  Maximize2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Fragment, Frame } from "@fragment/shared";
import type { AssetSource } from "../../lib/assets";
import { formatBytes, formatDate } from "../../lib/format";
import {
  aspectRatioLabel,
  formatLabel,
  normalizeTagDraft,
  sourceDomain,
} from "./fragment-metadata";

type FragmentInspectorProps = {
  assetSources: AssetSource[];
  fragment: Fragment;
  frames: Frame[];
  tags: string[];
  onAddToFrame?: (frameId: string) => Promise<void>;
  onClose: () => void;
  onCopyImage?: () => Promise<void>;
  onOpenPreview: () => void;
  onOpenSource?: () => Promise<void>;
  onReveal?: () => Promise<void>;
  onSave: (title: string | null, note: string | null) => Promise<void>;
  onSaveTags: (tags: string[]) => Promise<void>;
  onTrash?: () => Promise<void>;
};

export function FragmentInspector({
  assetSources,
  fragment,
  frames,
  tags,
  onAddToFrame,
  onClose,
  onCopyImage,
  onOpenPreview,
  onOpenSource,
  onReveal,
  onSave,
  onSaveTags,
  onTrash,
}: FragmentInspectorProps) {
  const [title, setTitle] = useState(fragment.title ?? "");
  const [note, setNote] = useState(fragment.note ?? "");
  const [draftTags, setDraftTags] = useState(tags);
  const [tagInput, setTagInput] = useState("");
  const [destinationFrameId, setDestinationFrameId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(assetSources.length === 0);
  const previewUrl = assetSources[previewIndex]?.url ?? "";
  const sourceUrl = fragment.sourceUrl ?? fragment.pageUrl ?? null;
  const domain = sourceDomain(sourceUrl);
  const availableFrames = useMemo(
    () => frames.filter((frame) => frame.id !== fragment.frameId),
    [fragment.frameId, frames],
  );
  const tagsDirty =
    JSON.stringify(normalizeTagDraft(draftTags)) !==
    JSON.stringify(normalizeTagDraft(tags));
  const detailsDirty =
    title !== (fragment.title ?? "") || note !== (fragment.note ?? "");

  useEffect(() => {
    setTitle(fragment.title ?? "");
    setNote(fragment.note ?? "");
    setDraftTags(tags);
    setTagInput("");
    setDestinationFrameId("");
    setStatus("");
  }, [fragment, tags]);

  useEffect(() => {
    setPreviewIndex(0);
    setPreviewFailed(assetSources.length === 0);
  }, [assetSources, fragment.id]);

  function addTag(value = tagInput) {
    const next = normalizeTagDraft([...draftTags, value]);
    setDraftTags(next);
    setTagInput("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Backspace" && !tagInput && draftTags.length > 0) {
      setDraftTags((current) => current.slice(0, -1));
    }
  }

  async function save() {
    setBusy(true);
    setStatus("Saving");
    try {
      const pendingTags = tagInput
        ? normalizeTagDraft([...draftTags, tagInput])
        : normalizeTagDraft(draftTags);
      await Promise.all([
        detailsDirty
          ? onSave(title.trim() || null, note.trim() || null)
          : Promise.resolve(),
        tagsDirty || tagInput ? onSaveTags(pendingTags) : Promise.resolve(),
      ]);
      setDraftTags(pendingTags);
      setTagInput("");
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(label: string, action?: () => Promise<void>) {
    if (!action) return;
    setBusy(true);
    setStatus(label);
    try {
      await action();
      setStatus(`${label} done`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  function handlePreviewError() {
    if (previewIndex + 1 < assetSources.length) {
      setPreviewIndex((current) => current + 1);
    } else {
      setPreviewFailed(true);
    }
  }

  return (
    <aside className="fragment-inspector" aria-label="Frame inspector">
      <header className="fragment-inspector-header">
        <div>
          <span>Selection</span>
          <strong>Frame</strong>
        </div>
        <button
          aria-label="Close inspector"
          className="icon-button compact-icon"
          onClick={onClose}
          title="Close Inspector"
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <button
        className="fragment-inspector-preview"
        onClick={onOpenPreview}
        title="Open Frame Preview"
        type="button"
      >
        {previewFailed ? (
          <span className="fragment-image-fallback">
            <ImageOff aria-hidden="true" size={22} />
            <strong>{fragment.title ?? "Frame"}</strong>
          </span>
        ) : (
          <img
            alt={fragment.title ?? "Selected Frame"}
            onError={handlePreviewError}
            src={previewUrl}
          />
        )}
        <span>
          <Maximize2 aria-hidden="true" size={14} />
          Open Preview
        </span>
      </button>

      <div className="fragment-inspector-scroll">
        <section className="inspector-section inspector-edit-section">
          <label>
            <span>Title</span>
            <input
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add context that makes this Frame useful later"
              rows={4}
              value={note}
            />
          </label>

          <div className="inspector-tags-field">
            <span>Tags</span>
            <div className="inspector-tag-editor">
              {draftTags.map((tag) => (
                <button
                  aria-label={`Remove ${tag}`}
                  key={tag.toLocaleLowerCase()}
                  onClick={() =>
                    setDraftTags((current) =>
                      current.filter((item) => item !== tag),
                    )
                  }
                  title={`Remove ${tag}`}
                  type="button"
                >
                  {tag}
                  <X aria-hidden="true" size={11} />
                </button>
              ))}
              <input
                aria-label="Add tag"
                onBlur={() => (tagInput.trim() ? addTag() : undefined)}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={draftTags.length ? "Add" : "Add tags"}
                value={tagInput}
              />
              {tagInput ? (
                <button
                  aria-label="Add tag"
                  className="inspector-add-tag"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTag()}
                  type="button"
                >
                  <Plus aria-hidden="true" size={12} />
                </button>
              ) : null}
            </div>
          </div>

          <button
            className="button primary inspector-save"
            disabled={busy || (!detailsDirty && !tagsDirty && !tagInput)}
            onClick={() => void save()}
            type="button"
          >
            <Save aria-hidden="true" size={15} />
            <span>Save Metadata</span>
          </button>
        </section>

        <section className="inspector-section inspector-source-section">
          <div className="inspector-section-title">Source</div>
          {sourceUrl ? (
            <div className="inspector-source-card">
              <strong>{domain ?? fragment.siteName ?? "Source"}</strong>
              <span title={sourceUrl}>{sourceUrl}</span>
            </div>
          ) : (
            <p className="inspector-empty-copy">Local import · no source URL</p>
          )}
          {fragment.siteName || fragment.creatorName ? (
            <dl className="inspector-metadata-list compact">
              {fragment.siteName ? (
                <div>
                  <dt>Site</dt>
                  <dd>{fragment.siteName}</dd>
                </div>
              ) : null}
              {fragment.creatorName ? (
                <div>
                  <dt>Creator</dt>
                  <dd>{fragment.creatorName}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <button
            className="button compact"
            disabled={!onOpenSource || busy}
            onClick={() => void runAction("Opening Source", onOpenSource)}
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
            <span>Open Source</span>
          </button>
        </section>

        <section className="inspector-section">
          <div className="inspector-section-title">File</div>
          <dl className="inspector-metadata-list">
            <div>
              <dt>Format</dt>
              <dd>{formatLabel(fragment.mimeType, fragment.originalPath)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>
                {fragment.width && fragment.height
                  ? `${fragment.width} × ${fragment.height}`
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Aspect</dt>
              <dd>{aspectRatioLabel(fragment.width, fragment.height)}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(fragment.fileSize)}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{formatDate(fragment.createdAt)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDate(fragment.capturedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section inspector-actions-section">
          <div className="inspector-section-title">Actions</div>
          <div className="inspector-action-grid">
            <button
              className="button compact"
              disabled={!onCopyImage || busy}
              onClick={() => void runAction("Copying Image", onCopyImage)}
              type="button"
            >
              <Clipboard aria-hidden="true" size={14} />
              <span>Copy Image</span>
            </button>
            <button
              className="button compact"
              disabled={!onReveal || busy}
              onClick={() => void runAction("Revealing Original", onReveal)}
              type="button"
            >
              <FolderOpen aria-hidden="true" size={14} />
              <span>Reveal Original</span>
            </button>
          </div>

          <div className="inspector-add-frame">
            <select
              aria-label="Destination Fragment"
              onChange={(event) => setDestinationFrameId(event.target.value)}
              value={destinationFrameId}
            >
              <option value="">Add to Fragment…</option>
              {availableFrames.map((frame) => (
                <option key={frame.id} value={frame.id}>
                  {frame.name}
                </option>
              ))}
            </select>
            <button
              aria-label="Add to selected Fragment"
              className="icon-button compact-icon"
              disabled={!destinationFrameId || !onAddToFrame || busy}
              onClick={() =>
                void runAction("Adding to Fragment", async () => {
                  if (!onAddToFrame) return;
                  await onAddToFrame(destinationFrameId);
                  setDestinationFrameId("");
                })
              }
              type="button"
            >
              <FolderInput aria-hidden="true" size={15} />
            </button>
          </div>

          {onTrash ? (
            <button
              className="button compact danger inspector-trash"
              disabled={busy}
              onClick={() => void runAction("Moving to Trash", onTrash)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
              <span>Move to Trash</span>
            </button>
          ) : null}
        </section>

        <p className="inspector-status" aria-live="polite">
          {status}
        </p>
      </div>
    </aside>
  );
}
