import type { ImageCandidate, ImageUrlCandidate } from "@fragment/shared";
import { genericSourceForLocation, pageSiteName } from "./adapters/generic";
import { googleImagesSourceUrl } from "./adapters/google-images";
import { pinterestTitle } from "./adapters/pinterest";

const MIN_SIZE = 120;
const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|jpe?g|png|webp)(\?.*)?$/i;
const elementCandidateIds = new WeakMap<Element, string>();
const candidateElements = new Map<string, Element>();
const elementBackedCandidateIds = new Set<string>();
let nextCandidateId = 0;

export function selectBestImageUrl(image: HTMLImageElement): string {
  if (image.currentSrc) {
    return image.currentSrc;
  }
  const bestSrcsetUrl = bestSrcsetCandidateUrl(
    image.getAttribute("srcset"),
    location.href,
  );
  if (bestSrcsetUrl) {
    return bestSrcsetUrl;
  }
  return image.src;
}

export function bestSrcsetCandidateUrl(
  srcset: string | null | undefined,
  baseUrl: string,
): string | undefined {
  return parseSrcsetCandidates(srcset, baseUrl).at(-1)?.url;
}

export function parseSrcsetCandidates(
  srcset: string | null | undefined,
  baseUrl: string,
): ImageUrlCandidate[] {
  if (!srcset?.trim()) {
    return [];
  }
  return uniqueImageUrlCandidates(
    srcset
      .split(",")
      .map((item) => {
        const [rawUrl, descriptor] = item.trim().split(/\s+/);
        if (!rawUrl) {
          return null;
        }
        try {
          const width = descriptor?.endsWith("w")
            ? Number.parseInt(descriptor, 10)
            : undefined;
          const density = descriptor?.endsWith("x")
            ? Number.parseFloat(descriptor)
            : undefined;
          const candidate: ImageUrlCandidate = {
            url: new URL(rawUrl, baseUrl).href,
            source: "srcset",
          };
          if (descriptor) candidate.descriptor = descriptor;
          if (typeof width === "number" && Number.isFinite(width)) {
            candidate.width = width;
          }
          if (typeof density === "number" && Number.isFinite(density)) {
            candidate.density = density;
          }
          return candidate;
        } catch {
          return null;
        }
      })
      .filter((candidate): candidate is ImageUrlCandidate =>
        Boolean(candidate),
      ),
  );
}

export function isCredibleRect(rect: DOMRect): boolean {
  return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
}

export function isVisibleElement(element: Element): boolean {
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0.05
  );
}

export function isCredibleCandidate(
  candidate: Pick<ImageCandidate, "width" | "height" | "src">,
): boolean {
  if (candidate.width < MIN_SIZE || candidate.height < MIN_SIZE) {
    return false;
  }
  if (candidate.src.startsWith("data:image/svg")) {
    return false;
  }
  return (
    !candidate.src.includes("pixel") ||
    candidate.width > 300 ||
    candidate.height > 300
  );
}

