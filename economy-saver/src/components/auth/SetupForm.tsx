"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { AccountFrame } from "./AccountFrame";

const currencies = {
  JPY: { symbol: "¥", example: "420,000", name: "Japanese yen" },
  USD: { symbol: "$", example: "2,800", name: "US dollars" },
} as const;

/** The one setup form: onboarding (a signed-in owner) and Start with my numbers (a blank demo) post the same fields to their own route. A name and today's bank balance are all it needs (D51): currency and time zone are read from the browser and sit behind "Change", the card behind "Add a card now". */
export function SetupForm({ action, title, hint, button, notice, privacy = false }: { action: string; title: string; hint: string; button: string; notice?: string; privacy?: boolean }) {
  // The browser's zone (yen for Tokyo, dollars otherwise) until the person changes it; the server renders Tokyo.
  const detected = useSyncExternalStore(() => () => {}, () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo", () => "Asia/Tokyo");
  const [picked, setPicked] = useState<{ currency?: keyof typeof currencies; timeZone?: string }>({});
  const timeZone = picked.timeZone ?? detected;
  const currency = picked.currency ?? (detected === "Asia/Tokyo" ? "JPY" : "USD");
  const setCurrency = (value: keyof typeof currencies) => setPicked(previous => ({ ...previous, currency: value }));
  const setTimeZone = (value: string) => setPicked(previous => ({ ...previous, timeZone: value }));
  const { symbol, example, name } = currencies[currency];
  return <AccountFrame title={title}>
    {notice && <p role="note" className="ui-hint"><strong>{notice}</strong></p>}
    <p className="ui-hint">{hint}</p>
    <ApiForm action={action}>
      <label className="ui-field">Your name<input name="name" autoComplete="given-name" maxLength={80} required aria-describedby="setup-name-hint" />
        <small id="setup-name-hint" className="ui-hint">It is also the household’s name until you change it in Settings.</small></label>
      <label className="ui-field">What’s in your bank today?
        <span className="account-prefixed"><span aria-hidden="true">{symbol}</span><input name="bank" type="text" inputMode="decimal" maxLength={16} required placeholder={example} /></span></label>
      <details className="setup-more" data-testid="setup-region">
        <summary>{name} · {timeZone} · <span className="account-link">Change</span></summary>
        <div className="account-grid">
          <label className="ui-field">Home currency<select name="currency" value={currency} onChange={event => setCurrency(event.target.value as keyof typeof currencies)}><option value="JPY">Japanese yen</option><option value="USD">US dollars</option></select></label>
          <label className="ui-field">Time zone<input name="timeZone" value={timeZone} onChange={event => setTimeZone(event.target.value)} maxLength={80} required /></label>
        </div>
      </details>
      <details className="setup-more" data-testid="setup-card">
        <summary><span className="account-link">Add a card now ›</span></summary>
        <label className="ui-field">Card name<input name="card" placeholder="Card A" maxLength={80} /></label>
        <div className="account-grid">
          <label className="ui-field">Statement closes on the<input name="closingDay" type="number" min="1" max="31" aria-describedby="setup-closing-hint" />
            <small id="setup-closing-hint" className="ui-hint">Day of the month, like 15</small></label>
          <label className="ui-field">Card bill is paid on the<input name="dueDay" type="number" min="1" max="31" aria-describedby="setup-payment-hint" />
            <small id="setup-payment-hint" className="ui-hint">Day of the next month, like 10</small></label>
        </div>
        <label className="ui-field">Credit limit (optional)<span className="account-prefixed"><span aria-hidden="true">{symbol}</span><input name="limit" inputMode="decimal" maxLength={16} /></span></label>
      </details>
      <p className="ui-hint">You can add a card, set up bill forwarding and an AI key later.</p>
      <button className="ui-button primary">{button}</button>
      {privacy && <p className="ui-hint">Your numbers stay in this browser’s demo household. <Link className="account-link" href="/privacy">Privacy ›</Link></p>}
    </ApiForm>
  </AccountFrame>;
}
