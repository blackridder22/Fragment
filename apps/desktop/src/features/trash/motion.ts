/** Reads motion tokens so JavaScript timers match the CSS durations. */

export function parseCssDuration(raw: string, fallbackMs: number): number {
  const value = raw.trim();
  if (!value) return fallbackMs;
  const match = /^([\d.]+)(ms|s)$/i.exec(value);
  if (!match) return fallbackMs;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;
  return match[2].toLowerCase() === "s" ? amount * 1000 : amount;
}

/**
 * Resolves a duration token such as `--dur-base`. Returns 0 when reduced
 * motion is active, because the tokens themselves collapse to 0ms then.
 */
export function readMotionDuration(token: string, fallbackMs: number): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }
  try {
    const raw = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(token);
    return parseCssDuration(raw, fallbackMs);
  } catch {
    return fallbackMs;
  }
}
