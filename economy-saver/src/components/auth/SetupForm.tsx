"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { AccountFrame } from "./AccountFrame";

const currencies = {
  JPY: { symbol: "¥", example: "420,000" },
  USD: { symbol: "$", example: "2,800" },
} as const;

/** The one setup form: onboarding (a signed-in owner) and Start with my numbers (a blank demo) post the same fields to their own route. */
export function SetupForm({ action, title, hint, button, notice, privacy = false }: { action: string; title: string; hint: string; button: string; notice?: string; privacy?: boolean }) {
  const [currency, setCurrency] = useState<keyof typeof currencies>("JPY");
  const { symbol, example } = currencies[currency];
  return <AccountFrame title={title}>
    {notice && <p role="note" className="ui-hint"><strong>{notice}</strong></p>}
    <p className="ui-hint">{hint}</p>
    <ApiForm action={action}>
      <label className="ui-field">Your display name<input name="name" autoComplete="given-name" maxLength={80} required aria-describedby="setup-name-hint" />
        <small id="setup-name-hint" className="ui-hint">Your name. It is also the household’s name until you change it in Settings.</small></label>
      <div className="account-grid">
        <label className="ui-field">Home currency<select name="currency" value={currency} onChange={event => setCurrency(event.target.value as keyof typeof currencies)}><option value="JPY">Japanese yen</option><option value="USD">US dollars</option></select></label>
        <label className="ui-field">Time zone<input name="timeZone" defaultValue="Asia/Tokyo" maxLength={80} required /></label>
      </div>
      <label className="ui-field">Current bank balance
        <span className="account-prefixed"><span aria-hidden="true">{symbol}</span><input name="bank" type="text" inputMode="decimal" maxLength={16} required placeholder={example} /></span></label>
      <label className="ui-field">Card label<input name="card" placeholder="Card A" maxLength={80} required /></label>
      <div className="account-grid">
        <label className="ui-field">Closing day<input name="closingDay" type="number" min="1" max="31" required aria-describedby="setup-closing-hint" />
          <small id="setup-closing-hint" className="ui-hint">The day your card statement closes, like 15</small></label>
        <label className="ui-field">Payment day<input name="dueDay" type="number" min="1" max="31" required aria-describedby="setup-payment-hint" />
          <small id="setup-payment-hint" className="ui-hint">The day that statement is paid, like 10 of the next month</small></label>
      </div>
      <label className="ui-field">Credit limit (optional)<input name="limit" inputMode="decimal" maxLength={16} /></label>
      <p className="ui-hint">You can set up bill forwarding and an AI key later in Settings.</p>
      <button className="ui-button primary">{button}</button>
      {privacy && <p className="ui-hint">Your numbers stay in this browser’s demo household. <Link className="account-link" href="/privacy">Privacy ›</Link></p>}
    </ApiForm>
  </AccountFrame>;
}
