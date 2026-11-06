"use client";

import { useState } from "react";
import "./add-entry.css";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { repeatWords } from "@/lib/money/format";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { guessRepeat } from "@/lib/money/categorise";
import { AmountField } from "./AmountField";
import { LABELS } from "./labels";
import { MoreFields } from "./MoreFields";

export type Repeat = "" | "month" | "year";
const HINTS = { "": "", month: "Repeats every month on the due date’s day", year: "Repeats every year on the due date’s month and day" } as const;
/** "Every month on the 25th" / "Every year on Nov 25" once a due date is chosen, else the plain words. */
function scheduleWords(kind: "month" | "year", due?: string) {
  const match = due && /^\d{4}-(\d{2})-(\d{2})$/.exec(due);
  return match ? repeatWords(kind, Number(match[2]), Number(match[1])) : repeatWords(kind);
}

/**
 * How a bill repeats (D48): a Repeats select (one-off, every month, every year) and the two rare things, an amount that changes
 * from a date and a last day to cancel. Posts `repeat`, `nextAmount`, `nextAmountFrom` and `cancelBy`. The typed-in bill form
 * (which sits it inside its own More ›, `flat`) and the reader's review card (which keeps its own More ›) share it. `currency` is
 * the household's, shown as a sign inside the amount field; the review card passes none because its currency is chosen next to the
 * amount. `name` and `due` let the select follow the bill's name until the user chooses, and spell out the day. The add form,
 * which shows the guess on its main part, holds the choice itself and passes `chosen` and `onChoose`.
 * D54: a form that passes `onVaries` (the add form) also shows "Amount changes every month" while Repeats is every month, posting
 * `amountVaries=on`; while it is ticked the dated new amount is not offered (a varying bill is forecast from its own past).
 */
export function ScheduleFields({ id, today, currency, name = "", due, flat = false, chosen: held, onChoose, varies = false, onVaries, onNextAmount, onCancelBy }: {
  id: string; today: string; currency?: string; name?: string; due?: string; flat?: boolean; chosen?: Repeat | null; onChoose?: (repeat: Repeat) => void;
  varies?: boolean; onVaries?: (varies: boolean) => void;
  onNextAmount?: (text: string) => void; onCancelBy?: (date: string) => void; // D55: the add form hides "not known yet" boxes while these are filled
}) {
  const [own, setOwn] = useState<Repeat | null>(null);
  const chosen = onChoose ? held ?? null : own;
  const setChosen = onChoose ?? setOwn;
  const repeat = chosen ?? guessRepeat(name);
  const varying = onVaries !== undefined && repeat === "month" && varies;
  const rare = <>
    {!varying && <>
      <label className="ui-field">{LABELS.changesTo}
        {currency ? <AmountField name="nextAmount" currency={currency} onInput={event => onNextAmount?.(event.currentTarget.value)} /> : <input name="nextAmount" inputMode="decimal" maxLength={17} onInput={event => onNextAmount?.(event.currentTarget.value)} />}</label>
      <label className="ui-field">{LABELS.changesFrom}<CheckedInput name="nextAmountFrom" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
      <small className="ui-hint add-entry-hint">The new amount applies to every charge on or after that date. Needs a repeat.</small>
    </>}
    <CancelByField today={today} onChange={onCancelBy} />
    {repeat !== "" && <RepeatUntilField today={today} />}
  </>;
  return <>
    <label className="ui-field">{LABELS.repeats}<select name="repeat" value={repeat} onChange={event => setChosen(event.target.value as Repeat)} aria-describedby={`${id}-repeat`}>
      <option value="">{repeatWords(null)}</option><option value="month">{scheduleWords("month", due)}</option><option value="year">{scheduleWords("year", due)}</option></select></label>
    <small id={`${id}-repeat`} className="ui-hint add-entry-hint">{HINTS[repeat] || "Counted once, on the due date"}</small>
    {onVaries && repeat === "month" && <VariesField id={id} checked={varies} onChange={onVaries} />}
    {flat ? rare : <MoreFields>{rare}</MoreFields>}
  </>;
}

/** D48: the "Last day to cancel" date and its hint, shared by the add form (through ScheduleFields) and Settings → Edit. Posts `cancelBy` (empty = none). */
export function CancelByField({ today, defaultValue, onChange }: { today: string; defaultValue?: string; onChange?: (date: string) => void }) {
  return <>
    <label className="ui-field">{LABELS.lastDayToCancel}<CheckedInput name="cancelBy" type="date" defaultValue={defaultValue} onChange={event => onChange?.(event.target.value)} max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
    <small className="ui-hint add-entry-hint">A dated reminder in Coming up before the next charge. The app never cancels or pays anything.</small>
  </>;
}

/** D41: the "Last payment" date and its hint, shared by the add form and the review card (through ScheduleFields) and Settings → Edit. Posts `repeatUntil` (empty = it goes on); shown only for a bill that repeats. */
export function RepeatUntilField({ today, defaultValue, onChange }: { today: string; defaultValue?: string; onChange?: (date: string) => void }) {
  return <>
    <label className="ui-field">{LABELS.lastPayment}<CheckedInput name="repeatUntil" type="date" defaultValue={defaultValue} onChange={event => onChange?.(event.target.value)} max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
    <small className="ui-hint add-entry-hint">The last time it is charged. Nothing after it is counted.</small>
  </>;
}

/** D54: the "amount changes every month" box, shared by the add form (through ScheduleFields) and Settings → Edit. Posts `amountVaries=on`. */
export function VariesField({ id, checked, defaultChecked, onChange }: { id: string; checked?: boolean; defaultChecked?: boolean; onChange?: (varies: boolean) => void }) {
  return <>
    <label className="add-entry-repeat"><input name="amountVaries" type="checkbox" aria-describedby={`${id}-varies`}
      {...(onChange ? { checked: checked ?? false, onChange: event => onChange(event.target.checked) } : { defaultChecked })} /> {LABELS.amountVaries}</label>
    <small id={`${id}-varies`} className="ui-hint add-entry-hint">{LABELS.amountVariesHint}</small>
  </>;
}