export function findImageCandidates(
  root: ParentNode = document,
): ImageCandidate[] {
  const candidates = new Map<string, ImageCandidate>();
  const source = genericSourceForLocation(location);
  const siteName = pageSiteName();

  for (const image of queryElements<HTMLImageElement>(root, "img")) {
    if (!isVisibleElement(image)) {
      continue;
    }
    const rect = image.getBoundingClientRect();
    if (!isCredibleRect(rect)) {
      continue;
    }
    const src = selectBestImageUrl(image);
    const candidate: ImageCandidate = {
      id: stableElementId(image, src),
      src,
      pageUrl: location.href,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rect: rectToPlain(rect),
      source,
    };
    if (image.currentSrc) candidate.currentSrc = image.currentSrc;
    const sourceUrl =
      googleImagesSourceUrl(image) ??
      image.closest<HTMLAnchorElement>("a[href]")?.href;
    if (sourceUrl) candidate.sourceUrl = sourceUrl;
    candidate.imageUrls = imageUrlCandidatesForImage(image, sourceUrl);
    if (siteName) candidate.siteName = siteName;
    if (image.alt) candidate.alt = image.alt;
    const title = image.title || pinterestTitle(image);
    if (title) candidate.title = title;
    if (image.naturalWidth) candidate.naturalWidth = image.naturalWidth;
    if (image.naturalHeight) candidate.naturalHeight = image.naturalHeight;
    if (isCredibleCandidate(candidate)) {
      registerCandidateElement(candidate.id, image);
      candidates.set(candidate.id, candidate);
    }
  }

  for (const video of queryElements<HTMLVideoElement>(root, "video[poster]")) {
    if (!isVisibleElement(video)) {
      continue;
    }
    const rect = video.getBoundingClientRect();
    if (!isCredibleRect(rect)) {
      continue;
    }
    const src = new URL(video.poster, location.href).href;
    const candidate: ImageCandidate = {
      id: stableElementId(video, src),
      src,
      imageUrls: [{ url: src, source: "poster" }],
      pageUrl: location.href,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rect: rectToPlain(rect),
      source,
    };
    if (siteName) candidate.siteName = siteName;
    registerCandidateElement(candidate.id, video);
    candidates.set(candidate.id, candidate);
  }

  for (const element of queryElements<HTMLElement>(
    root,
    "a[href], div, section, article",
  )) {
    if (!isVisibleElement(element)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (!isCredibleRect(rect)) {
      continue;
    }

    const backgroundUrl = extractBackgroundImage(element);
    const linkedUrl =
      element instanceof HTMLAnchorElement &&
      IMAGE_EXTENSIONS.test(element.href)
        ? element.href
        : undefined;
    const src = backgroundUrl ?? linkedUrl;
    if (!src) {
      continue;
    }

    const candidate: ImageCandidate = {
      id: stableElementId(element, src),
      src,
      imageUrls: [
        {
          url: src,
          source: backgroundUrl ? "background" : "linkedImage",
        },
      ],
      pageUrl: location.href,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rect: rectToPlain(rect),
      source,
    };
    if (element instanceof HTMLAnchorElement)
      candidate.sourceUrl = element.href;
    if (siteName) candidate.siteName = siteName;
    const title = element.getAttribute("aria-label");
    if (title) candidate.title = title;
    if (isCredibleCandidate(candidate)) {
      registerCandidateElement(candidate.id, element);
      candidates.set(candidate.id, candidate);
    }
  }

  const ogImage = document.querySelector<HTMLMetaElement>(
    'meta[property="og:image"]',
  )?.content;
  if (root === document && ogImage && candidates.size === 0) {
    const src = new URL(ogImage, location.href).href;
    const candidate: ImageCandidate = {
      id: src,
      src,
      imageUrls: [{ url: src, source: "openGraph" }],
      pageUrl: location.href,
      width: 640,
      height: 360,
      rect: { x: 24, y: 24, width: 180, height: 120 },
      source,
    };
    if (siteName) candidate.siteName = siteName;
    candidates.set(src, candidate);
  }

  return [...candidates.values()];
}

export function candidateElementForId(candidateId: string): Element | undefined {
  const element = candidateElements.get(candidateId);
  if (element && !element.isConnected) {
    candidateElements.delete(candidateId);
    elementBackedCandidateIds.delete(candidateId);
    return undefined;
  }
  return element;
}

export function releaseCandidateElement(candidateId: string): void {
  candidateElements.delete(candidateId);
  elementBackedCandidateIds.delete(candidateId);
}

export function refreshCandidateRects(
  candidates: ImageCandidate[],
): ImageCandidate[] {
  const refreshed: ImageCandidate[] = [];
  for (const candidate of candidates) {
    if (!elementBackedCandidateIds.has(candidate.id)) {
      refreshed.push(candidate);
      continue;
    }
    const element = candidateElementForId(candidate.id);
    if (!element || !isVisibleElement(element)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    if (!isCredibleRect(rect)) {
      continue;
    }
    refreshed.push({
      ...candidate,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rect: rectToPlain(rect),
    });
  }
  return refreshed;
}

function imageUrlCandidatesForImage(
  image: HTMLImageElement,
  sourceUrl?: string,
): ImageUrlCandidate[] {
  return uniqueImageUrlCandidates([
    image.currentSrc
      ? { url: image.currentSrc, source: "currentSrc" }
      : undefined,
    image.src ? { url: image.src, source: "src" } : undefined,
    ...parseSrcsetCandidates(image.getAttribute("srcset"), location.href),
    sourceUrl && IMAGE_EXTENSIONS.test(sourceUrl)
      ? { url: sourceUrl, source: "sourceUrl" }
      : undefined,
  ]);
}

function uniqueImageUrlCandidates(
  candidates: Array<ImageUrlCandidate | null | undefined>,
) {
  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is ImageUrlCandidate => {
    if (!candidate?.url || seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });
}

function extractBackgroundImage(element: HTMLElement): string | undefined {
  const background = getComputedStyle(element).backgroundImage;
  const match = /url\(["']?(.+?)["']?\)/.exec(background);
  if (!match?.[1]) {
    return undefined;
  }
  return new URL(match[1], location.href).href;
}

function rectToPlain(rect: DOMRect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function stableElementId(element: Element, src: string): string {
  const existing = elementCandidateIds.get(element);
  if (existing) {
    return existing;
  }
  nextCandidateId += 1;
  const id = `fragment-candidate-${nextCandidateId}-${hashString(src)}`;
  elementCandidateIds.set(element, id);
  return id;
}

function registerCandidateElement(candidateId: string, element: Element): void {
  candidateElements.set(candidateId, element);
  elementBackedCandidateIds.add(candidateId);
}

function queryElements<T extends Element>(
  root: ParentNode,
  selector: string,
): T[] {
  const elements: T[] = [];
  if (root instanceof Element && root.matches(selector)) {
    elements.push(root as T);
  }
  elements.push(...Array.from(root.querySelectorAll<T>(selector)));
  return elements;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }
  return Math.abs(hash).toString(36);
}
