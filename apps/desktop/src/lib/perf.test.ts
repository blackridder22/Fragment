import { describe, expect, it, vi } from "vitest";
import {
  instrumentInvoke,
  readPerfFlag,
  summarizeFrameIntervals,
  type PerfCounters,
} from "./perf";

describe("perf flag", () => {
  it("is enabled only by localStorage fragment:perf=1", () => {
    expect(readPerfFlag(null)).toBe(false);
    expect(readPerfFlag({ getItem: () => "0" })).toBe(false);
    expect(readPerfFlag({ getItem: () => "1" })).toBe(true);
    expect(
      readPerfFlag({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });

  it("returns invoke untouched when disabled", () => {
    const invoke = vi.fn(async () => "ok");
    expect(instrumentInvoke(invoke, false)).toBe(invoke);
  });

  it("counts and logs invokes when enabled", async () => {
    const invoke = vi.fn(async (cmd: string, _args?: unknown) => `${cmd}:done`);
    const counters: PerfCounters = { invokes: 0 };
    const log = vi.fn();
    const wrapped = instrumentInvoke(invoke, true, counters, log);

    await expect(wrapped("list_frames", { a: 1 })).resolves.toBe(
      "list_frames:done",
    );
    await wrapped("get_fragment_tags");
    expect(counters.invokes).toBe(2);
    expect(invoke).toHaveBeenCalledWith("list_frames", { a: 1 });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[perf\] invoke list_frames \d+(\.\d+)?ms$/,
    );
  });

  it("still counts and logs when the command rejects", async () => {
    const invoke = vi.fn(async (_cmd: string) => {
      throw new Error("nope");
    });
    const counters: PerfCounters = { invokes: 0 };
    const log = vi.fn();
    await expect(
      instrumentInvoke(invoke, true, counters, log)("x"),
    ).rejects.toThrow("nope");
    expect(counters.invokes).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("summarizes frame intervals", () => {
    const report = summarizeFrameIntervals([
      16, 17, 16, 120, 16, 18, 15, 16, 16, 17,
    ]);
    expect(report.samples).toBe(10);
    expect(report.p50).toBe(16);
    expect(report.p95).toBe(120);
    expect(report.max).toBe(120);
    expect(report.over100ms).toBe(1);
    expect(summarizeFrameIntervals([])).toEqual({
      samples: 0,
      p50: 0,
      p95: 0,
      max: 0,
      over100ms: 0,
    });
  });
});
