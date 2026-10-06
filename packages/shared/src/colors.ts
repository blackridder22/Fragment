import { z } from "zod";

export const colorFilterSchema = z.object({
  hex: z.string().regex(/^#[0-9A-F]{6}$/),
  tolerance: z.number().int().min(0).max(200),
});
export type ColorFilter = z.infer<typeof colorFilterSchema>;
export type PaletteColor = {
  hex: string;
  r: number;
  g: number;
  b: number;
  l: number;
  a: number;
  labB: number;
  coverage: number;
};
export type FragmentPalette = {
  assetId: string;
  status: "pending" | "processing" | "ready" | "empty" | "failed";
  algorithmVersion: number;
  colors: PaletteColor[];
  errorCode: string | null;
};
export type PaletteIndexStatus = {
  ready: number;
  empty: number;
  pending: number;
  failed: number;
  revision: string;
};
export type DerivativesStatus = {
  pending: number;
  done: number;
  failed: number;
};
export type FragmentMediaInfo = {
  kind: "raster" | "vector";
  width: number | null;
  height: number | null;
  warnings: { code: string; message: string }[];
};
export type SvgPreviewResult = { relativePath: string; tier: number };

export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}
