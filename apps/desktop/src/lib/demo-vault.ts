import type { Fragment, Frame } from "@fragment/shared";

const now = new Date().toISOString();

export const demoFrames: Frame[] = [
  frame("demo-frame-ui", "UI"),
  frame("demo-frame-interiors", "Interiors"),
  frame("demo-frame-backgrounds", "Backgrounds"),
  frame("demo-frame-texture", "Texture"),
  frame("demo-frame-motion", "Motion"),
  frame("demo-frame-posters", "Posters")
];

export const demoFragments: Fragment[] = [
  fragment("demo-fragment-01", "demo-frame-backgrounds", "Prism glass study", "/demo-raster/fragment-01.png", 230, 279, "Backgrounds"),
  fragment("demo-fragment-02", "demo-frame-posters", "Design week poster", "/demo-raster/fragment-02.png", 213, 279, "Posters"),
  fragment("demo-fragment-03", "demo-frame-motion", "Refraction study", "/demo-raster/fragment-03.png", 223, 279, "Motion"),
  fragment("demo-fragment-04", "demo-frame-texture", "Soft graphite scan", "/demo-raster/fragment-04.png", 224, 242, "Texture"),
  fragment("demo-fragment-05", "demo-frame-interiors", "Warm gallery light", "/demo-raster/fragment-05.png", 250, 244, "Interiors"),
  fragment("demo-fragment-06", "demo-frame-texture", "Black fabric waves", "/demo-raster/fragment-06.png", 230, 224, "Texture"),
  fragment("demo-fragment-07", "demo-frame-ui", "Quiet dashboard crop", "/demo-raster/fragment-07.png", 213, 210, "UI"),
  fragment("demo-fragment-08", "demo-frame-backgrounds", "Blue liquid glass", "/demo-raster/fragment-08.png", 223, 208, "Backgrounds"),
  fragment("demo-fragment-09", "demo-frame-backgrounds", "Folded blue shadow", "/demo-raster/fragment-09.png", 230, 248, "Backgrounds"),
  fragment("demo-fragment-10", "demo-frame-motion", "Light spill reference", "/demo-raster/fragment-10.png", 213, 270, "Motion"),
  fragment("demo-fragment-11", "demo-frame-ui", "Control surface study", "/demo-raster/fragment-11.png", 223, 205, "UI"),
  fragment("demo-fragment-12", "demo-frame-backgrounds", "Chrome surface detail", "/demo-raster/fragment-12.png", 320, 236, "Backgrounds"),
  fragment("demo-fragment-13", "demo-frame-texture", "Black silk ridge", "/demo-raster/fragment-13.png", 311, 173, "Texture"),
  fragment("demo-fragment-14", "demo-frame-interiors", "Garden room light", "/demo-raster/fragment-14.png", 216, 210, "Interiors"),
  fragment("demo-fragment-15", "demo-frame-motion", "Soft green fold", "/demo-raster/fragment-15.png", 244, 190, "Motion"),
  fragment("demo-fragment-16", "demo-frame-texture", "Copper flower form", "/demo-raster/fragment-16.png", 149, 205, "Texture"),
  fragment("demo-fragment-17", "demo-frame-backgrounds", "Green eclipse glow", "/demo-raster/fragment-17.png", 261, 118, "Backgrounds"),
  fragment("demo-fragment-18", "demo-frame-backgrounds", "Painted green fold", "/demo-raster/fragment-18.png", 217, 168, "Backgrounds"),
  fragment("demo-fragment-20", "demo-frame-interiors", "Dark glass corner", "/demo-raster/fragment-20.png", 209, 170, "Interiors")
];

export function isDemoFragment(fragment: Fragment): boolean {
  return fragment.id.startsWith("demo-");
}

function frame(id: string, name: string): Frame {
  return {
    id,
    parentId: null,
    name,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now
  };
}

function fragment(
  id: string,
  frameId: string,
  title: string,
  path: string,
  width: number,
  height: number,
  siteName: string
): Fragment {
  return {
    id,
    frameId,
    title,
    originalPath: path,
    thumbnailPath: path,
    width,
    height,
    fileSize: null,
    sourceUrl: "https://fragment.local/source",
    pageUrl: "https://fragment.local/source",
    siteName,
    capturedFrom: "preview",
    capturedAt: now,
    createdAt: now,
    updatedAt: now
  };
}
