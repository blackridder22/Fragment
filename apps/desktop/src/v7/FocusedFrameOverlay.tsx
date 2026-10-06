import type { ColorFilter, Fragment, Frame } from "@fragment/shared";
import { PaletteSection } from "../features/colors/PaletteSection";
import { SvgPreview } from "../features/fragments/SvgPreview";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeFragmentTitle } from "../features/fragments/fragment-title-policy";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  matchesShortcut,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";
import type { AssetSource } from "../lib/assets";
import { perfMark } from "../lib/perf";
import "../styles/v7-preview.css";
import {
  compactSource,
  formatMetadata,
  isEditableTarget,
  sourceName,
} from "./focused-frame-format";
import { FocusedTagsSection } from "./FocusedTagsSection";

type MaybeAsyncAction = () => void | Promise<void>;

export type FocusedFrameOverlayProps = {
  assetRoot?: string;
  showPalette?: boolean;
  onFindColor?: (color: ColorFilter) => void;
  fragment: Fragment;
  frames: Frame[];
  tags: string[];
  assetSources: AssetSource[];
  currentIndex: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  closeShortcut?: ShortcutBinding;
  shortcutCloseDisabled?: boolean;
  actionsOpen?: boolean;
  tagsLoading?: boolean;
  onFrameChange?: (frameId: string) => void | Promise<void>;
  onMoreActions?: (anchor: { x: number; y: number }) => void;
  onNotesChange?: (notes: string) => void | Promise<void>;
  onTitleChange?: (title: string) => void | Promise<void>;
  onTagsChange?: (tags: string[]) => void | Promise<void>;
  onReveal?: MaybeAsyncAction;
  onOpenSource?: MaybeAsyncAction;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
};

function markOverlayImageLoad() {
  perfMark("overlay-image-load", "overlay-mount");
}

