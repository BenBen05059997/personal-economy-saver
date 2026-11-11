"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { storeDraft } from "@/components/ask/draft";
import { readPanelChoice, writePanelChoice, type PanelChoice } from "@/components/ask/panel-preferences";
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
const WIDE_WIDTH = "(min-width: 1200px)";
function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_WIDTH);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const isWide = () => window.matchMedia(WIDE_WIDTH).matches;

const AskPanel = createContext<{
  available: boolean; desktop: boolean; visible: boolean; revision: number; open: (trigger: HTMLElement) => void; close: () => void; ask: (question: string, trigger: HTMLElement) => void; invalidate: () => void; returnFromAsk: () => void;
} | null>(null);

export const useAskPanel = () => useContext(AskPanel);

/** The stable part of the shell. Route content can change without moving the panel subtree. */
export function AskWorkspace({ householdId, children }: { householdId: string; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, serverDesktop);
  const wide = useSyncExternalStore(subscribeWide, isWide, serverDesktop);
  const available = desktop && pathname !== "/canvas";
  const [preferences, setPreferences] = useState<PanelChoice>({ open: null, spaceId: null });
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<AskView | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<"missing" | "ended" | "other" | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [revision, setRevision] = useState(0);
  const [handoff, setHandoff] = useState<{ id: string; question: string } | null>(null);
  const restored = useRef(false);
  const lastPage = useRef<string | null>(null);
  const previousPath = useRef(pathname);
  const opener = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const visible = ready && available && (preferences.open ?? (wide && pathname !== "/setup"));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (restored.current) return;
      restored.current = true;
      try { setPreferences(readPanelChoice(window.sessionStorage, householdId)); } catch { /* Browser storage can be blocked. */ }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [householdId]);

  useEffect(() => {
    if (pathname !== "/canvas") lastPage.current = `${pathname}${search ? `?${search}` : ""}`;
  }, [pathname, search]);

  function remember(next: PanelChoice) {
    restored.current = true;
    setReady(true);
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
    if (!ready || !restored.current) return;
    try { writePanelChoice(window.sessionStorage, householdId, preferences); } catch { /* Browser storage can be blocked. */ }
  }, [householdId, preferences, ready]);

  function open(trigger: HTMLElement) {
    if (!available) return;
    opener.current = trigger;
    remember({ ...preferences, open: true });
    setFocusRequest(current => current + 1);
  }

  function ask(question: string, trigger: HTMLElement) {
    if (!question.trim()) return;
    if (!available) {
      try { window.sessionStorage.setItem("pes-ask-submit", JSON.stringify({ id: crypto.randomUUID(), question })); } catch { storeDraft({ text: question, source: "manual" }); }
      router.push("/canvas#ask");
      return;
    }
    open(trigger);
    setHandoff({ id: crypto.randomUUID(), question });
  }

  const close = useCallback(() => {
    restored.current = true;
    setReady(true);
    setPreferences(current => ({ ...current, open: false }));
    if (opener.current?.isConnected) opener.current.focus();
    else document.getElementById("shell-top-ask")?.focus();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(":popover-open, dialog[open]")) return;
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

  // Turns asked on the full page show in the panel once the person leaves it.
  useEffect(() => {
    const left = previousPath.current === "/canvas" && pathname !== "/canvas";
    previousPath.current = pathname;
    if (left) invalidate();
  }, [invalidate, pathname]);

  function returnFromAsk() {
    const space = new URLSearchParams(window.location.search).get("space");
    remember({ open: true, spaceId: space });
    router.push(lastPage.current ?? "/");
  }

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

  return <AskPanel.Provider value={{ available, desktop, visible, revision, open, close, ask, invalidate, returnFromAsk }}>
    <div className="ask-workspace" data-ask-open={visible || undefined}>
      <div className="ask-workspace-page"><ApiFormNavigation.Provider value={pageFormSaved}>
        {children}
      </ApiFormNavigation.Provider></div>
      {(visible || view) && <Activity mode={visible ? "visible" : "hidden"}>
        <aside id="shell-ask-panel" className="ask-workspace-panel" aria-label="Ask panel">
          {!view && <header className="ask-panel-head">
            <h2 className="ask-panel-title">Ask</h2>
            <button type="button" className="ask-icon-button ask-panel-close" aria-label="Close Ask" onClick={close}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </header>}
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
              chooseSpace={chooseSpace} onPanelChange={changed} onClose={close} handoff={handoff}
              onHandoffHandled={id => setHandoff(current => current?.id === id ? null : current)} />
          </ApiFormNavigation.Provider>}
        </aside>
      </Activity>}
    </div>
  </AskPanel.Provider>;
}
