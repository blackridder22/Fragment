import type { ColorFilter, Fragment, Frame } from "@fragment/shared";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { normalizeFragmentTitle } from "../features/fragments/fragment-title-policy";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBinding,
} from "../features/shortcuts/shortcut-model";
import type { AssetSource } from "../lib/assets";
import {
  FocusedDetailsPanel,
  type FocusedDetailsHandle,
  type PreviewNotice,
} from "./FocusedDetailsPanel";
import { FocusedPreviewStage } from "./FocusedPreviewStage";
import { isEditableElement, resolvePreviewKey } from "./preview-keyboard";
import {
  cardImageRect,
  focusCard,
  prefersReducedMotion,
  readDurationToken,
  type Rect,
} from "./preview-motion";
import {
  startPreviewPerf,
  type PreviewPerfKind,
  type PreviewPerfSession,
} from "./preview-perf";
import { createPreviewPrefetcher } from "./preview-prefetch";
import "../styles/v7-preview.css";

type MaybeAsyncAction = () => void | Promise<void>;

export type { PreviewNotice } from "./FocusedDetailsPanel";

export type FocusedFrameOverlayProps = {
  assetRoot?: string;
  showPalette?: boolean;
  onFindColor?: (color: ColorFilter) => void;
  fragment: Fragment;
  frames: Frame[];
  tags: string[];
  /** Tags across the Vault, offered as suggestions while adding a tag. */
  knownTags?: string[];
  /** Preview-first sources for the stage (preview, thumbnail, original). */
  assetSources: AssetSource[];
  /** Thumbnail-first sources, already decoded by the gallery. */
  thumbnailSources?: AssetSource[];
  /** Preview URLs of the next and previous Fragments, warmed after decode. */
  prefetchSources?: string[];
  /** Where the image box animates from when the gallery can supply it. */
  originRect?: Rect | null;
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
  onCopy?: MaybeAsyncAction;
  /** Moves the Fragment to Trash after the in-overlay confirmation. */
  onTrash?: () => boolean | void | Promise<boolean | void>;
  /** Mirrors every visible outcome to the host feedback surface. */
  onNotify?: (notice: PreviewNotice) => void;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
};

const NOTICE_TIMEOUT_MS = { success: 2200, info: 2600, error: 5200 } as const;
const CLOSE_FALLBACK_MS = 80;

function errorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : String(caught);
}

