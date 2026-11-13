"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import "./home-views.css";

const memory = new Map<string, string>();

/** A choice kept on this device (D59), read the hydration-safe way: the server and the first client render use `initial`, then the stored value. Where storage is blocked the choice lasts for the page. */
export function useDevicePreference(key: string, initial: string): [string, (value: string) => void] {
  const event = `${key}-change`;
  const value = useSyncExternalStore(
    callback => { window.addEventListener(event, callback); window.addEventListener("storage", callback); return () => { window.removeEventListener(event, callback); window.removeEventListener("storage", callback); }; },
    () => { try { return localStorage.getItem(key) ?? memory.get(key) ?? initial; } catch { return memory.get(key) ?? initial; } },
    () => initial,
  );
  return [value, next => { memory.set(key, next); try { localStorage.setItem(key, next); } catch { /* The controls still work on this page. */ } window.dispatchEvent(new Event(event)); }];
}

/** A row of buttons of which one is pressed. */
export function Segmented<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly (readonly [T, string])[]; onPick: (value: T) => void }) {
  return <div role="group" aria-label={label}>{options.map(([id, text]) => <button type="button" key={id} aria-pressed={value === id} onClick={() => onPick(id)}>{text}</button>)}</div>;
}

export const DISPLAY_OPTIONS = [["chart", "Chart"], ["table", "Table"]] as const;

/** The panel's title and hint, and "Ask about this" (left out when there is no question): it opens the Ask panel with the view's question, or Ask itself where there is no panel. */
export function PanelHeader({ title, hint, question }: { title: ReactNode; hint: string; question?: string }) {
  const panel = useAskPanel(), router = useRouter();
  function ask(button: HTMLElement) {
    if (question === undefined) return;
    if (panel) { panel.ask(question, button); return; }
    try { sessionStorage.setItem("pes-ask-submit", JSON.stringify({ id: crypto.randomUUID(), question })); } catch { /* The person can still type the question. */ }
    router.push("/canvas#ask");
  }
  return <header><div><h2>{title}</h2><p>{hint}</p></div>{question !== undefined && <button type="button" onClick={event => ask(event.currentTarget)}>Ask about this</button>}</header>;
}
