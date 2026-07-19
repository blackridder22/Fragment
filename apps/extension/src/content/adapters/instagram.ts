export function instagramCreatorName(): string | undefined {
  const meta = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  return meta?.content?.split(" on Instagram")?.[0] ?? undefined;
}
