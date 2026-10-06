/**
 * Retention policy helpers for the Trash page.
 *
 * The delete policy in Settings is either a number of days or "forever"
 * (retention off: deletions skip the Trash). Trashed rows carry their own
 * `deleteAfter` timestamp, stamped when they were moved to Trash.
 */

export type TrashRetention =
  | { kind: "days"; days: number }
  | { kind: "forever" };

export const DAY_MS = 86_400_000;

export function retentionFromDeletePolicy(
  policy: string | null | undefined,
): TrashRetention {
  if (!policy || policy === "forever") {
    return { kind: "forever" };
  }
  const days = Number(policy);
  if (!Number.isFinite(days) || days <= 0) {
    return { kind: "forever" };
  }
  return { kind: "days", days: Math.floor(days) };
}

export function retentionDays(retention: TrashRetention): number | null {
  return retention.kind === "days" ? retention.days : null;
}

/** Mirrors the delete-policy description shown in Settings. */
export function retentionSummary(retention: TrashRetention): string {
  return retention.kind === "days"
    ? `Items remain recoverable in Trash for ${retention.days} days`
    : "Items are permanently removed immediately";
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whole days until `deleteAfter`, rounding partial days up. */
export function daysUntil(
  deleteAfter: string,
  now: Date = new Date(),
): number | null {
  const target = parseTimestamp(deleteAfter);
  if (target === null) return null;
  return Math.ceil((target - now.getTime()) / DAY_MS);
}

/**
 * Per-row retention label. Rows without a `deleteAfter` stay until the Trash is
 * emptied; everything else is removed by the expiry purge on the next launch
 * after the date passes.
 */
export function deletionLabel(
  deleteAfter: string | null | undefined,
  now: Date = new Date(),
): string {
  const days = deleteAfter ? daysUntil(deleteAfter, now) : null;
  if (days === null) return "Deleted forever on empty";
  if (days <= 0) return "Deletes today";
  if (days === 1) return "Deletes in 1 day";
  return `Deletes in ${days} days`;
}

/**
 * Trashed Frames do not expose `deleteAfter` yet, so the page estimates it from
 * the deletion time plus the current policy, exactly as the backend stamps it.
 */
export function estimateDeleteAfter(
  deletedAt: string,
  retention: TrashRetention,
): string | null {
  if (retention.kind !== "days") return null;
  const start = parseTimestamp(deletedAt);
  if (start === null) return null;
  return new Date(start + retention.days * DAY_MS).toISOString();
}

/**
 * Whole days of retention left on a row, used to re-trash it with its original
 * window when a restore is undone. The backend only accepts a number of days
 * from now, so this is day-granular: a row with no date, or one whose date has
 * passed, falls back to the policy or to one day. Never longer than the policy.
 */
export function remainingRetentionDays(
  deleteAfter: string | null | undefined,
  policyDays: number,
  now: Date = new Date(),
): number {
  const days = deleteAfter ? daysUntil(deleteAfter, now) : null;
  if (days === null) return policyDays;
  return Math.max(1, Math.min(policyDays, days));
}
