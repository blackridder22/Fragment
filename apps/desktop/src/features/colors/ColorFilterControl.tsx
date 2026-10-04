import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { normalizeHex, type ColorFilter } from "@fragment/shared";
import "../../styles/colors-svg.css";

export function ColorFilterControl({
  value,
  onChange,
}: {
  value?: ColorFilter | null;
  onChange: (value: ColorFilter | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value?.hex ?? "#E66B54");
  const [tolerance, setTolerance] = useState(value?.tolerance ?? 80);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    setHex(value?.hex ?? "#E66B54");
    setTolerance(value?.tolerance ?? 80);
    setError("");
    input.current?.focus();
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, value]);
  return (
    <div className="v7-filter-control fragment-color-control" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="v7-filter-pill"
        data-active={Boolean(value)}
        data-expanded={open}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        {value ? (
          <span
            className="fragment-color-dot"
            style={{ backgroundColor: value.hex }}
          />
        ) : null}
        <span>{value?.hex ?? "Color"}</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <form
          role="dialog"
          aria-label="Filter Fragments by color"
          className="v7-filter-popover fragment-color-popover"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeHex(hex);
            if (!normalized) {
              setError("Enter a 3- or 6-digit HEX color.");
              return;
            }
            onChange({ hex: normalized, tolerance });
            close();
          }}
        >
          <div className="fragment-swatches">
            {[
              "#E66B54",
              "#E8BF60",
              "#69A87C",
              "#629DDA",
              "#A38ACB",
              "#808080",
            ].map((color) => (
              <button
                className="fragment-swatch"
                type="button"
                key={color}
                style={{ backgroundColor: color }}
                aria-label={`Choose ${color}`}
                onClick={() => {
                  setHex(color);
                  setError("");
                }}
              />
            ))}
          </div>
          <label>
            HEX
            <input
              ref={input}
              value={hex}
              onChange={(event) => {
                setHex(event.target.value);
                setError("");
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "color-filter-error" : undefined}
              spellCheck={false}
              maxLength={7}
            />
          </label>
          {error ? (
            <span role="alert" id="color-filter-error">
              {error}
            </span>
          ) : null}
          <label>
            Similarity tolerance <output>{tolerance}</output>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={tolerance}
              onChange={(event) => setTolerance(Number(event.target.value))}
            />
          </label>
          <div className="fragment-color-actions">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              Clear
            </button>
            <button type="submit">Apply</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
