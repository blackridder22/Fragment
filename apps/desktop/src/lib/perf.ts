/**
 * Dev-only performance flag. Enabled when `localStorage["fragment:perf"]`
 * is "1". Every exported helper is a cheap boolean check when the flag is off.
 */

export type PerfCounters = { invokes: number };

export type FrameSampleReport = {
  samples: number;
  p50: number;
  p95: number;
  max: number;
  over100ms: number;
};

export type FragmentPerf = {
  enabled: boolean;
  invokes: number;
  reset: () => void;
  startFrames: () => void;
  stopFrames: () => FrameSampleReport | null;
  marks: () => Record<string, number>;
};

type PerfStorage = Pick<Storage, "getItem">;

export function readPerfFlag(storage: PerfStorage | null): boolean {
  try {
    return storage?.getItem("fragment:perf") === "1";
  } catch {
    return false;
  }
}

function browserStorage(): PerfStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const perfEnabled: boolean = readPerfFlag(browserStorage());

const marks = new Map<string, number>();
const markedOnce = new Set<string>();

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Records a named mark and logs the duration since `since` (default: module start). */
export function perfMark(name: string, since = "module-start") {
  if (!perfEnabled) return;
  const at = now();
  marks.set(name, at);
  try {
    performance.mark(`fragment:${name}`);
  } catch {
    // performance.mark is optional in some test runtimes.
  }
  const base = marks.get(since);
  if (base !== undefined && since !== name) {
    console.log(`[perf] ${name} ${(at - base).toFixed(1)}ms since ${since}`);
  }
}

/** Like `perfMark` but only the first call for a name is recorded. */
export function perfMarkOnce(name: string, since = "module-start") {
  if (!perfEnabled || markedOnce.has(name)) return;
  markedOnce.add(name);
  perfMark(name, since);
}

export function resetPerfMarks(name?: string) {
  if (!perfEnabled) return;
  if (name) {
    marks.delete(name);
    markedOnce.delete(name);
    return;
  }
  marks.clear();
  markedOnce.clear();
  marks.set("module-start", now());
}

type InvokeLike = (cmd: string, ...rest: any[]) => Promise<any>;

/** Wraps `invoke` to count calls and log their duration when the flag is on. */
export function instrumentInvoke<F extends InvokeLike>(
  invoke: F,
  enabled = perfEnabled,
  counters: PerfCounters = perfCounters,
  log: (line: string) => void = (line) => console.log(line),
): F {
  if (!enabled) return invoke;
  const wrapped = (async (cmd: string, ...rest: any[]) => {
    counters.invokes += 1;
    const started = now();
    try {
      return await invoke(cmd, ...rest);
    } finally {
      log(`[perf] invoke ${cmd} ${(now() - started).toFixed(1)}ms`);
    }
  }) as unknown as F;
  return wrapped;
}

export const perfCounters: PerfCounters = { invokes: 0 };

export function summarizeFrameIntervals(
  intervals: readonly number[],
): FrameSampleReport {
  const sorted = [...intervals].sort((left, right) => left - right);
  const at = (quantile: number) =>
    sorted.length === 0
      ? 0
      : sorted[
          Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))
        ]!;
  return {
    samples: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.length ? sorted[sorted.length - 1]! : 0,
    over100ms: sorted.filter((value) => value > 100).length,
  };
}

let frameHandle: number | null = null;
let frameIntervals: number[] = [];
let lastFrameAt = 0;

function startFrames() {
  if (!perfEnabled || frameHandle !== null) return;
  frameIntervals = [];
  lastFrameAt = now();
  console.log("[perf] frame sampler started");
  const tick = () => {
    const at = now();
    frameIntervals.push(at - lastFrameAt);
    lastFrameAt = at;
    frameHandle = window.requestAnimationFrame(tick);
  };
  frameHandle = window.requestAnimationFrame(tick);
}

function stopFrames() {
  if (!perfEnabled || frameHandle === null) return null;
  window.cancelAnimationFrame(frameHandle);
  frameHandle = null;
  const report = summarizeFrameIntervals(frameIntervals);
  console.log(
    `[perf] frames n=${report.samples} p50=${report.p50.toFixed(1)}ms p95=${report.p95.toFixed(1)}ms max=${report.max.toFixed(1)}ms over100ms=${report.over100ms}`,
  );
  return report;
}

function toggleFrames() {
  if (frameHandle === null) startFrames();
  else stopFrames();
}

/** Installs `window.__fragmentPerf` and the Ctrl+Option+Shift+P sampler toggle. */
export function installPerfTools() {
  if (!perfEnabled || typeof window === "undefined") return;
  marks.set("module-start", now());
  const api: FragmentPerf = {
    enabled: true,
    get invokes() {
      return perfCounters.invokes;
    },
    reset() {
      perfCounters.invokes = 0;
      console.log("[perf] invoke counter reset");
    },
    startFrames,
    stopFrames,
    marks: () => Object.fromEntries(marks),
  };
  (window as unknown as { __fragmentPerf: FragmentPerf }).__fragmentPerf = api;
  window.addEventListener("keydown", (event) => {
    if (
      event.ctrlKey &&
      event.altKey &&
      event.shiftKey &&
      event.code === "KeyP"
    ) {
      event.preventDefault();
      toggleFrames();
    }
  });
  console.log("[perf] enabled; window.__fragmentPerf is available");
}
