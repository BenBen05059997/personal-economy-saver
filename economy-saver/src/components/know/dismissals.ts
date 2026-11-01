"use client";

import { useCallback, useSyncExternalStore } from "react";

// "Not now" and "Never for this", kept for the life of the page and shared by every component
// that shows a move, so hiding a card in one place hides it everywhere.
export type Dismissal = "later" | "never";

const EMPTY: ReadonlyMap<string, Dismissal> = new Map();
let state: ReadonlyMap<string, Dismissal> = EMPTY;
const listeners = new Set<() => void>();

function set(id: string, value: Dismissal | undefined) {
  const next = new Map(state);
  if (value) next.set(id, value);
  else next.delete(id);
  state = next;
  listeners.forEach((l) => l());
}

/** Forget every "Not now" and "Never for this", for the demo's Reset and for switching person. */
export function resetDismissals() {
  if (state === EMPTY) return;
  state = EMPTY;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDismissals() {
  const snap = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
  const get = useCallback((id: string) => snap.get(id), [snap]);
  const later = useCallback((id: string) => set(id, "later"), []);
  const never = useCallback((id: string) => set(id, "never"), []);
  const undo = useCallback((id: string) => set(id, undefined), []);
  return { get, later, never, undo };
}
