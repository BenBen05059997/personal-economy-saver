"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { Activity, createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CLOSED_PANEL, readPanelPreferences, writePanelPreferences } from "@/components/ask/panel-preferences";
import { ApiFormNavigation } from "@/components/ui/ApiForm";
import { LoadingIndicator } from "@/components/ui/LoadingState";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { askScreenForPath } from "@/lib/agent/screen";
import type { AskView } from "@/db/ask-view";
import "./ask-workspace.css";

const AskPage = dynamic(() => import("@/components/ask/AskPage").then(module => module.AskPage), {
  loading: () => <LoadingIndicator label="Opening Ask…" />,
});

const PANEL_WIDTH = "(min-width: 900px)";
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(PANEL_WIDTH);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const isDesktop = () => window.matchMedia(PANEL_WIDTH).matches;
const serverDesktop = () => false;

const AskPanel = createContext<{
  available: boolean; visible: boolean; revision: number; open: (trigger: HTMLElement) => void; invalidate: () => void;
} | null>(null);

export const useAskPanel = () => useContext(AskPanel);

/** The stable part of the shell. Route content can change without moving the panel subtree. */
export function AskWorkspace({ householdId, children }: { householdId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, serverDesktop);
  const available = desktop && pathname !== "/canvas";
  const [preferences, setPreferences] = useState(CLOSED_PANEL);
  const [view, setView] = useState<AskView | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<"missing" | "ended" | "other" | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revision, setRevision] = useState(0);
  const restored = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const visible = available && preferences.open;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (restored.current) return;
      restored.current = true;
      try { setPreferences(readPanelPreferences(window.sessionStorage, householdId)); } catch { /* Browser storage can be blocked. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [householdId]);

  function remember(next: typeof CLOSED_PANEL) {
    restored.current = true;
    setPreferences(next);
  }

  const load = useCallback(async (spaceId: string | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setProblem(null);
    try {
      const query = spaceId ? `?space=${encodeURIComponent(spaceId)}` : "";
      const response = await fetch(`/api/ask/view${query}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setView(null);
        setProblem("ended");
      } else if (!response.ok) {
        setProblem(response.status === 404 ? "missing" : "other");
      } else {
        const next: AskView = await response.json();
        if (controller.signal.aborted) return;
        if (next.householdId !== householdId) {
          setView(null);
          setProblem("ended");
        } else {
          setView(next);
          setPreferences(current => {
            if (current.spaceId === next.space.id) return current;
            return { ...current, spaceId: next.space.id };
          });
        }
      }
    } catch {
      if (!controller.signal.aborted) setProblem("other");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!visible || view || loading || problem) return;
    const frame = requestAnimationFrame(() => void load(preferences.spaceId));
    return () => cancelAnimationFrame(frame);
  }, [load, loading, preferences.spaceId, problem, view, visible]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!restored.current) return;
    try { writePanelPreferences(window.sessionStorage, householdId, preferences); } catch { /* Browser storage can be blocked. */ }
  }, [householdId, preferences]);

  function open(trigger: HTMLElement) {
    if (!available) return;
    opener.current = trigger;
    remember({ ...preferences, open: true });
    setFocusRequest(current => current + 1);
  }

  const close = useCallback(() => {
    setPreferences(current => ({ ...current, open: false }));
    if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById("shell-top-ask")?.focus();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(":popover-open")) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, visible]);

  function chooseSpace(spaceId: string | null) {
    remember({ open: preferences.open, spaceId });
    void load(spaceId);
  }

  function changed() {
    setRevision(current => current + 1);
    router.refresh();
    void load(view?.space.id ?? null);
  }

  const invalidate = useCallback(() => {
    setRevision(current => current + 1);
    request.current?.abort();
    setView(null);
    setProblem(null);
    setLoading(false);
  }, []);

  function pageFormSaved(action: string) {
    if (action === "/api/data" || action === "/api/spaces" || action === "/api/settings/ai-model" || action === "/api/restore") invalidate();
    return false;
  }

  function formSaved(action: string, destination: string | null) {
    const newSpace = action === "/api/spaces" ? /^\/canvas\?space=([0-9a-f-]{36})$/.exec(destination ?? "")?.[1] : null;
    if (newSpace && newSpace !== view?.space.id) {
      router.refresh();
      chooseSpace(newSpace);
    } else {
      changed();
    }
    return true;
  }

  return <AskPanel.Provider value={{ available, visible, revision, open, invalidate }}>
    <div className="ask-workspace" data-ask-open={visible || undefined}>
      <div className="ask-workspace-page"><ApiFormNavigation.Provider value={pageFormSaved}>
        {children}
      </ApiFormNavigation.Provider></div>
      {(visible || view) && <Activity mode={visible ? "visible" : "hidden"}>
        <aside id="shell-ask-panel" className="ask-workspace-panel" aria-label="Ask panel">
          <button type="button" className="ui-button ask-panel-close" onClick={close}>Close</button>
          {loading && <LoadingIndicator label="Opening Ask…" />}
          {problem && <div className="ask-panel-problem" role="alert">
            {problem === "ended" ? <SessionEnded /> : <>
              <p>{problem === "missing" ? "That space could not be found." : "Ask could not be opened. Try again."}</p>
              <button type="button" className="ui-button" onClick={() => chooseSpace(problem === "missing" ? null : preferences.spaceId)}>
                {problem === "missing" ? "Open General" : "Retry"}
              </button>
            </>}
          </div>}
          {view && <ApiFormNavigation.Provider value={formSaved}>
            <AskPage key={view.space.id} {...view} variant="panel" screen={askScreenForPath(pathname)} focusRequest={focusRequest}
              chooseSpace={chooseSpace} onPanelChange={changed} />
          </ApiFormNavigation.Provider>}
        </aside>
      </Activity>}
    </div>
  </AskPanel.Provider>;
}
