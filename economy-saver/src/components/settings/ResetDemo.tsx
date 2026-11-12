"use client";

import { useState } from "react";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";

/** Try it households only: the one reset, a compact control that asks once on the page itself (no confirm() dialog). Used in the top banner (short question, it replaces the banner text while asking) and, at phone width, the account menu (long question). */
export function ResetDemo({ long = false }: { long?: boolean }) {
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
  return <span className="reset-demo" data-asking={asking || undefined}>
    {asking ? <>
      <span className="reset-demo-ask">{long ? "Put Ben’s starting numbers back? Everything you changed goes." : "Reset to Ben’s starting numbers?"}</span>
      <button type="button" className="reset-demo-button" disabled={busy} onClick={reset}>Reset</button>
      <button type="button" className="reset-demo-button" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
    </> : <button type="button" className="reset-demo-button" onClick={() => { setMessage(""); setAsking(true); }}>Reset</button>}
    <span role="status" className="reset-demo-message">{message}</span>
  </span>;
}
