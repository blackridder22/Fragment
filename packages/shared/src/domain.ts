export type Frame = {
  id: string;
  parentId: string | null;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Fragment = {
  id: string;
  assetId?: string | null;
  frameId: string;
  title?: string | null;
  description?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  siteName?: string | null;
  creatorName?: string | null;
  originalPath: string;
  thumbnailPath: string;
  previewPath?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  sha256?: string | null;
  perceptualHash?: string | null;
  capturedFrom?: string | null;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  deleteAfter?: string | null;
};

export type ImageCandidateSource =
  | "pinterest"
  | "instagram"
  | "google_images"
  | "generic";

export type ImageUrlCandidate = {
  url: string;
  source:
    | "src"
    | "currentSrc"
    | "srcset"
    | "sourceUrl"
    | "linkedImage"
    | "background"
    | "poster"
    | "openGraph";
  descriptor?: string;
  width?: number;
  density?: number;
};

export type ImageCandidate = {
  id: string;
  src: string;
  currentSrc?: string;
  imageUrls?: ImageUrlCandidate[];
  pageUrl: string;
  sourceUrl?: string;
  siteName?: string;
  alt?: string;
  title?: string;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source: ImageCandidateSource;
};
