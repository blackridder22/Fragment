import type { ImageCandidateSource } from "@fragment/shared";

export function genericSourceForLocation(location: Location): ImageCandidateSource {
  const host = location.hostname.toLowerCase();
  if (host.includes("pinterest.")) {
    return "pinterest";
  }
  if (host.includes("instagram.")) {
    return "instagram";
  }
  if (host.includes("google.") && location.pathname.includes("search")) {
    return "google_images";
  }
  return "generic";
}

export function pageSiteName(): string | undefined {
  const siteName = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]');
  return siteName?.content || document.title || undefined;
}
