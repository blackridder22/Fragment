import { useSyncExternalStore } from "react";

/**
 * Session-level memory for the Trash page's one-time cues.
 *
 * The Empty Trash button pulses once per session, the first time the Trash
 * goes from empty to non-empty after the library has loaded. The first loaded
 * total is only a baseline, so nothing animates on initial load.
 */

type Listener = () => void;
type Snapshot = Readonly<{ pulsePending: boolean }>;

let baselineSeen = false;
let lastTotal = 0;
let pulseConsumed = false;
let snapshot: Snapshot = Object.freeze({ pulsePending: false });
const listeners = new Set<Listener>();

function publish(next: Snapshot) {
  snapshot = Object.freeze(next);
  listeners.forEach((listener) => listener());
}

export function observeTrashTotal(total: number, loaded: boolean): void {
  if (!loaded) return;
  if (!baselineSeen) {
    baselineSeen = true;
    lastTotal = total;
    return;
  }
  if (lastTotal === 0 && total > 0 && !pulseConsumed && !snapshot.pulsePending) {
    publish({ pulsePending: true });
  }
  lastTotal = total;
}

export function consumeTrashPulse(): void {
  if (!snapshot.pulsePending) return;
  pulseConsumed = true;
  publish({ pulsePending: false });
}

export function subscribeTrashSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTrashSessionSnapshot(): Snapshot {
  return snapshot;
}

/** Test helper: forget everything observed in this session. */
export function resetTrashSession(): void {
  baselineSeen = false;
  lastTotal = 0;
  pulseConsumed = false;
  publish({ pulsePending: false });
}

export function useTrashPulsePending(): boolean {
  return useSyncExternalStore(
    subscribeTrashSession,
    getTrashSessionSnapshot,
    getTrashSessionSnapshot,
  ).pulsePending;
}
