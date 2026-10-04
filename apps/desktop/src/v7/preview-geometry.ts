export type Size = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;
export type ViewState = Readonly<{ zoom: number; pan: Point }>;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const FIT_VIEW: ViewState = Object.freeze({
  zoom: 1,
  pan: Object.freeze({ x: 0, y: 0 }),
});

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round(value: number) {
  return Math.round(value * 100) / 100 || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Contain-fits an image inside a stage. Without usable image dimensions the
 * box fills the stage so the stacked images can rely on `object-fit`.
 */
export function fitWithin(stage: Size, image: Size | null | undefined): Size {
  const stageWidth = Math.max(0, stage.width);
  const stageHeight = Math.max(0, stage.height);
  if (!image || !positive(image.width) || !positive(image.height)) {
    return { width: stageWidth, height: stageHeight };
  }
  const scale = Math.min(stageWidth / image.width, stageHeight / image.height);
  if (!Number.isFinite(scale) || scale <= 0) return { width: 0, height: 0 };
  return {
    width: round(image.width * scale),
    height: round(image.height * scale),
  };
}

export function clampZoom(zoom: number, max = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return clamp(zoom, MIN_ZOOM, Math.max(MIN_ZOOM, max));
}

/** Zoom multiplier that shows one image pixel per CSS pixel. */
export function nativeZoom(fit: Size, image: Size | null | undefined): number {
  if (!image || !positive(image.width) || !positive(fit.width)) return MIN_ZOOM;
  return Math.max(MIN_ZOOM, image.width / fit.width);
}

/** Percentage of native size currently shown, for the zoom readout. */
export function displayPercent(
  fit: Size,
  image: Size | null | undefined,
  zoom: number,
): number | null {
  if (!image || !positive(image.width) || !positive(fit.width)) return null;
  return Math.round((fit.width / image.width) * zoom * 100);
}

/**
 * Keeps the scaled image covering the viewport: centred while it is smaller,
 * otherwise never dragged so far that an edge leaves a gap.
 */
export function clampPan(
  pan: Point,
  fit: Size,
  zoom: number,
  viewport: Size,
): Point {
  const maxX = Math.max(0, (fit.width * zoom - viewport.width) / 2);
  const maxY = Math.max(0, (fit.height * zoom - viewport.height) / 2);
  return {
    x: round(clamp(pan.x, -maxX, maxX)),
    y: round(clamp(pan.y, -maxY, maxY)),
  };
}

/**
 * Changes zoom while keeping the image point under `pointer` (relative to the
 * viewport centre) fixed on screen.
 */
export function zoomAt(
  view: ViewState,
  nextZoom: number,
  pointer: Point,
): ViewState {
  const zoom = clampZoom(nextZoom, Number.POSITIVE_INFINITY);
  if (zoom === view.zoom) return view;
  const ratio = zoom / view.zoom;
  return {
    zoom,
    pan: {
      x: round(pointer.x - (pointer.x - view.pan.x) * ratio),
      y: round(pointer.y - (pointer.y - view.pan.y) * ratio),
    },
  };
}

/** Converts a wheel delta into a multiplicative zoom factor. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 120 : 1;
  const delta = clamp(deltaY * unit, -240, 240);
  return Math.exp(-delta * 0.0035);
}
