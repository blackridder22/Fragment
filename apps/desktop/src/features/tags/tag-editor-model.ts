function cleanTag(tag: string): string {
  return tag.trim();
}

function tagKey(tag: string): string {
  return tag.toLocaleLowerCase();
}

export const MAX_TAGS_PER_FRAGMENT = 32;
export const MAX_TAG_LENGTH = 64;

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of tags) {
    const tag = cleanTag(value);
    if (!tag) continue;

    const key = tagKey(tag);
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(tag);
  }

  return normalized;
}

export function addTag(tags: readonly string[], value: string): string[] {
  const normalized = normalizeTags(tags);
  const tag = cleanTag(value);
  if (!tag) return normalized;

  const key = tagKey(tag);
  if (normalized.some((existing) => tagKey(existing) === key)) {
    return normalized;
  }

  return [...normalized, tag];
}

export function tagValidationError(
  tags: readonly string[],
  value: string,
): string | null {
  const normalized = normalizeTags(tags);
  const tag = cleanTag(value);

  if (!tag) return "Enter a tag name.";
  if ([...tag].length > MAX_TAG_LENGTH) {
    return `Tags can be up to ${MAX_TAG_LENGTH} characters.`;
  }
  if (normalized.some((existing) => tagKey(existing) === tagKey(tag))) {
    return null;
  }
  if (normalized.length >= MAX_TAGS_PER_FRAGMENT) {
    return `A Frame can have up to ${MAX_TAGS_PER_FRAGMENT} tags.`;
  }

  return null;
}

export function removeTag(tags: readonly string[], value: string): string[] {
  const normalized = normalizeTags(tags);
  const tag = cleanTag(value);
  if (!tag) return normalized;

  const key = tagKey(tag);
  return normalized.filter((existing) => tagKey(existing) !== key);
}
