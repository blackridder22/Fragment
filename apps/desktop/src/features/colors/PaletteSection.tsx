import { useEffect, useState } from "react";
import type { ColorFilter } from "@fragment/shared";
import { useFragmentPalette } from "./useFragmentPalette";
import "../../styles/colors-svg.css";

export function PaletteSection({
  id,
  onFindColor,
}: {
  id: string;
  onFindColor?: (color: ColorFilter) => void;
}) {
  const { palette, error, retryPalette } = useFragmentPalette(id);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setSelected(null);
    setFeedback("");
  }, [id]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 2000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const failed = error || palette?.status === "failed";
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
                title={`${color.hex} · ${Math.round(color.coverage * 100)}%`}
                onClick={() => {
                  setSelected(color.hex);
                  void navigator.clipboard
                    .writeText(color.hex)
                    .then(() => setFeedback(`Copied ${color.hex}`))
                    .catch(() =>
                      setFeedback("Copy failed. Click the color to retry."),
                    );
                }}
              />
            ))}
          </div>
          <div className="fragment-color-status" aria-live="polite">
            {feedback || selected || "Click a color to copy HEX"}
          </div>
          {onFindColor ? (
            <button
              className="fragment-color-link"
              disabled={!selected}
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
