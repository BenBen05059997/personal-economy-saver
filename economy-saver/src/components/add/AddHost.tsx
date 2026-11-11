"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiFormNavigation } from "@/components/ui/ApiForm";
import type { AddView } from "@/db/add-view";
import { AddForm, ADD_TITLES } from "./AddForm";
import { AddContext, type AddApi, type AddKind } from "./context";
import "./add.css";

type Opened = { kind: AddKind; id: string };

/**
 * The one Add dialog, mounted once in the workspace layout. `openAdd(kind)` draws the form for that kind in a <dialog> over the
 * current page. A save closes it and refreshes the page behind (Home shows its "Added …" line); a refusal keeps it open with the
 * typed input and the route's message. Escape and Close return focus to the button that opened it.
 */
export function AddHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [view, setView] = useState<AddView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setView(null);
    setProblem(null);
    try {
      const response = await fetch("/api/add/view", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(await response.text());
      setView(await response.json() as AddView);
    } catch (error) {
      if (controller.signal.aborted) return;
      setProblem(error instanceof Error && error.message ? error.message : "The form could not be opened. Try again.");
    }
  }, []);

  const openAdd = useCallback((kind: AddKind, from: HTMLElement | null) => {
    if (!dialog.current?.open) trigger.current = from; // a link inside the open dialog keeps the first button as the one focus returns to
    setOpened({ kind, id: crypto.randomUUID() });
    void load();
  }, [load]);

  // showModal is the only way to open it: the browser gives it the backdrop, the focus trap and Escape.
  useEffect(() => {
    if (opened && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [opened]);

  // The page behind stays mounted while hidden (React Activity), so the dialog closes when the page changes and when the host unmounts.
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  useLayoutEffect(() => {
    const element = dialog.current;
    return () => { element?.close(); };
  }, []);

  function closed() {
    request.current?.abort();
    setOpened(null);
    setView(null);
    setProblem(null);
    const from = trigger.current;
    trigger.current = null;
    if (from?.isConnected) from.focus();
  }

  // Always handled here: the dialog closes, the page behind comes back fresh and the person stays where they were.
  function saved(_action: string, destination: string | null) {
    dialog.current?.close();
    const target = destination ? new URL(destination, window.location.origin) : null;
    if (target && target.pathname === window.location.pathname) router.replace(target.pathname + target.search, { scroll: false });
    else router.refresh();
    return true;
  }

  const api = useMemo<AddApi>(() => ({ openAdd }), [openAdd]);
  return <AddContext.Provider value={api}>
    {children}
    <dialog ref={dialog} className="add-dialog" aria-labelledby="add-dialog-title" onClose={closed}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      {opened && <div className="add-dialog-body">
        <header className="add-dialog-head">
          <h2 id="add-dialog-title">{ADD_TITLES[opened.kind]}</h2>
          <button type="button" className="ui-button" onClick={() => dialog.current?.close()}>Close</button>
        </header>
        {view && <ApiFormNavigation.Provider value={saved}>
          <AddForm key={`${opened.kind}-${opened.id}`} kind={opened.kind} id={opened.id} returnTo={pathname} view={view} />
        </ApiFormNavigation.Provider>}
        {!view && !problem && <p className="ui-hint" role="status">Opening…</p>}
        {problem && <p className="ui-hint" role="alert">{problem}</p>}
      </div>}
    </dialog>
  </AddContext.Provider>;
}
