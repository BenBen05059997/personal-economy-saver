"use client";

import { useState } from "react";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { AmountField } from "./AmountField";
import { LABELS } from "./labels";

/**
 * D55: an amount that can be left "not known yet". Ticking the box (posts `amountUnknown=on`) clears and disables the field and drops
 * its `required`. `currency` puts the sign inside the field; without it the field is a plain text input (the reader's review card
 * chooses the currency next to it). `offered` false hides the box (the database refuses an unknown amount there). `onUnknown` tells
 * the parent whether the amount is now not known.
 */
export function AmountWithUnknown({ currency, label = LABELS.amount, defaultValue = "", defaultUnknown = false, offered = true, onUnknown }: {
  currency?: string; label?: string; defaultValue?: string; defaultUnknown?: boolean; offered?: boolean; onUnknown?: (unknown: boolean) => void;
}) {
  const [box, setBox] = useState(defaultUnknown);
  const [text, setText] = useState(defaultValue);
  const unknown = box && offered;
  return <>
    <label className="ui-field">{label}
      {currency ? <AmountField name="amount" currency={currency} required={!unknown} disabled={unknown} value={unknown ? "" : text} onChange={event => setText(event.target.value)} />
        : <input name="amount" inputMode="decimal" maxLength={17} required={!unknown} disabled={unknown} value={unknown ? "" : text} onChange={event => setText(event.target.value)} />}</label>
    {offered && <label className="add-entry-repeat"><input name="amountUnknown" type="checkbox" checked={box}
      onChange={event => { setBox(event.target.checked); if (event.target.checked) setText(""); onUnknown?.(event.target.checked); }} /> {LABELS.amountUnknown}</label>}
  </>;
}

/**
 * D55: a due date that can be left "not known yet" (`dueUnknown=on`), same behaviour as `AmountWithUnknown`. A parent that needs the
 * typed date (the add form spells the repeat from it) passes `value` and `onValue`.
 */
export function DueWithUnknown({ today, label = LABELS.dueDate, name = "due", value, onValue, defaultValue = "", defaultUnknown = false, offered = true }: {
  today: string; label?: string; name?: string; value?: string; onValue?: (date: string) => void; defaultValue?: string; defaultUnknown?: boolean; offered?: boolean;
}) {
  const [box, setBox] = useState(defaultUnknown);
  const [own, setOwn] = useState(defaultValue);
  const text = value ?? own, set = onValue ?? setOwn;
  const unknown = box && offered;
  return <>
    <label className="ui-field">{label}<CheckedInput name={name} type="date" value={unknown ? "" : text} onChange={event => set(event.target.value)}
      max={latestDate(today)} message={HORIZON_MESSAGE} required={!unknown} disabled={unknown} /></label>
    {offered && <label className="add-entry-repeat"><input name="dueUnknown" type="checkbox" checked={box}
      onChange={event => { setBox(event.target.checked); if (event.target.checked) set(""); }} /> {LABELS.dueUnknown}</label>}
  </>;
}