export function FocusedFrameOverlay({
  assetRoot = "",
  showPalette = false,
  onFindColor,
  fragment,
  frames,
  tags,
  knownTags = [],
  assetSources,
  thumbnailSources = [],
  prefetchSources = [],
  originRect: originRectProp = null,
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
  onCopy,
  onTrash,
  onNotify,
  onAssetFallback,
}: FocusedFrameOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<FocusedDetailsHandle | null>(null);
  const mounted = useRef(false);
  const closingRef = useRef(false);
  const finishedRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const confirmOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onNotifyRef = useRef(onNotify);
  const perfRef = useRef<PreviewPerfSession | null>(null);
  const perfFragmentRef = useRef<string | null>(null);
  const perfKindRef = useRef<PreviewPerfKind>("open");

  const [prefetcher] = useState(() => createPreviewPrefetcher());
  const [originRect] = useState<Rect | null>(
    () =>
      originRectProp ??
      (prefersReducedMotion() ? null : cardImageRect(fragment.id)),
  );
  const [closing, setClosing] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [busy, setBusy] = useState<"copy" | "trash" | null>(null);
  const [notice, setNotice] = useState<PreviewNotice | null>(null);

  const title =
    normalizeFragmentTitle(fragment.title ?? "") || "Untitled Fragment";
  const activeFrame = frames.find((frame) => frame.id === fragment.frameId);
  const sourceUrl = fragment.sourceUrl ?? fragment.pageUrl ?? null;
  const safeTotal = Math.max(1, total);
  const displayIndex = Math.min(Math.max(currentIndex + 1, 1), safeTotal);
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex + 1 < total;

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    onNotifyRef.current = onNotify;
    confirmOpenRef.current = confirmTrash;
  });

  // One timing session per Fragment shown, started before first paint.
  useLayoutEffect(() => {
    if (perfFragmentRef.current === fragment.id) return;
    perfFragmentRef.current = fragment.id;
    perfRef.current = startPreviewPerf(fragment.id, perfKindRef.current);
    perfKindRef.current = "navigate";
  }, [fragment.id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      prefetcher.cancel();
    };
  }, [prefetcher]);

  // Focus the dialog on open and return focus to the originating card on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const originId = fragment.id;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (focusCard(originId)) return;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
    // Runs once: the originating card is the one the overlay opened with.
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      NOTICE_TIMEOUT_MS[notice.tone],
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const report = useCallback((next: PreviewNotice) => {
    if (mounted.current) setNotice({ ...next });
    onNotifyRef.current?.(next);
  }, []);

  const finishClose = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    onCloseRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    detailsRef.current?.flushNotes();
    const root = rootRef.current;
    const duration = root ? readDurationToken(root, "--preview-dur-fast") : 0;
    if (duration <= 0) {
      finishClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(
      finishClose,
      duration + CLOSE_FALLBACK_MS,
    );
  }, [finishClose]);

  function handleAnimationEnd(event: ReactAnimationEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && closingRef.current) {
      finishClose();
    }
  }

  const navigate = useCallback(
    (direction: -1 | 1) => {
      if (closingRef.current) return;
      detailsRef.current?.flushNotes();
      if (direction < 0) onPrevious();
      else onNext();
    },
    [onNext, onPrevious],
  );

  const copyImage = useCallback(async () => {
    if (!onCopy || busy) return;
    setBusy("copy");
    try {
      await onCopy();
      report({ tone: "success", message: "Image copied" });
    } catch (caught) {
      report({
        tone: "error",
        message: `Copy failed: ${errorMessage(caught)}`,
      });
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [busy, onCopy, report]);

  const confirmMoveToTrash = useCallback(async () => {
    if (!onTrash || busy) return;
    setBusy("trash");
    try {
      const outcome = await onTrash();
      if (outcome === false) {
        report({ tone: "error", message: "Could not move to Trash" });
      } else {
        report({ tone: "success", message: "Moved to Trash" });
      }
    } catch (caught) {
      report({
        tone: "error",
        message: `Could not move to Trash: ${errorMessage(caught)}`,
      });
    } finally {
      if (mounted.current) {
        setBusy(null);
        setConfirmTrash(false);
        rootRef.current?.focus({ preventScroll: true });
      }
    }
  }, [busy, onTrash, report]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (closingRef.current) return;
      const action = resolvePreviewKey(event, {
        closeBinding: closeShortcut,
        closeDisabled: shortcutCloseDisabled,
        editing: isEditableElement(event.target),
        innerEditorOpen:
          confirmOpenRef.current ||
          (detailsRef.current?.hasOpenEditor() ?? false),
        canGoPrevious,
        canGoNext,
        canCopy: Boolean(onCopy),
        canTrash: Boolean(onTrash),
        canSaveNotes: Boolean(onNotesChange),
      });
      if (action === "none") return;
      event.preventDefault();
      switch (action) {
        case "close":
          requestClose();
          break;
        case "close-editor":
          if (confirmOpenRef.current) {
            setConfirmTrash(false);
            rootRef.current?.focus({ preventScroll: true });
          } else {
            detailsRef.current?.closeEditor();
          }
          break;
        case "previous":
          navigate(-1);
          break;
        case "next":
          navigate(1);
          break;
        case "copy":
          void copyImage();
          break;
        case "trash":
          setConfirmTrash(true);
          break;
        case "save-notes":
          void detailsRef.current?.saveNotes();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canGoNext,
    canGoPrevious,
    closeShortcut,
    copyImage,
    navigate,
    onCopy,
    onNotesChange,
    onTrash,
    requestClose,
    shortcutCloseDisabled,
  ]);

  return (
    <div
      aria-label={`Fragment preview: ${title}`}
      aria-modal="true"
      className="v7-focused-overlay"
      data-flip={originRect ? "true" : undefined}
      data-state={closing ? "closing" : "open"}
      onAnimationEnd={handleAnimationEnd}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) requestClose();
      }}
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      <header className="v7-focused-topbar">
        <nav aria-label="Fragment location" className="v7-focused-breadcrumbs">
          <span>Frames</span>
          <span aria-hidden="true">/</span>
          <span>{activeFrame?.name ?? "Vault"}</span>
          <span aria-hidden="true">/</span>
          <strong>{title}</strong>
        </nav>
        <button
          aria-label="Close preview"
          className="v7-focused-close"
          onClick={requestClose}
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
          aria-label="Fragment image"
          className="v7-focused-preview-pane"
        >
          <FocusedPreviewStage
            assetRoot={assetRoot}
            assetSources={assetSources}
            fragment={fragment}
            onAssetFallback={onAssetFallback}
            originRect={originRect}
            perfRef={perfRef}
            prefetchSources={prefetchSources}
            prefetcher={prefetcher}
            thumbnailSources={thumbnailSources}
            title={title}
          />

          <nav
            aria-label="Fragment preview navigation"
            className="v7-focused-nav"
          >
            <button
              aria-label="Previous Fragment"
              disabled={!canGoPrevious}
              onClick={() => navigate(-1)}
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
              onClick={() => navigate(1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </nav>
        </section>

        <FocusedDetailsPanel
          actionsOpen={actionsOpen}
          fragment={fragment}
          frames={frames}
          knownTags={knownTags}
          notice={notice}
          onFindColor={onFindColor}
          onFrameChange={onFrameChange}
          onMoreActions={onMoreActions}
          onNotesChange={onNotesChange}
          onOpenSource={onOpenSource}
          onReport={report}
          onReveal={onReveal}
          onTagsChange={onTagsChange}
          onTitleChange={onTitleChange}
          ref={detailsRef}
          showPalette={showPalette}
          sourceUrl={sourceUrl}
          tags={tags}
          tagsLoading={tagsLoading}
          title={title}
        />
      </div>

      {confirmTrash ? (
        <TrashConfirm
          busy={busy === "trash"}
          onCancel={() => {
            setConfirmTrash(false);
            rootRef.current?.focus({ preventScroll: true });
          }}
          onConfirm={() => void confirmMoveToTrash()}
          title={title}
        />
      ) : null}
    </div>
  );
}

function TrashConfirm({
  busy,
  onCancel,
  onConfirm,
  title,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const active = document.activeElement;
    if (event.shiftKey && active === cancelRef.current) {
      event.preventDefault();
      confirmRef.current?.focus();
    } else if (!event.shiftKey && active === confirmRef.current) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  }

  return (
    <div
      className="v7-focused-confirm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div
        aria-busy={busy}
        aria-describedby="v7-focused-confirm-copy"
        aria-labelledby="v7-focused-confirm-title"
        aria-modal="true"
        className="v7-focused-confirm-card"
        onKeyDown={trapTab}
        role="alertdialog"
      >
        <h3 id="v7-focused-confirm-title">Move to Trash?</h3>
        <p id="v7-focused-confirm-copy">
          “{title}” moves to Trash. You can restore it from there.
        </p>
        <div className="v7-focused-confirm-actions">
          <button
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="v7-focused-confirm-danger"
            disabled={busy}
            onClick={onConfirm}
            ref={confirmRef}
            type="button"
          >
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
