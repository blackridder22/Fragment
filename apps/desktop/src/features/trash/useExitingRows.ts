import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RenderedRow<T> = {
  row: T;
  /** The row's action is in flight; the row stays in place, dimmed. */
  pending: boolean;
  /** The row's action succeeded; the row collapses before it unmounts. */
  exiting: boolean;
};

type Options = {
  /** Length of the collapse. 0 removes rows immediately. */
  durationMs: number;
};

function union(set: ReadonlySet<string>, keys: readonly string[]) {
  const next = new Set(set);
  keys.forEach((key) => next.add(key));
  return next;
}

function difference(set: ReadonlySet<string>, keys: readonly string[]) {
  const next = new Set(set);
  keys.forEach((key) => next.delete(key));
  return next;
}

/**
 * Keeps rows mounted for an exit animation after the data no longer contains
 * them. Call `holdRows` before the backend action and `releaseRows` after it
 * resolves; rows that disappear for any other reason (filters, reloads, the
 * initial load) never animate.
 */
export function useExitingRows<T extends { key: string }>(
  rows: readonly T[],
  { durationMs }: Options,
) {
  const rowsRef = useRef<readonly T[]>(rows);
  const heldRef = useRef(new Map<string, T>());
  const orderRef = useRef<string[]>([]);
  const timersRef = useRef(new Set<number>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [exitingKeys, setExitingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    },
    [],
  );

  const holdRows = useCallback((keys: readonly string[]) => {
    const current = rowsRef.current;
    const byKey = new Map(current.map((row) => [row.key, row]));
    keys.forEach((key) => {
      const row = byKey.get(key);
      if (row) heldRef.current.set(key, row);
    });
    orderRef.current = current.map((row) => row.key);
    setPendingKeys((previous) => union(previous, keys));
  }, []);

  const releaseRows = useCallback(
    (keys: readonly string[], animate: boolean) => {
      setPendingKeys((previous) => difference(previous, keys));
      if (!animate || durationMs <= 0 || typeof window === "undefined") {
        keys.forEach((key) => heldRef.current.delete(key));
        return;
      }
      setExitingKeys((previous) => union(previous, keys));
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        keys.forEach((key) => heldRef.current.delete(key));
        setExitingKeys((previous) => difference(previous, keys));
      }, durationMs);
      timersRef.current.add(timer);
    },
    [durationMs],
  );

  const renderedRows = useMemo<RenderedRow<T>[]>(() => {
    if (pendingKeys.size === 0 && exitingKeys.size === 0) {
      return rows.map((row) => ({ row, pending: false, exiting: false }));
    }
    const live = new Map(rows.map((row) => [row.key, row]));
    const output: RenderedRow<T>[] = [];
    const seen = new Set<string>();
    const order =
      exitingKeys.size > 0 ? orderRef.current : rows.map((row) => row.key);
    for (const key of order) {
      const liveRow = live.get(key);
      if (liveRow) {
        output.push({
          row: liveRow,
          pending: pendingKeys.has(key),
          exiting: exitingKeys.has(key),
        });
        seen.add(key);
        continue;
      }
      const held = exitingKeys.has(key) ? heldRef.current.get(key) : undefined;
      if (held) {
        output.push({ row: held, pending: false, exiting: true });
        seen.add(key);
      }
    }
    for (const row of rows) {
      if (!seen.has(row.key)) {
        output.push({
          row,
          pending: pendingKeys.has(row.key),
          exiting: exitingKeys.has(row.key),
        });
      }
    }
    return output;
  }, [exitingKeys, pendingKeys, rows]);

  return { renderedRows, holdRows, releaseRows };
}
