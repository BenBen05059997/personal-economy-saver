"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * A panel the person can hide, kept on this device (D59): `name` is both the storage key's prefix and the event other tabs and panels hear.
 * `hiddenOnServer` is what the server and the first client render assume until the stored choice is read. Returns whether the panel is hidden and the function that hides it.
 */
export function useHidePanel(name: string, householdId: string, hiddenOnServer: boolean): [boolean, () => void] {
  const key = `${name}:${householdId}`;
  const [locallyHidden, setLocallyHidden] = useState(false);
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener("storage", callback);
    window.addEventListener(name, callback);
    return () => { window.removeEventListener("storage", callback); window.removeEventListener(name, callback); };
  }, [name]);
  const stored = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) === "yes"; } catch { return false; }
  }, () => hiddenOnServer);
  function hide() {
    setLocallyHidden(true);
    try { localStorage.setItem(key, "yes"); window.dispatchEvent(new Event(name)); } catch { /* Device storage may be unavailable. */ }
  }
  return [stored || locallyHidden, hide];
}
