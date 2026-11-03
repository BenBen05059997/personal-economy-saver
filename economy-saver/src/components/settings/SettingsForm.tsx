"use client";

import { createContext, useContext, useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const LastSubmitted = createContext<{ last: string; setLast: (id: string) => void } | null>(null);

/** Forms inside one group share a single status line: only the form submitted last shows its message. */
export function SettingsFormGroup({ children }: { children: ReactNode }) {
  const [last, setLast] = useState("");
  return <LastSubmitted.Provider value={{ last, setLast }}>{children}</LastSubmitted.Provider>;
}

export function SettingsForm({ children, action = "/api/settings", secret = false }: {
  children: ReactNode; action?: string; secret?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const group = useContext(LastSubmitted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    if (secret) form.reset();
    setBusy(true);
    setMessage("");
    group?.setLast(id);
    try {
      const response = await fetch(action, { method: "POST", body });
      setMessage(await response.text());
      if (response.ok) router.refresh();
    } catch { setMessage("Couldn’t save. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} action={action} method="post">
    <fieldset disabled={busy}>{children}</fieldset><p role="status" className="ui-hint">{group && group.last !== id ? "" : message}</p>
  </form>;
}
