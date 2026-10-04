/**
 * Dev-only timing for the focused preview. Enabled when
 * `localStorage["fragment:perf"] === "1"` or `VITE_FRAGMENT_PERF=1`; otherwise
 * `startPreviewPerf` returns null and the overlay pays a single null check.
 *
 * Samples accumulate on `window.__fragmentPerf.preview` so a session can be
 * summarised (p50/p95/max) after repeated opens and arrow navigation.
 */

export type PreviewPerfPath = "thumbnail" | "preview" | "cached";
export type PreviewPerfKind = "open" | "navigate";

export type PreviewPerfSample = {
  fragmentId: string;
  kind: PreviewPerfKind;
  path: PreviewPerfPath | null;
  firstPixelsMs: number | null;
  previewDecodedMs: number | null;
  startedAt: number;
};

export type PreviewPerfSession = {
  markFirstPixels(path: PreviewPerfPath): void;
  markPreviewDecoded(): void;
};

export type PreviewPerfStats = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

export type PreviewPerfSummary = {
  samples: number;
  firstPixels: PreviewPerfStats;
  previewDecoded: PreviewPerfStats;
  paths: Record<PreviewPerfPath, number>;
  byKind: Record<PreviewPerfKind, number>;
};

export type PreviewPerfNamespace = {
  samples: PreviewPerfSample[];
  summary(): PreviewPerfSummary;
  reset(): void;
  log(): PreviewPerfSummary;
};

const FLAG_KEY = "fragment:perf";

export function previewPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(FLAG_KEY) === "1") return true;
  } catch {
    /* Storage can be unavailable; the env flag still applies. */
  }
  return import.meta.env?.VITE_FRAGMENT_PERF === "1";
}

export function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index]!;
}

function stats(values: readonly number[]): PreviewPerfStats {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

export function summarize(
  samples: readonly PreviewPerfSample[],
): PreviewPerfSummary {
  const paths: Record<PreviewPerfPath, number> = {
    thumbnail: 0,
    preview: 0,
    cached: 0,
  };
  const byKind: Record<PreviewPerfKind, number> = { open: 0, navigate: 0 };
  const firstPixels: number[] = [];
  const previewDecoded: number[] = [];
  for (const sample of samples) {
    byKind[sample.kind] += 1;
    if (sample.path) paths[sample.path] += 1;
    if (sample.firstPixelsMs !== null) firstPixels.push(sample.firstPixelsMs);
    if (sample.previewDecodedMs !== null) {
      previewDecoded.push(sample.previewDecodedMs);
    }
  }
  return {
    samples: samples.length,
    firstPixels: stats(firstPixels),
    previewDecoded: stats(previewDecoded),
    paths,
    byKind,
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function namespace(): PreviewPerfNamespace {
  const host = window as unknown as {
    __fragmentPerf?: { preview?: PreviewPerfNamespace } & Record<
      string,
      unknown
    >;
  };
  host.__fragmentPerf ??= {};
  if (!host.__fragmentPerf.preview) {
    const samples: PreviewPerfSample[] = [];
    const preview: PreviewPerfNamespace = {
      samples,
      summary: () => summarize(samples),
      reset: () => {
        samples.length = 0;
      },
      log: () => {
        const summary = summarize(samples);
        console.info("[perf] preview summary", summary);
        return summary;
      },
    };
    host.__fragmentPerf.preview = preview;
  }
  return host.__fragmentPerf.preview;
}

export function startPreviewPerf(
  fragmentId: string,
  kind: PreviewPerfKind,
): PreviewPerfSession | null {
  if (!previewPerfEnabled()) return null;

  const startedAt = performance.now();
  performance.mark(`fragment:overlay:${kind}`, { detail: { fragmentId } });
  const sample: PreviewPerfSample = {
    fragmentId,
    kind,
    path: null,
    firstPixelsMs: null,
    previewDecodedMs: null,
    startedAt,
  };
  namespace().samples.push(sample);

  return {
    markFirstPixels(path) {
      if (sample.firstPixelsMs !== null) return;
      sample.firstPixelsMs = round(performance.now() - startedAt);
      sample.path = path;
      performance.mark("fragment:overlay:first-pixels");
      console.info(
        `[perf] overlay ${kind} -> first pixels ${sample.firstPixelsMs} ms (${path})`,
      );
    },
    markPreviewDecoded() {
      if (sample.previewDecodedMs !== null) return;
      sample.previewDecodedMs = round(performance.now() - startedAt);
      if (sample.firstPixelsMs === null) {
        sample.firstPixelsMs = sample.previewDecodedMs;
        sample.path ??= "preview";
      }
      performance.mark("fragment:overlay:preview-decoded");
      console.info(
        `[perf] overlay ${kind} -> preview decoded ${sample.previewDecodedMs} ms`,
      );
    },
  };
}
