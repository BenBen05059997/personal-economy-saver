"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";

export const ApiFormNavigation = createContext<((action: string, destination: string | null) => boolean) | null>(null);

const LastSubmitted = createContext<{ last: string; setLast: (id: string) => void } | null>(null);

/** Forms inside one group share a single status line: only the form submitted last shows its message. */
export function ApiFormGroup({ children }: { children: ReactNode }) {
  const [last, setLast] = useState("");
  return <LastSubmitted.Provider value={{ last, setLast }}>{children}</LastSubmitted.Provider>;
}

/**
 * The one form that posts to an /api route. It posts with fetch and keeps the person on the page: a refusal shows the
 * route's own message in the status line under the form and keeps what was typed; an accepted post refreshes the page,
 * or, when the route answers with a redirect, goes to where it points. Without JavaScript the same form posts natively
 * and the route answers with its 303 redirect (lib/form-fetch.ts). `secret` clears the fields as soon as they are sent. `onDone` receives
 * the accepted response before navigation or refresh.
 */
export function ApiForm({ children, action = "/api/settings", secret = false, className, onDone }: {
  children: ReactNode; action?: string; secret?: boolean; className?: string; onDone?: (response: Response) => void | Promise<void>;
}) {
  const router = useRouter();
  const id = useId();
  const group = useContext(LastSubmitted);
  const navigateAfterSave = useContext(ApiFormNavigation);
  const [busy, setBusy] = useState(false);
  // Navigation after a post runs as a transition, so the form stays busy until the next page has rendered.
  const [navigating, startNavigation] = useTransition();
  const pressed = useRef<HTMLElement | null>(null);
  const working = busy || navigating;
  const [message, setMessage] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const shown = group && group.last !== id ? "" : message;
  // A refusal at phone width can land behind the fixed Ask bar: bring the message into view (the status line's scroll-margin keeps it clear of the bar).
  useEffect(() => { if (shown) status.current?.scrollIntoView({ block: "nearest" }); }, [shown]);
  // The pressed button shows the spinner (`[data-pending]` in controls.css) until the post and any navigation finish.
  useEffect(() => { if (!working) { pressed.current?.removeAttribute("data-pending"); pressed.current = null; } }, [working]);
  // A page kept hidden after navigation (React Activity) drops its spinner too.
  useEffect(() => () => { pressed.current?.removeAttribute("data-pending"); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const body = new FormData(form, submitter); // the pressed button's own name and value go along
    pressed.current = submitter ?? form.querySelector<HTMLElement>("button:not([type=button])");
    pressed.current?.setAttribute("data-pending", "");
    if (secret) form.reset();
    setBusy(true);
    setMessage("");
    group?.setLast(id);
    try {
      const response = await fetch(action, { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
      if (response.ok && onDone) await onDone(response.clone());
      const destination = response.ok ? response.headers.get(FORM_REDIRECT_HEADER) : null;
      if (response.ok && navigateAfterSave?.(action, destination)) {
        if (!destination) setMessage(await response.text());
      } else if (destination) {
        if (destination === window.location.pathname + window.location.search) startNavigation(() => router.refresh());
        else startNavigation(() => router.push(destination));
      } else {
        setMessage(await response.text());
        if (response.ok) startNavigation(() => router.refresh());
      }
    } catch { setMessage("Couldn’t save. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} action={action} method="post" className={className ? `ui-form ${className}` : "ui-form"} aria-busy={working} onInput={() => setMessage("")}>
    <fieldset disabled={working}>{children}</fieldset><p ref={status} role="status" className="ui-hint ui-form-status">{shown}</p>
  </form>;
}
