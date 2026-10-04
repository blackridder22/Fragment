import { useEffect, useRef, useState } from "react";
import type { Fragment, FragmentMediaInfo } from "@fragment/shared";
import {
  assetUrl,
  cancelSvgPreview,
  ensureSvgPreview,
  getFragmentMediaInfo,
} from "../../lib/tauri";
import "../../styles/colors-svg.css";

export function SvgPreview({
  fragment,
  assetRoot,
  initialUrl,
}: {
  fragment: Fragment;
  assetRoot: string;
  initialUrl: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [background, setBackground] = useState("transparent");
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [source, setSource] = useState(initialUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [info, setInfo] = useState<FragmentMediaInfo | null>(null);
  const repaired = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const width = Math.max(1, fragment.width ?? 640);
  const height = Math.max(1, fragment.height ?? 480);
  const scale =
    zoom === "fit" ? Math.min(size.width / width, size.height / height) : zoom;
  const displayWidth = Math.max(1, width * scale);
  const displayHeight = Math.max(1, height * scale);
  const demand = Math.ceil(
    Math.max(displayWidth, displayHeight) * window.devicePixelRatio,
  );
  const edge = Math.max(1, Math.min(4096, demand));

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    void getFragmentMediaInfo(fragment.id)
      .then((result) => {
        if (active) setInfo(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [fragment.id]);
  useEffect(() => {
    let active = true;
    let sent = false;
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      sent = true;
      setPending(true);
      setError("");
      void ensureSvgPreview(fragment.id, edge, requestId, retry > 0)
        .then((result) => {
          if (active)
            setSource(
              `${assetUrl(assetRoot, result.relativePath)}?render=${retry}`,
            );
        })
        .catch((cause) => {
          if (active) setError(String(cause));
        })
        .finally(() => {
          if (active) setPending(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      if (sent) void cancelSvgPreview(requestId).catch(() => undefined);
    };
  }, [fragment.id, edge, assetRoot, retry]);

  return (
    <div className="fragment-svg">
      <div
        className="fragment-svg-toolbar"
        aria-label="SVG preview controls"
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        {(["fit", 1, 2, 4] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={zoom === value}
            onClick={() => {
              setZoom(value);
              if (viewport.current) {
                viewport.current.scrollLeft = 0;
                viewport.current.scrollTop = 0;
              }
            }}
          >
            {value === "fit" ? "Fit" : `${value * 100}%`}
          </button>
        ))}
        <select
          aria-label="SVG preview background"
          value={background}
          onChange={(event) => setBackground(event.target.value)}
        >
          <option value="transparent">Transparent</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div
        className="fragment-svg-viewport"
        ref={viewport}
        data-background={background}
        onPointerDown={(event) => {
          if (zoom === "fit" || event.button !== 0) return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            event.currentTarget.scrollLeft =
              drag.current.left + drag.current.x - event.clientX;
            event.currentTarget.scrollTop =
              drag.current.top + drag.current.y - event.clientY;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="fragment-svg-surface"
          style={{
            width: Math.max(size.width, displayWidth),
            height: Math.max(size.height, displayHeight),
          }}
        >
          {source ? (
            <img
              alt={fragment.title || "SVG Fragment"}
              src={source}
              draggable={false}
              style={{ width: displayWidth, height: displayHeight }}
              onError={() => {
                if (!repaired.current) {
                  repaired.current = true;
                  setRetry((value) => value + 1);
                } else
                  setError("Preview unavailable. Retry to render it again.");
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="fragment-svg-status" aria-live="polite">
        {pending ? (
          "Rendering…"
        ) : error ? (
          <>
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </>
        ) : demand > 4096 ? (
          "Maximum preview resolution reached"
        ) : null}
      </div>
      {info?.warnings.map((warning) => (
        <p className="fragment-svg-warning" key={warning.code}>
          {warning.message}
        </p>
      ))}
    </div>
  );
}
