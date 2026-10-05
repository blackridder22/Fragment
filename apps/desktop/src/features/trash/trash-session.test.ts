import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeTrashPulse,
  getTrashSessionSnapshot,
  observeTrashTotal,
  resetTrashSession,
  subscribeTrashSession,
} from "./trash-session";

beforeEach(() => {
  resetTrashSession();
});

describe("Empty Trash pulse", () => {
  it("does not arm on the initial load, even when the Trash is already full", () => {
    observeTrashTotal(12, true);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
    observeTrashTotal(14, true);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
  });

  it("ignores totals reported before the library has loaded", () => {
    observeTrashTotal(0, false);
    observeTrashTotal(3, false);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
    observeTrashTotal(3, true);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
  });

  it("arms once when the Trash first becomes non-empty during the session", () => {
    const listener = vi.fn();
    subscribeTrashSession(listener);

    observeTrashTotal(0, true);
    observeTrashTotal(2, true);

    expect(getTrashSessionSnapshot().pulsePending).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    consumeTrashPulse();
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);

    observeTrashTotal(0, true);
    observeTrashTotal(5, true);
    expect(getTrashSessionSnapshot().pulsePending).toBe(false);
  });

  it("consuming without a pending pulse is a no-op", () => {
    const listener = vi.fn();
    subscribeTrashSession(listener);
    consumeTrashPulse();
    expect(listener).not.toHaveBeenCalled();
  });
});
