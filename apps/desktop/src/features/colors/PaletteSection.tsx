import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { ColorFilter } from "@fragment/shared";
import { useFragmentPalette } from "./useFragmentPalette";
import "../../styles/colors-svg.css";

type PaletteNotice = {
  tone: "success" | "error" | "info";
  message: string;
};

export function PaletteSection({
  id,
  onFindColor,
  onNotify,
}: {
  id: string;
  onFindColor?: (color: ColorFilter) => void;
  /** Mirrors copy outcomes to the host feedback surface. */
  onNotify?: (notice: PaletteNotice) => void;
}) {
  const { palette, error, retryPalette } = useFragmentPalette(id);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setSelected(null);
    setCopied(null);
    setFeedback("");
  }, [id]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback("");
      setCopied(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const failed = error || palette?.status === "failed";
  function copyColor(hex: string) {
    setSelected(hex);
    void navigator.clipboard
      .writeText(hex)
      .then(() => {
        setCopied(hex);
        setFeedback(`Copied ${hex}`);
        onNotify?.({ tone: "success", message: `Copied ${hex}` });
      })
      .catch(() => {
        setCopied(null);
        setFeedback("Copy failed. Click the color to retry.");
        onNotify?.({ tone: "error", message: `Could not copy ${hex}` });
      });
  }
  return (
    <section
      className="v7-focused-detail-section fragment-colors"
      aria-label="Color palette"
    >
      <span className="v7-focused-label">Colors</span>
      {failed ? (
        <div className="fragment-color-status">
          <span>Colors could not be extracted.</span>
          <button type="button" onClick={() => void retryPalette()}>
            Retry
          </button>
        </div>
      ) : !palette || ["pending", "processing"].includes(palette.status) ? (
        <span className="v7-focused-empty-detail">Extracting colors…</span>
      ) : palette.status === "empty" ? (
        <span className="v7-focused-empty-detail">No visible colors</span>
      ) : (
        <>
          <div className="fragment-swatches">
            {palette.colors.map((color) => (
              <button
                key={color.hex}
                type="button"
                className="fragment-swatch"
                style={{ backgroundColor: color.hex }}
                aria-label={`Copy ${color.hex}, ${Math.round(color.coverage * 100)}%`}
                aria-pressed={selected === color.hex}
                data-copied={copied === color.hex}
                title={`${color.hex} · ${Math.round(color.coverage * 100)}%`}
                onClick={() => copyColor(color.hex)}
              >
                {copied === color.hex ? (
                  <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                ) : null}
              </button>
            ))}
          </div>
          <div className="fragment-color-status" aria-live="polite">
            {feedback || selected || "Click a color to copy HEX"}
          </div>
          {onFindColor ? (
            <button
              className="fragment-color-link"
              disabled={!selected}
              title={
                selected
                  ? `Show Fragments close to ${selected}`
                  : "Pick a color first"
              }
              type="button"
              onClick={() =>
                selected && onFindColor({ hex: selected, tolerance: 80 })
              }
            >
              Find this color
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
