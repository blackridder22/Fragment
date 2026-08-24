import { describe, expect, it } from "vitest";
import {
  containHorizontalWheelGesture,
  isHorizontalWheelGesture,
} from "./viewport-gesture";

describe("isHorizontalWheelGesture", () => {
  it("contains horizontal and horizontal-dominant trackpad gestures", () => {
    expect(isHorizontalWheelGesture({ deltaX: 80, deltaY: 0 })).toBe(true);
    expect(isHorizontalWheelGesture({ deltaX: -24, deltaY: 8 })).toBe(true);
  });

  it("preserves vertical, vertical-dominant, and idle gestures", () => {
    expect(isHorizontalWheelGesture({ deltaX: 0, deltaY: 80 })).toBe(false);
    expect(isHorizontalWheelGesture({ deltaX: 8, deltaY: -24 })).toBe(false);
    expect(isHorizontalWheelGesture({ deltaX: 0, deltaY: 0 })).toBe(false);
  });

  it("prevents a cancelable horizontal gesture at the viewport boundary", () => {
    let prevented = false;
    const contained = containHorizontalWheelGesture({
      cancelable: true,
      deltaX: 80,
      deltaY: 0,
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(contained).toBe(true);
    expect(prevented).toBe(true);
  });

  it("does not prevent vertical or non-cancelable gestures", () => {
    let preventionCount = 0;
    const preventDefault = () => {
      preventionCount += 1;
    };

    expect(
      containHorizontalWheelGesture({
        cancelable: true,
        deltaX: 4,
        deltaY: 40,
        preventDefault,
      }),
    ).toBe(false);
    expect(
      containHorizontalWheelGesture({
        cancelable: false,
        deltaX: 40,
        deltaY: 0,
        preventDefault,
      }),
    ).toBe(false);
    expect(preventionCount).toBe(0);
  });
});
