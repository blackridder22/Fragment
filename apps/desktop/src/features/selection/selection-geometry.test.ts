import { describe, expect, it } from "vitest";
import {
  hasSelectableRectProvider,
  registerSelectableRects,
  selectableRectsFor,
} from "./selection-geometry";

describe("selection geometry registry", () => {
  it("returns null for containers without a provider", () => {
    const container = { tag: "main" } as unknown as Element;
    expect(selectableRectsFor(container)).toBeNull();
    expect(hasSelectableRectProvider(container)).toBe(false);
  });

  it("concatenates providers in registration order and unregisters cleanly", () => {
    const container = { tag: "main" } as unknown as Element;
    const other = { tag: "other" } as unknown as Element;
    const rectA = { id: "a", left: 0, right: 10, top: 0, bottom: 10 };
    const rectB = { id: "b", left: 20, right: 30, top: 0, bottom: 10 };
    const unregisterA = registerSelectableRects(container, () => [rectA]);
    const unregisterB = registerSelectableRects(container, () => [rectB]);

    expect(selectableRectsFor(container)).toEqual([rectA, rectB]);
    expect(selectableRectsFor(other)).toBeNull();

    unregisterA();
    expect(selectableRectsFor(container)).toEqual([rectB]);
    unregisterB();
    expect(selectableRectsFor(container)).toBeNull();
    expect(() => unregisterB()).not.toThrow();
  });
});