export function FocusedFrameOverlay({
  assetRoot = "",
  showPalette = false,
  onFindColor,
  fragment,
  frames,
  tags,
  assetSources,
  currentIndex,
  total,
  onClose,
  onPrevious,
  onNext,
  closeShortcut = DEFAULT_SHORTCUT_BINDINGS.closeOverlay,
  shortcutCloseDisabled = false,
  actionsOpen = false,
  tagsLoading = false,
  onFrameChange,
  onMoreActions,
  onNotesChange,
  onTitleChange,
  onTagsChange,
  onReveal,
  onOpenSource,
  onAssetFallback,
}: FocusedFrameOverlayProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const attemptedFallbacks = useRef(new Set<string>());
  const [assetIndex, setAssetIndex] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(
    assetSources.length === 0,
  );
  const [noteDraft, setNoteDraft] = useState(fragment.note ?? "");
  const [frameChangePending, setFrameChangePending] = useState(false);
  const [titleEditorOpen, setTitleEditorOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(
    normalizeFragmentTitle(fragment.title ?? ""),
  );
  const [titleChangePending, setTitleChangePending] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const assetKey = useMemo(
    () =>
      assetSources
        .map((source) => `${source.url}\u0000${source.relativePath ?? ""}`)
        .join("\u0001"),
    [assetSources],
  );

  const activeSource = assetSources[assetIndex];
  const imageUrl = fallbackUrl ?? activeSource?.url ?? "";
  const activeFrame = frames.find((frame) => frame.id === fragment.frameId);
  const fragmentTitle =
    normalizeFragmentTitle(fragment.title ?? "") || "Untitled Fragment";
  const sourceUrl = fragment.sourceUrl ?? fragment.pageUrl ?? null;
  const safeTotal = Math.max(1, total);
  const displayIndex = Math.min(Math.max(currentIndex + 1, 1), safeTotal);
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex + 1 < total;

  useEffect(() => {
    perfMark("overlay-mount");
  }, []);

  useEffect(() => {
    attemptedFallbacks.current.clear();
    setAssetIndex(0);
    setFallbackUrl(null);
    setImageUnavailable(assetSources.length === 0);
  }, [assetKey, assetSources.length, fragment.id]);

  useEffect(() => {
    setNoteDraft(fragment.note ?? "");
  }, [fragment.id, fragment.note]);

  useEffect(() => {
    setTitleEditorOpen(false);
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTitleError(null);
  }, [fragment.id, fragment.title]);

  useEffect(() => {
    if (titleEditorOpen) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [titleEditorOpen]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!shortcutCloseDisabled && matchesShortcut(event, closeShortcut)) {
        event.preventDefault();
        onClose();
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault();
        onNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canGoNext,
    canGoPrevious,
    closeShortcut,
    onClose,
    onNext,
    onPrevious,
    shortcutCloseDisabled,
  ]);

  async function handleImageError() {
    const fallbackKey = `${fragment.id}:${assetIndex}:${activeSource?.relativePath ?? ""}`;

    if (
      activeSource?.relativePath &&
      onAssetFallback &&
      !attemptedFallbacks.current.has(fallbackKey)
    ) {
      attemptedFallbacks.current.add(fallbackKey);
      const resolved = await onAssetFallback(activeSource.relativePath);
      if (resolved && resolved !== imageUrl) {
        setFallbackUrl(resolved);
        return;
      }
    }

    if (assetIndex + 1 < assetSources.length) {
      setAssetIndex((index) => index + 1);
      setFallbackUrl(null);
      return;
    }

    setImageUnavailable(true);
  }

  function commitNotes() {
    if (noteDraft !== (fragment.note ?? "")) {
      void onNotesChange?.(noteDraft);
    }
  }

  function beginTitleEdit() {
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTitleError(null);
    setTitleEditorOpen(true);
  }

  function cancelTitleEdit() {
    if (titleChangePending) return;
    setTitleDraft(normalizeFragmentTitle(fragment.title ?? ""));
    setTitleError(null);
    setTitleEditorOpen(false);
  }

  async function saveTitle() {
    if (!onTitleChange || titleChangePending) return;

    const nextTitle = normalizeFragmentTitle(titleDraft);
    if (!nextTitle) {
      setTitleError("Enter a title before saving.");
      return;
    }

    const currentTitle = normalizeFragmentTitle(fragment.title ?? "");
    setTitleDraft(nextTitle);
    setTitleError(null);
    if (nextTitle === currentTitle) {
      setTitleEditorOpen(false);
      return;
    }

    setTitleChangePending(true);
    try {
      await onTitleChange(nextTitle);
      setTitleEditorOpen(false);
    } catch (caught) {
      setTitleError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTitleChangePending(false);
    }
  }

  async function changeFrame(frameId: string) {
    if (!onFrameChange || frameId === fragment.frameId || frameChangePending) {
      return;
    }
    setFrameChangePending(true);
    try {
      await onFrameChange(frameId);
    } finally {
      setFrameChangePending(false);
    }
  }

  return (
    <div
      aria-label={`Focused Fragment preview: ${fragmentTitle}`}
      aria-modal="true"
      className="v7-focused-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="dialog"
    >
      <header className="v7-focused-topbar">
        <nav aria-label="Fragment location" className="v7-focused-breadcrumbs">
          <span>Vault</span>
          <span aria-hidden="true">/</span>
          <span>{activeFrame?.name ?? "Vault"}</span>
          <span aria-hidden="true">/</span>
          <strong>{fragmentTitle}</strong>
        </nav>
        <button
          aria-label="Close focused preview"
          className="v7-focused-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </header>

      <div
        className="v7-focused-stage"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <section
          className="v7-focused-preview-pane"
          aria-label="Fragment image"
        >
          <div className="v7-focused-image-stage">
            {fragment.mimeType === "image/svg+xml" && assetRoot ? (
              <SvgPreview
                key={fragment.id}
                fragment={fragment}
                assetRoot={assetRoot}
                initialUrl={imageUrl}
              />
            ) : imageUnavailable ? (
              <div className="v7-focused-image-fallback">
                <ImageOff aria-hidden="true" size={30} strokeWidth={1.6} />
                <strong>Preview unavailable</strong>
                <span>The original Fragment could not be displayed.</span>
              </div>
            ) : (
              <img
                alt={fragmentTitle}
                decoding="async"
                draggable={false}
                onError={() => void handleImageError()}
                onLoad={markOverlayImageLoad}
                src={imageUrl}
              />
            )}
          </div>

          <nav
            aria-label="Fragment preview navigation"
            className="v7-focused-nav"
          >
            <button
              aria-label="Previous Fragment"
              disabled={!canGoPrevious}
              onClick={onPrevious}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
            <span aria-live="polite" className="v7-focused-counter">
              <strong>{displayIndex}</strong>
              <span aria-hidden="true">/</span>
              <strong>{safeTotal}</strong>
            </span>
            <button
              aria-label="Next Fragment"
              disabled={!canGoNext}
              onClick={onNext}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </nav>
        </section>

        <aside className="v7-focused-details" aria-label="Fragment details">
          <header className="v7-focused-details-header">
            <div className="v7-focused-title-row">
              {titleEditorOpen ? (
                <form
                  aria-busy={titleChangePending}
                  className="v7-focused-title-editor"
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelTitleEdit();
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTitle();
                  }}
                >
                  <div className="v7-focused-title-editor-controls">
                    <input
                      aria-describedby={
                        titleError ? "v7-focused-title-error" : undefined
                      }
                      aria-invalid={Boolean(titleError)}
                      aria-label="Fragment title"
                      autoComplete="off"
                      disabled={titleChangePending}
                      onChange={(event) => {
                        setTitleDraft(event.target.value);
                        if (titleError) setTitleError(null);
                      }}
                      placeholder="Untitled Fragment"
                      ref={titleInputRef}
                      value={titleDraft}
                    />
                    <button disabled={titleChangePending} type="submit">
                      {titleChangePending ? "Saving…" : "Save"}
                    </button>
                    <button
                      disabled={titleChangePending}
                      onClick={cancelTitleEdit}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                  {titleError ? (
                    <span id="v7-focused-title-error" role="alert">
                      {titleError}
                    </span>
                  ) : null}
                </form>
              ) : (
                <>
                  <div className="v7-focused-title-display">
                    <h2 title={fragmentTitle}>{fragmentTitle}</h2>
                    {onTitleChange ? (
                      <button
                        aria-label="Edit Fragment title"
                        className="v7-focused-title-edit"
                        onClick={beginTitleEdit}
                        title="Edit title"
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={16} strokeWidth={2} />
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
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      onMoreActions?.({
                        x: bounds.right,
                        y: bounds.bottom + 6,
                      });
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <MoreHorizontal
                      aria-hidden="true"
                      size={16}
                      strokeWidth={2}
                    />
                  </button>
                </>
              )}
            </div>
            <span className="v7-focused-metadata">
              {formatMetadata(fragment)}
            </span>
          </header>

          <div className="v7-focused-details-body">
            {showPalette ? (
              <PaletteSection
                key={fragment.id}
                id={fragment.id}
                onFindColor={onFindColor}
              />
            ) : null}
            <section className="v7-focused-detail-section">
              <label className="v7-focused-label" htmlFor="v7-frame-fragment">
                Frame
              </label>
              <div className="v7-focused-select-wrap">
                <select
                  aria-busy={frameChangePending}
                  disabled={!onFrameChange || frameChangePending}
                  id="v7-frame-fragment"
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
              <strong>{sourceName(fragment, sourceUrl)}</strong>
              {sourceUrl ? (
                <button
                  disabled={!onOpenSource}
                  onClick={() => void onOpenSource?.()}
                  type="button"
                >
                  {compactSource(sourceUrl)}
                </button>
              ) : (
                <span className="v7-focused-empty-detail">Local import</span>
              )}
            </section>

            <FocusedTagsSection
              fragmentId={fragment.id}
              onTagsChange={onTagsChange}
              tags={tags}
              tagsLoading={tagsLoading}
            />

            <section className="v7-focused-notes">
              <label className="v7-focused-label" htmlFor="v7-frame-notes">
                Notes
              </label>
              <textarea
                id="v7-frame-notes"
                onBlur={commitNotes}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add notes about this Fragment…"
                readOnly={!onNotesChange}
                value={noteDraft}
              />
            </section>
          </div>

          <footer className="v7-focused-actions">
            <button
              disabled={!onReveal}
              onClick={() => void onReveal?.()}
              type="button"
            >
              Reveal
            </button>
            <button
              className="v7-focused-primary-action"
              disabled={!onOpenSource || !sourceUrl}
              onClick={() => void onOpenSource?.()}
              type="button"
            >
              Open Source
            </button>
          </footer>
        </aside>
      </div>
    </div>
  );
}
