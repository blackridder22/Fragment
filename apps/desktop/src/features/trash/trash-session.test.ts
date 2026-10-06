import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeTrashPulse,
  getTrashSessionSnapshot,
  observeTrashCounts,
  resetTrashSession,
  subscribeTrashSession,
} from "./trash-session";

const pending = () => getTrashSessionSnapshot().pulsePending;

beforeEach(() => {
  resetTrashSession();
});

describe("Empty Trash pulse", () => {
  it("does not arm on the initial load, even when the Trash is already full", () => {
    observeTrashCounts({ fragments: 12, frames: 0 }, true);
    expect(pending()).toBe(false);
    observeTrashCounts({ fragments: 14, frames: 0 }, true);
    expect(pending()).toBe(false);
  });

  it("ignores counts reported before the library has loaded", () => {
    observeTrashCounts({ fragments: 0, frames: 0 }, false);
    observeTrashCounts({ fragments: 3, frames: 0 }, false);
    expect(pending()).toBe(false);
    observeTrashCounts({ fragments: 3, frames: 0 }, true);
    expect(pending()).toBe(false);
  });

  it("arms once when the Trash first becomes non-empty during the session", () => {
    const listener = vi.fn();
    subscribeTrashSession(listener);

    observeTrashCounts({ fragments: 0, frames: 0 }, true);
    observeTrashCounts({ fragments: 2, frames: 0 }, true);

    expect(pending()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    consumeTrashPulse();
    expect(pending()).toBe(false);

    observeTrashCounts({ fragments: 0, frames: 0 }, true);
    observeTrashCounts({ fragments: 5, frames: 0 }, true);
    expect(pending()).toBe(false);
  });

  it("treats the first Frames listing as a baseline: a Frames-only Trash never pulses on load", () => {
    // The snapshot counts Fragments only; the Frames arrive with the Trash page.
    observeTrashCounts({ fragments: 0, frames: null }, true);
    observeTrashCounts({ fragments: 0, frames: 3 }, true);
    expect(pending()).toBe(false);

    // Nor does a Fragment landing in a Trash that already held Frames.
    observeTrashCounts({ fragments: 1, frames: 3 }, true);
    expect(pending()).toBe(false);
  });

  it("arms when a Frame lands in a Trash known to be empty", () => {
    observeTrashCounts({ fragments: 0, frames: null }, true);
    observeTrashCounts({ fragments: 0, frames: 0 }, true);
    observeTrashCounts({ fragments: 0, frames: 1 }, true);
    expect(pending()).toBe(true);
  });

  it("consuming without a pending pulse is a no-op", () => {
    const listener = vi.fn();
    subscribeTrashSession(listener);
    consumeTrashPulse();
    expect(listener).not.toHaveBeenCalled();
  });
});
