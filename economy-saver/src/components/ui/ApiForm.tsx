"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";

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
 * and the route answers with its 303 redirect (lib/form-fetch.ts). `secret` clears the fields as soon as they are sent; `onDone` runs once the route accepts the post.
 */
export function ApiForm({ children, action = "/api/settings", secret = false, className, onDone }: {
  children: ReactNode; action?: string; secret?: boolean; className?: string; onDone?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const group = useContext(LastSubmitted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const shown = group && group.last !== id ? "" : message;
  // A refusal at phone width can land behind the fixed Ask bar: bring the message into view (the status line's scroll-margin keeps it clear of the bar).
  useEffect(() => { if (shown) status.current?.scrollIntoView({ block: "nearest" }); }, [shown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = new FormData(form, (event.nativeEvent as SubmitEvent).submitter); // the pressed button's own name and value go along
    if (secret) form.reset();
    setBusy(true);
    setMessage("");
    group?.setLast(id);
    try {
      const response = await fetch(action, { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
      if (response.ok) onDone?.();
      const destination = response.ok ? response.headers.get(FORM_REDIRECT_HEADER) : null;
      if (destination) {
        if (destination === window.location.pathname + window.location.search) router.refresh();
        else router.push(destination);
      } else {
        setMessage(await response.text());
        if (response.ok) router.refresh();
      }
    } catch { setMessage("Couldn’t save. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} action={action} method="post" className={className ? `ui-form ${className}` : "ui-form"} aria-busy={busy} onInput={() => setMessage("")}>
    <fieldset disabled={busy}>{children}</fieldset><p ref={status} role="status" className="ui-hint ui-form-status">{shown}</p>
  </form>;
}
