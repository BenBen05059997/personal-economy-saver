"use client";

import { useState } from "react";
import { AmountWithUnknown, DueWithUnknown } from "@/components/household/UnknownFields";
import { VariesField } from "@/components/household/ScheduleFields";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";

/**
 * Settings → Edit: the amount, its "New amount from" date (a fixed repeating bill only), the due date and, for a monthly bill,
 * the "Amount changes every month" box. The box is client state, so ticking or unticking it swaps the hint and the
 * "New amount from" fields at once (D54), the way the add form does. The page works out the strings; this only shows them.
 */
export function EditAmounts({ id, currency, amount, from, fromHint, due, dueLabel, today, repeat, varies: initialVaries, amountUnknown, dueUnknown, hasNext, dueOffered }: {
  id: string; currency: string; amount: string; from: string | null; fromHint: string; due: string; dueLabel: string; today: string;
  repeat: "month" | "year" | null; varies: boolean;
  amountUnknown: boolean; dueUnknown: boolean; hasNext: boolean; dueOffered: boolean; // D55: stored as not known yet; a dated new amount is set; the date box may be offered (a one-off outside a series with no cancel-by date)
}) {
  const [varies, setVaries] = useState(initialVaries);
  return <>
    <AmountWithUnknown currency={currency} defaultValue={amount} defaultUnknown={amountUnknown} offered={!hasNext && (repeat === null || varies)} />
    {from !== null && !varies && <label className="ui-field">New amount from<CheckedInput name="amountFrom" type="date" defaultValue={from} max={latestDate(today)} message={HORIZON_MESSAGE} required />
      <small className="ui-hint">{fromHint}</small></label>}
    {varies && <small className="ui-hint">Changes every month: this amount is the forecast until a real bill is in, then the average of the last three.</small>}
    <DueWithUnknown today={today} label={dueLabel} defaultValue={due} defaultUnknown={dueUnknown} offered={dueOffered} />
    {repeat === "month" && <><input type="hidden" name="variesShown" value="1" /><VariesField id={`edit-${id}`} checked={varies} onChange={setVaries} /></>}
  </>;
}
