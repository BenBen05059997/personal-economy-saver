"use client";

import { useState } from "react";
import { AmountWithUnknown, DueWithUnknown } from "@/components/household/UnknownFields";

/**
 * The amount, currency and date of a reading's review card. For a bill (D55) each of amount and date has a "not known yet" box
 * (`amountUnknown`, `dueUnknown`); the currency is then no longer required when the amount is not known. A card charge needs all three.
 */
export function ReadingFields({ isBill, amount, currency, date, today }: { isBill: boolean; amount: string; currency: string; date: string; today: string }) {
  const [amountUnknown, setAmountUnknown] = useState(false);
  return <>
    {isBill ? <AmountWithUnknown defaultValue={amount} onUnknown={setAmountUnknown} />
      : <label className="ui-field">Amount<input name="amount" inputMode="decimal" defaultValue={amount} required maxLength={17} /></label>}
    <label className="ui-field">Currency<select name="currency" required={!amountUnknown} defaultValue={currency}><option value="">Choose currency</option><option>JPY</option><option>USD</option></select></label>
    {isBill ? <DueWithUnknown today={today} label="Due or charge date" name="date" defaultValue={date} />
      : <label className="ui-field">Due or charge date<input name="date" type="date" required defaultValue={date} /></label>}
  </>;
}
