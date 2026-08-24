import { SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_FRAGMENT_FILTER,
  activeFilterCount,
  normalizeFragmentFilter,
  type FragmentFilter,
} from "./filter-model";

type FilterPanelProps = {
  filter: FragmentFilter;
  knownTags: string[];
  onApply: (filter: FragmentFilter) => void;
  onClose: () => void;
  onSaveSmartFrame: (name: string, filter: FragmentFilter) => Promise<void>;
  smartFrameName?: string;
};

const FORMATS = [
  ["image/png", "PNG"],
  ["image/jpeg", "JPEG"],
  ["image/webp", "WebP"],
  ["image/gif", "GIF"],
] as const;

function numberValue(value: string) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : undefined;
}

export function FilterPanel({
  filter,
  knownTags,
  onApply,
  onClose,
  onSaveSmartFrame,
  smartFrameName,
}: FilterPanelProps) {
  const [draft, setDraft] = useState<FragmentFilter>(filter);
  const [smartName, setSmartName] = useState(smartFrameName ?? "");
  const [saving, setSaving] = useState(false);
  const tagSuggestions = useMemo(() => knownTags.slice(0, 16), [knownTags]);

  useEffect(() => setDraft(filter), [filter]);
  useEffect(() => setSmartName(smartFrameName ?? ""), [smartFrameName]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  function patch(next: Partial<FragmentFilter>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function toggleFormat(mimeType: string) {
    const current = new Set(draft.mimeTypes ?? []);
    if (current.has(mimeType)) current.delete(mimeType);
    else current.add(mimeType);
    patch({ mimeTypes: [...current] });
  }

  async function saveSmartFrame() {
    const name = smartName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onSaveSmartFrame(name, normalizeFragmentFilter(draft));
      if (!smartFrameName) setSmartName("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="filter-panel" aria-label="Filter Frames">
      <header>
        <div>
          <span className="filter-panel-kicker">
            <SlidersHorizontal aria-hidden="true" size={14} /> Retrieval
          </span>
          <h2>Filter Frames</h2>
        </div>
        <button
          aria-label="Close filters"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="filter-panel-scroll">
        <section className="filter-group">
          <strong>Identity</strong>
          <label>
            <span>Title contains</span>
            <input
              value={draft.titleContains ?? ""}
              onChange={(event) => patch({ titleContains: event.target.value })}
              placeholder="Poster, identity, texture…"
            />
          </label>
          <label>
            <span>Tags</span>
            <input
              value={(draft.tags ?? []).join(", ")}
              onChange={(event) =>
                patch({
                  tags: event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Editorial, Red, Type"
            />
          </label>
          {tagSuggestions.length > 0 ? (
            <div className="filter-tag-suggestions">
              {tagSuggestions.map((tag) => (
                <button
                  data-active={(draft.tags ?? []).includes(tag)}
                  key={tag}
                  onClick={() => {
                    const tags = new Set(draft.tags ?? []);
                    if (tags.has(tag)) tags.delete(tag);
                    else tags.add(tag);
                    patch({ tags: [...tags] });
                  }}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="filter-group">
          <strong>Source</strong>
          <div className="filter-grid-two">
            <label>
              <span>Origin</span>
              <select
                value={draft.sourceKind ?? "all"}
                onChange={(event) =>
                  patch({
                    sourceKind: event.target
                      .value as FragmentFilter["sourceKind"],
                  })
                }
              >
                <option value="all">Any</option>
                <option value="source">With source</option>
                <option value="local">Local only</option>
              </select>
            </label>
            <label>
              <span>Domain</span>
              <input
                value={draft.sourceDomain ?? ""}
                onChange={(event) =>
                  patch({ sourceDomain: event.target.value })
                }
                placeholder="are.na"
              />
            </label>
          </div>
          <div className="filter-grid-two">
            <label>
              <span>Site contains</span>
              <input
                value={draft.siteContains ?? ""}
                onChange={(event) =>
                  patch({ siteContains: event.target.value })
                }
              />
            </label>
            <label>
              <span>Creator contains</span>
              <input
                value={draft.creatorContains ?? ""}
                onChange={(event) =>
                  patch({ creatorContains: event.target.value })
                }
              />
            </label>
          </div>
        </section>

        <section className="filter-group">
          <strong>Image</strong>
          <div className="filter-format-options">
            {FORMATS.map(([mimeType, label]) => (
              <button
                data-active={(draft.mimeTypes ?? []).includes(mimeType)}
                key={mimeType}
                onClick={() => toggleFormat(mimeType)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            <span>Orientation</span>
            <select
              value={draft.orientation ?? "all"}
              onChange={(event) =>
                patch({
                  orientation: event.target
                    .value as FragmentFilter["orientation"],
                })
              }
            >
              <option value="all">Any</option>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
              <option value="square">Square</option>
            </select>
          </label>
          <div className="filter-grid-four">
            {(
              [
                ["Min W", "minWidth"],
                ["Max W", "maxWidth"],
                ["Min H", "minHeight"],
                ["Max H", "maxHeight"],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  min="0"
                  type="number"
                  value={draft[key] ?? ""}
                  onChange={(event) =>
                    patch({ [key]: numberValue(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div className="filter-grid-two">
            <label>
              <span>Min size (MB)</span>
              <input
                min="0"
                step="0.1"
                type="number"
                value={draft.minFileSize ? draft.minFileSize / 1_000_000 : ""}
                onChange={(event) =>
                  patch({
                    minFileSize: numberValue(event.target.value)
                      ? numberValue(event.target.value)! * 1_000_000
                      : undefined,
                  })
                }
              />
            </label>
            <label>
              <span>Max size (MB)</span>
              <input
                min="0"
                step="0.1"
                type="number"
                value={draft.maxFileSize ? draft.maxFileSize / 1_000_000 : ""}
                onChange={(event) =>
                  patch({
                    maxFileSize: numberValue(event.target.value)
                      ? numberValue(event.target.value)! * 1_000_000
                      : undefined,
                  })
                }
              />
            </label>
          </div>
        </section>

        <section className="filter-group">
          <strong>Details</strong>
          <div className="filter-grid-two">
            <label>
              <span>Captured after</span>
              <input
                type="date"
                value={draft.capturedAfter?.slice(0, 10) ?? ""}
                onChange={(event) =>
                  patch({ capturedAfter: event.target.value })
                }
              />
            </label>
            <label>
              <span>Captured before</span>
              <input
                type="date"
                value={draft.capturedBefore?.slice(0, 10) ?? ""}
                onChange={(event) =>
                  patch({ capturedBefore: event.target.value })
                }
              />
            </label>
          </div>
          <label>
            <span>Notes</span>
            <select
              value={
                draft.hasNotes === true
                  ? "yes"
                  : draft.hasNotes === false
                    ? "no"
                    : "any"
              }
              onChange={(event) =>
                patch({
                  hasNotes:
                    event.target.value === "yes"
                      ? true
                      : event.target.value === "no"
                        ? false
                        : undefined,
                })
              }
            >
              <option value="any">Any</option>
              <option value="yes">Has notes</option>
              <option value="no">No notes</option>
            </select>
          </label>
          <label>
            <span>Note contains</span>
            <input
              value={draft.noteContains ?? ""}
              onChange={(event) => patch({ noteContains: event.target.value })}
            />
          </label>
        </section>

        <section className="smart-frame-save">
          <span>
            <Sparkles aria-hidden="true" size={14} />{" "}
            {smartFrameName ? "Update this retrieval" : "Save this retrieval"}
          </span>
          <div>
            <input
              aria-label="Smart Fragment name"
              onChange={(event) => setSmartName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveSmartFrame();
              }}
              placeholder="Smart Fragment name"
              value={smartName}
            />
            <button
              className="button"
              disabled={!smartName.trim() || saving}
              onClick={() => void saveSmartFrame()}
              type="button"
            >
              {smartFrameName ? "Update" : "Save"}
            </button>
          </div>
          <small>Dynamic results; no Frame files are duplicated.</small>
        </section>
      </div>

      <footer>
        <button
          className="button"
          onClick={() => {
            setDraft(EMPTY_FRAGMENT_FILTER);
            onApply(EMPTY_FRAGMENT_FILTER);
          }}
          type="button"
        >
          Clear
        </button>
        <button
          className="button primary"
          onClick={() => onApply(normalizeFragmentFilter(draft))}
          type="button"
        >
          Apply{" "}
          {activeFilterCount(draft) > 0 ? `(${activeFilterCount(draft)})` : ""}
        </button>
      </footer>
    </aside>
  );
}
