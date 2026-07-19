import { useCallback, useEffect, useRef, useState } from "react";
import type { Fragment } from "@fragment/shared";
import {
  Clipboard,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Save,
  Trash2,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import type { AssetSource } from "../../lib/assets";
import { formatBytes, formatDate } from "../../lib/format";

type FragmentDetailSheetProps = {
  fragment: Fragment;
  assetSources: AssetSource[];
  transparentAsset: boolean;
  onClose: () => void;
  onAssetFallback?: (relativePath: string) => Promise<string | null>;
  onSave: (title: string | null, note: string | null) => Promise<void>;
  onReveal: () => Promise<void>;
  onOpenSource: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDeleteEverywhere?: () => Promise<void>;
  onNext?: () => void;
  onPrevious?: () => void;
  sharedReferenceCount?: number;
};

export function FragmentDetailSheet({
  fragment,
  assetSources,
  transparentAsset,
  onClose,
  onAssetFallback,
  onSave,
  onReveal,
  onOpenSource,
  onDelete,
  onDeleteEverywhere,
  onNext,
  onPrevious,
  sharedReferenceCount = 1,
}: FragmentDetailSheetProps) {
  const [title, setTitle] = useState(fragment.title ?? "");
  const [note, setNote] = useState(fragment.note ?? "");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("Copy Image");
  const [previewFailed, setPreviewFailed] = useState(assetSources.length === 0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const copyResetTimer = useRef<number | null>(null);
  const assetKey = assetSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const assetSource = assetSources[previewIndex];
  const assetUrl = assetSource?.url ?? "";
  const isDirty =
    title !== (fragment.title ?? "") || note !== (fragment.note ?? "");

  const save = useCallback(async () => {
    setBusy(true);
    try {
      await onSave(title.trim() || null, note.trim() || null);
    } finally {
      setBusy(false);
    }
  }, [note, onSave, title]);
  const confirmDiscard = useCallback(
    () =>
      !isDirty ||
      window.confirm("Discard the unsaved changes to this Fragment?"),
    [isDirty],
  );
  const requestClose = useCallback(() => {
    if (confirmDiscard()) {
      onClose();
    }
  }, [confirmDiscard, onClose]);
  const navigate = useCallback(
    (action: () => void) => {
      if (confirmDiscard()) {
        action();
      }
    },
    [confirmDiscard],
  );

  useEffect(() => {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
    setTitle(fragment.title ?? "");
    setNote(fragment.note ?? "");
    setCopyStatus("Copy Image");
  }, [fragment]);

  useEffect(() => {
    setPreviewFailed(assetSources.length === 0);
    setPreviewIndex(0);
  }, [assetKey, assetSources.length, fragment]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    function handleDetailNavigation(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!busy) {
          void save();
        }
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        navigate(onPrevious);
      } else if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        navigate(onNext);
      }
    }

    window.addEventListener("keydown", handleDetailNavigation);
    return () => window.removeEventListener("keydown", handleDetailNavigation);
  }, [busy, navigate, onNext, onPrevious, save]);

  async function copyImage() {
    if (!assetUrl) {
      setCopyStatus("No image");
      return;
    }
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      setCopyStatus("Unavailable");
      return;
    }

    setCopyStatus("Copying...");
    try {
      const response = await fetch(assetUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      setCopyStatus("Copied");
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(() => {
        copyResetTimer.current = null;
        setCopyStatus("Copy Image");
      }, 1500);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  const sourceLabel = sourceHost(fragment.sourceUrl ?? fragment.pageUrl);

  async function handlePreviewError() {
    if (assetSource?.relativePath && onAssetFallback) {
      const fallbackUrl = await onAssetFallback(assetSource.relativePath);
      if (fallbackUrl) {
        return;
      }
    }
    if (previewIndex + 1 < assetSources.length) {
      setPreviewIndex((current) => current + 1);
      return;
    }
    setPreviewFailed(true);
  }

  return (
    <Modal
      title="Fragment Details"
      className="fragment-detail-modal"
      headerActions={
        <div className="detail-navigation" aria-label="Fragment navigation">
          <button
            aria-label="Previous Fragment"
            className="icon-button"
            disabled={!onPrevious}
            onClick={() => (onPrevious ? navigate(onPrevious) : undefined)}
            title="Previous Fragment"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button
            aria-label="Next Fragment"
            className="icon-button"
            disabled={!onNext}
            onClick={() => (onNext ? navigate(onNext) : undefined)}
            title="Next Fragment"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      }
      onClose={requestClose}
    >
      <div className="detail-sheet">
        <div className="detail-preview" data-transparent={transparentAsset}>
          {previewFailed ? (
            <div className="fragment-image-fallback detail-fallback">
              <ImageOff size={26} />
              <strong>{fragment.title ?? "Fragment"}</strong>
            </div>
          ) : (
            <img
              src={assetUrl}
              alt={fragment.title ?? "Selected Fragment"}
              decoding="async"
              onError={handlePreviewError}
            />
          )}
        </div>
        <div className="detail-fields">
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled Fragment"
            />
          </label>
          <label>
            Note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note"
              rows={6}
            />
          </label>
          <dl className="detail-metadata">
            <div>
              <dt>Dimensions</dt>
              <dd>
                {fragment.width && fragment.height
                  ? `${fragment.width} x ${fragment.height}`
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>{formatBytes(fragment.fileSize)}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>{formatDate(fragment.capturedAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{sourceLabel ?? "Local import"}</dd>
            </div>
          </dl>
          <div className="detail-actions">
            <button className="button" onClick={copyImage} type="button">
              <Clipboard size={16} />
              <span aria-live="polite">{copyStatus}</span>
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={save}
              type="button"
            >
              <Save size={16} />
              Save
            </button>
            <button className="button" onClick={onReveal} type="button">
              <FolderOpen size={16} />
              Reveal Original
            </button>
            <button
              className="button"
              disabled={!fragment.sourceUrl && !fragment.pageUrl}
              onClick={onOpenSource}
              type="button"
            >
              <ExternalLink size={16} />
              Open Source
            </button>
            <button className="button danger" onClick={onDelete} type="button">
              <Trash2 size={16} />
              {sharedReferenceCount > 1 ? "Remove from Frame" : "Delete"}
            </button>
            {sharedReferenceCount > 1 && onDeleteEverywhere ? (
              <button
                className="button danger"
                onClick={onDeleteEverywhere}
                type="button"
              >
                <Trash2 size={16} />
                Delete Everywhere
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function sourceHost(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
