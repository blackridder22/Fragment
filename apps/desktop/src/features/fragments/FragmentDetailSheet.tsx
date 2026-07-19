import { useEffect, useState } from "react";
import type { Fragment } from "@fragment/shared";
import {
  Clipboard,
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
  sharedReferenceCount = 1,
}: FragmentDetailSheetProps) {
  const [title, setTitle] = useState(fragment.title ?? "");
  const [note, setNote] = useState(fragment.note ?? "");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("Copy Image");
  const [previewFailed, setPreviewFailed] = useState(assetSources.length === 0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const assetKey = assetSources
    .map((source) => `${source.url}:${source.relativePath ?? ""}`)
    .join("\u0000");
  const assetSource = assetSources[previewIndex];
  const assetUrl = assetSource?.url ?? "";

  useEffect(() => {
    setTitle(fragment.title ?? "");
    setNote(fragment.note ?? "");
    setCopyStatus("Copy Image");
  }, [fragment]);

  useEffect(() => {
    setPreviewFailed(assetSources.length === 0);
    setPreviewIndex(0);
  }, [assetKey, assetSources.length, fragment]);

  async function save() {
    setBusy(true);
    try {
      await onSave(title.trim() || null, note.trim() || null);
    } finally {
      setBusy(false);
    }
  }

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
      window.setTimeout(() => setCopyStatus("Copy Image"), 1500);
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
      onClose={onClose}
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
              {copyStatus}
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
