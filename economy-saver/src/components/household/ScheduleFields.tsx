"use client";

import { useState } from "react";
import "./add-entry.css";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { guessRepeat } from "@/lib/money/categorise";
import { AmountField } from "./AmountField";
import { LABELS } from "./labels";
import { MoreFields } from "./MoreFields";

const HINTS = { "": "", month: "Repeats every month on the due date’s day", year: "Repeats every year on the due date’s month and day" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(day: number) {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : day % 10]}`;
}

/** "every month on the 25th" / "every year on Nov 25" once a due date is chosen, else the plain words. */
function repeatWords(kind: "month" | "year", due?: string) {
  const match = due && /^\d{4}-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return kind === "month" ? "Every month" : "Every year";
  const [month, day] = [Number(match[1]), Number(match[2])];
  return kind === "month" ? `Every month on the ${ordinal(day)}` : `Every year on ${MONTHS[month - 1]} ${day}`;
}

/**
 * How a bill repeats (D48): a Repeats select (one-off, every month, every year) and the two rare things, an amount that changes
 * from a date and a last day to cancel. Posts `repeat`, `nextAmount`, `nextAmountFrom` and `cancelBy`. The typed-in bill form
 * (which sits it inside its own More ›, `flat`) and the reader's review card (which keeps its own More ›) share it. `currency` is
 * the household's, shown as a sign inside the amount field; the review card passes none because its currency is chosen next to the
 * amount. `name` and `due` let the select follow the bill's name until the user chooses, and spell out the day.
 */
export function ScheduleFields({ id, today, currency, name = "", due, flat = false }: { id: string; today: string; currency?: string; name?: string; due?: string; flat?: boolean }) {
  const [chosen, setChosen] = useState<keyof typeof HINTS | null>(null);
  const repeat = chosen ?? guessRepeat(name);
  const rare = <>
    <label className="ui-field">{LABELS.changesTo}
      {currency ? <AmountField name="nextAmount" currency={currency} /> : <input name="nextAmount" inputMode="decimal" maxLength={17} />}</label>
    <label className="ui-field">{LABELS.changesFrom}<CheckedInput name="nextAmountFrom" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
    <small className="ui-hint add-entry-hint">The new amount applies to every charge on or after that date. Needs a repeat.</small>
    <label className="ui-field">{LABELS.lastDayToCancel}<CheckedInput name="cancelBy" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
    <small className="ui-hint add-entry-hint">A dated reminder in Coming up before the next charge. The app never cancels or pays anything.</small>
  </>;
  return <>
    <label className="ui-field">{LABELS.repeats}<select name="repeat" value={repeat} onChange={event => setChosen(event.target.value as keyof typeof HINTS)} aria-describedby={`${id}-repeat`}>
      <option value="">{LABELS.oneOff}</option><option value="month">{repeatWords("month", due)}</option><option value="year">{repeatWords("year", due)}</option></select></label>
    <small id={`${id}-repeat`} className="ui-hint add-entry-hint">{HINTS[repeat] || "Counted once, on the due date"}</small>
    {flat ? rare : <MoreFields>{rare}</MoreFields>}
  </>;
}
