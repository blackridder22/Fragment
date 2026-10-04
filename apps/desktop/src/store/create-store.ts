import { useRef, useSyncExternalStore } from "react";
import type { LibraryState } from "./library-types";

export type Listener = () => void;

export type Store<S> = {
  getState: () => S;
  setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => void;
  subscribe: (listener: Listener) => () => void;
};

/**
 * Minimal external store: synchronous `setState`, listeners notified after
 * every change, no React dependency. Pages subscribe through selectors.
 */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState(partial) {
      const patch = typeof partial === "function" ? partial(state) : partial;
      let changed = false;
      for (const key in patch) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left) as Array<keyof T>;
  const rightKeys = Object.keys(right) as Array<keyof T>;
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      Object.is(left[key], right[key]),
  );
}

type SelectionCache<S, T> = {
  state: S;
  selector: (state: S) => T;
  value: T;
};

/**
 * Builds a `useStore(selector, equality)` hook for a store. The selector runs
 * at most once per state change per component; `equality` lets selectors that
 * build new objects keep the previous reference when nothing changed.
 */
export function createUseStore<S extends object>(store: Store<S>) {
  return function useStore<T>(
    selector: (state: S) => T,
    equality: (left: T, right: T) => boolean = Object.is,
  ): T {
    const cache = useRef<SelectionCache<S, T> | null>(null);
    const read = () => {
      const state = store.getState();
      const previous = cache.current;
      if (
        previous &&
        previous.state === state &&
        previous.selector === selector
      ) {
        return previous.value;
      }
      const next = selector(state);
      const value =
        previous && equality(previous.value, next) ? previous.value : next;
      cache.current = { state, selector, value };
      return value;
    };
    return useSyncExternalStore(store.subscribe, read, read);
  };
}

/**
 * Memoizes a derived value on the identity of its inputs. Selectors built with
 * it return the same reference while their inputs are unchanged, which keeps
 * memoized components from re-rendering.
 */
export function selectorFactory<S>() {
  return function createSelector<const I extends readonly unknown[], R>(
    inputs: { [K in keyof I]: (state: S) => I[K] },
    combine: (...args: I) => R,
  ): (state: S) => R {
    let lastInputs: I | null = null;
    let lastResult: R;
    return (state) => {
      const next = inputs.map((input) => input(state)) as unknown as I;
      if (
        lastInputs &&
        next.length === lastInputs.length &&
        next.every((value, index) => Object.is(value, lastInputs![index]))
      ) {
        return lastResult;
      }
      lastInputs = next;
      lastResult = combine(...next);
      return lastResult;
    };
  };
}

/** Memoized selector factory bound to the library state. */
export const createSelector = selectorFactory<LibraryState>();
