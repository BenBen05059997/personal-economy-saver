"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Try it households only: a two-step reset, asked on the page itself (no confirm() dialog). */
export function ResetDemo() {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function reset() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/try/reset", { method: "POST" });
      if (response.ok) { router.push("/"); router.refresh(); return; }
      setMessage(await response.text());
    } catch { setMessage("Couldn’t reset. Check your connection and try again."); }
    setBusy(false);
    setAsking(false);
  }
  return <div className="settings-reset">
    {asking ? <>
      <p>Everything you added goes. Reset?</p>
      <div className="settings-actions">
        <button type="button" className="ui-button primary" disabled={busy} onClick={reset}>Reset</button>
        <button type="button" className="ui-button" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
      </div>
    </> : <button type="button" className="ui-button" onClick={() => { setMessage(""); setAsking(true); }}>Reset to Ben’s starting numbers</button>}
    <p role="status" className="ui-hint">{message}</p>
  </div>;
}
