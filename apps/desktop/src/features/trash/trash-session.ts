import { useSyncExternalStore } from "react";

/**
 * Session-level memory for the Trash page's one-time cues.
 *
 * The Empty Trash button pulses once per session, the first time the Trash
 * goes from empty to non-empty after the library has loaded. Fragments and
 * Frames are observed as separate components because the snapshot only counts
 * Fragments: trashed Frames arrive with the first Trash page load, and that
 * arrival is a baseline, never a change. Nothing animates on initial load.
 */

type Listener = () => void;
type Snapshot = Readonly<{ pulsePending: boolean }>;

export type TrashCounts = {
  fragments: number;
  /** `null` until the trashed Frames have been listed once. */
  frames: number | null;
};

let fragmentsSeen: number | null = null;
let framesSeen: number | null = null;
let pulseConsumed = false;
let snapshot: Snapshot = Object.freeze({ pulsePending: false });
const listeners = new Set<Listener>();

function publish(next: Snapshot) {
  snapshot = Object.freeze(next);
  listeners.forEach((listener) => listener());
}

export function observeTrashCounts(counts: TrashCounts, loaded: boolean): void {
  if (!loaded) return;
  // Only components seen before count as "the Trash was empty"; a component
  // reporting for the first time sets its baseline without arming anything.
  const knownBefore = (fragmentsSeen ?? 0) + (framesSeen ?? 0);
  let becameNonEmpty = false;
  if (fragmentsSeen !== null && knownBefore === 0 && counts.fragments > 0) {
    becameNonEmpty = true;
  }
  fragmentsSeen = counts.fragments;
  if (counts.frames !== null) {
    if (framesSeen !== null && knownBefore === 0 && counts.frames > 0) {
      becameNonEmpty = true;
    }
    framesSeen = counts.frames;
  }
  if (becameNonEmpty && !pulseConsumed && !snapshot.pulsePending) {
    publish({ pulsePending: true });
  }
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
  fragmentsSeen = null;
  framesSeen = null;
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
