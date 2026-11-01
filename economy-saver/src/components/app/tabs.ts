"use client";

import { useCallback, useSyncExternalStore } from "react";

// The five tabs. The open one lives in location.hash (#today, #plan, #cards, #paid, #activity), so a link can open any of
// them and the back button walks through the tabs. React reads the hash through a small store.

export const TABS = [
  { id: "today", label: "Today" },
  { id: "plan", label: "Plan" },
  { id: "cards", label: "Cards" },
  { id: "paid", label: "Get paid" },
  { id: "activity", label: "Activity" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export const tabLabel = (id: TabId): string => TABS.find((t) => t.id === id)?.label ?? id;

function fromHash(hash: string): TabId {
  const id = hash.replace(/^#/, "");
  return TABS.some((t) => t.id === id) ? (id as TabId) : "today";
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("hashchange", onChange);
  };
}

export function useTab(): readonly [TabId, (id: TabId) => void] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  const set = useCallback((id: TabId) => {
    if (window.location.hash !== `#${id}`) window.location.hash = id;
    listeners.forEach((l) => l());
  }, []);
  return [fromHash(hash), set] as const;
}
