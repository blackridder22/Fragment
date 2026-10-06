import { describe, expect, it, vi } from "vitest";
import { createStore, selectorFactory, shallowEqual } from "./create-store";

type State = { count: number; items: string[]; label: string };

describe("createStore", () => {
  it("notifies subscribers only when a value actually changes", () => {
    const store = createStore<State>({ count: 0, items: [], label: "a" });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 0 });
    expect(listener).not.toHaveBeenCalled();

    store.setState({ count: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().count).toBe(1);

    store.setState((state) => ({ label: `${state.label}b` }));
    expect(store.getState().label).toBe("ab");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore<State>({ count: 0, items: [], label: "" });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState({ count: 5 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("selectorFactory", () => {
  const createSelector = selectorFactory<State>();

  it("returns the same reference while inputs are unchanged", () => {
    const upper = createSelector([(state) => state.items], (items) =>
      items.map((item) => item.toUpperCase()),
    );
    const items = ["a"];
    const first = upper({ count: 0, items, label: "" });
    const second = upper({ count: 9, items, label: "x" });
    expect(second).toBe(first);

    const third = upper({ count: 0, items: ["b"], label: "" });
    expect(third).not.toBe(first);
    expect(third).toEqual(["B"]);
  });

  it("recomputes only once per distinct input set", () => {
    const combine = vi.fn((count: number) => count * 2);
    const doubled = createSelector([(state) => state.count], combine);
    const state: State = { count: 2, items: [], label: "" };
    doubled(state);
    doubled(state);
    doubled({ ...state });
    expect(combine).toHaveBeenCalledTimes(1);
  });
});

describe("shallowEqual", () => {
  it("compares own enumerable keys by identity", () => {
    const shared = { a: 1 };
    expect(shallowEqual({ x: shared, y: 2 }, { x: shared, y: 2 })).toBe(true);
    expect(shallowEqual({ x: shared }, { x: { a: 1 } })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [1])).toBe(false);
    expect(shallowEqual(null, {} as never)).toBe(false);
  });
});
