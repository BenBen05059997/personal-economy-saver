"use client";

import { useState } from "react";
import Link from "next/link";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";

/** Try it households only: a two-step reset, asked on the page itself (no confirm() dialog). */
export function ResetDemo() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function reset() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/try/reset", {
        method: "POST", headers: { [FORM_FETCH_HEADER]: "1" }, redirect: "error",
      });
      const destination = response.headers.get(FORM_REDIRECT_HEADER);
      if (response.status === 204 && destination) { window.location.assign(destination); return; }
      setMessage(response.ok ? "Couldn’t open Home after reset. Reload to try again." : await response.text());
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
    </> : <>
      <button type="button" className="ui-button" onClick={() => { setMessage(""); setAsking(true); }}>Reset to Ben’s starting numbers</button>
      <p className="ui-hint">Puts Ben’s fictional starting numbers back.</p>
    </>}
    <p className="ui-hint"><Link href="/start">Start over with my numbers ›</Link></p>
    <p className="ui-hint">Replaces this household with a blank one and your own numbers.</p>
    <p role="status" className="ui-hint">{message}</p>
  </div>;
}
