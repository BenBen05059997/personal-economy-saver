"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function SettingsForm({ children, action = "/api/settings", secret = false }: {
  children: ReactNode; action?: string; secret?: boolean;
}) {
  const router = useRouter();
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
    try {
      const response = await fetch(action, { method: "POST", body });
      setMessage(await response.text());
      if (response.ok) router.refresh();
    } catch { setMessage("Couldn’t save. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} action={action} method="post">
    <fieldset disabled={busy}>{children}</fieldset><p role="status" className="ui-hint">{message}</p>
  </form>;
}
