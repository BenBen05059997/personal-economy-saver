"use client";

import { useState } from "react";
import { AmountField } from "@/components/household/AmountField";
import { LABELS } from "@/components/household/labels";
import { VariesField } from "@/components/household/ScheduleFields";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";

/**
 * Settings → Edit: the amount, its "New amount from" date (a fixed repeating bill only), the due date and, for a monthly bill,
 * the "Amount changes every month" box. The box is client state, so ticking or unticking it swaps the hint and the
 * "New amount from" fields at once (D54), the way the add form does. The page works out the strings; this only shows them.
 */
export function EditAmounts({ id, currency, amount, from, fromHint, due, dueLabel, today, repeat, varies: initialVaries }: {
  id: string; currency: string; amount: string; from: string | null; fromHint: string; due: string; dueLabel: string; today: string;
  repeat: "month" | "year" | null; varies: boolean;
}) {
  const [varies, setVaries] = useState(initialVaries);
  return <>
    <label className="ui-field">{LABELS.amount}<AmountField name="amount" currency={currency} required defaultValue={amount} /></label>
    {from !== null && !varies && <label className="ui-field">New amount from<CheckedInput name="amountFrom" type="date" defaultValue={from} max={latestDate(today)} message={HORIZON_MESSAGE} required />
      <small className="ui-hint">{fromHint}</small></label>}
    {varies && <small className="ui-hint">Changes every month: this amount is the forecast until a real bill is in, then the average of the last three.</small>}
    <label className="ui-field">{dueLabel}<CheckedInput name="due" type="date" defaultValue={due} max={latestDate(today)} message={HORIZON_MESSAGE} required /></label>
    {repeat === "month" && <><input type="hidden" name="variesShown" value="1" /><VariesField id={`edit-${id}`} checked={varies} onChange={setVaries} /></>}
  </>;
}
