"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { currencySymbol } from "@/lib/money/format";
import { AccountFrame } from "./AccountFrame";

const currencyNames = { JPY: "Japanese yen", USD: "US dollars" } as const;

/** The one setup form: onboarding (a signed-in owner) and Start with my numbers (a blank demo) post the same fields to their own route. A name is all it needs; the bank balance is set on Home (Update): currency and time zone are read from the browser and sit behind "Change". */
export function SetupForm({ action, title, hint, button, notice, privacy = false, forwarding, after }: { after?: ReactNode; action: string; title: string; hint: string; button: string; notice?: string; privacy?: boolean; forwarding: boolean }) {
  // The browser's zone (yen for Tokyo, dollars otherwise) until the person changes it; the server renders Tokyo.
  const detected = useSyncExternalStore(() => () => {}, () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo", () => "Asia/Tokyo");
  const [picked, setPicked] = useState<{ currency?: keyof typeof currencyNames; timeZone?: string }>({});
  const timeZone = picked.timeZone ?? detected;
  const currency = picked.currency ?? (detected === "Asia/Tokyo" ? "JPY" : "USD");
  const setCurrency = (value: keyof typeof currencyNames) => setPicked(previous => ({ ...previous, currency: value }));
  const setTimeZone = (value: string) => setPicked(previous => ({ ...previous, timeZone: value }));
  const symbol = currencySymbol(currency), name = currencyNames[currency];
  return <AccountFrame title={title}>
    {notice && <p role="note" className="ui-hint"><strong>{notice}</strong></p>}
    <p className="ui-hint">{hint}</p>
    <ApiForm action={action}>
      <label className="ui-field">Your name<input name="name" autoComplete="given-name" maxLength={80} required aria-describedby="setup-name-hint" />
        <small id="setup-name-hint" className="ui-hint">It is also the household’s name until you change it in Settings.</small></label>
      <details className="setup-more" data-testid="setup-region">
        <summary>Currency: {symbol} {name} · Time zone: {timeZone} · <span className="account-link">Change</span></summary>
        <div className="account-grid">
          <label className="ui-field">Home currency<select name="currency" value={currency} onChange={event => setCurrency(event.target.value as keyof typeof currencyNames)}><option value="JPY">Japanese yen</option><option value="USD">US dollars</option></select></label>
          <label className="ui-field">Time zone<input name="timeZone" value={timeZone} onChange={event => setTimeZone(event.target.value)} maxLength={80} required /></label>
        </div>
      </details>
      <p className="ui-hint">{forwarding ? "You can add a card, set up bill forwarding and an AI key afterwards." : "You can add a card and an AI key afterwards."}</p>
      <button className="ui-button primary">{button}</button>
      {privacy && <p className="ui-hint">Your numbers stay in this browser’s demo household. <Link className="account-link" href="/privacy">Privacy ›</Link></p>}
    </ApiForm>
    {after}
  </AccountFrame>;
}
