"use client";

import { useState } from "react";
import "./add-entry.css";
import { AmountInput, CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";

const HINTS = { "": "", month: "Repeats every month on the due date’s day", year: "Repeats every year on the due date’s month and day" } as const;

/**
 * How a bill repeats (D48): a Repeat select (one-off, every month, every year), and behind "More ›" the two rare things, an
 * amount that changes from a date and a cancel-by date. Posts `repeat`, `nextAmount`, `nextAmountFrom` and `cancelBy`; the typed-in bill
 * form and the reader's review card share it. `currency` is the household's, for the amount's own check; the review card passes none
 * because its currency is chosen next to the amount.
 */
export function ScheduleFields({ id, today, currency }: { id: string; today: string; currency?: string }) {
  const [repeat, setRepeat] = useState<keyof typeof HINTS>("");
  return <>
    <label className="ui-field">Repeat<select name="repeat" value={repeat} onChange={event => setRepeat(event.target.value as keyof typeof HINTS)} aria-describedby={`${id}-repeat`}>
      <option value="">One-off</option><option value="month">Every month</option><option value="year">Every year</option></select></label>
    <small id={`${id}-repeat`} className="ui-hint add-entry-hint">{HINTS[repeat] || "Counted once, on the due date"}</small>
    <details className="add-entry-more">
      <summary>More ›</summary>
      <label className="ui-field">Changes to{currency ? ` (${currency})` : ""}
        {currency ? <AmountInput name="nextAmount" currency={currency} /> : <input name="nextAmount" inputMode="decimal" maxLength={17} />}</label>
      <label className="ui-field">from<CheckedInput name="nextAmountFrom" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
      <small className="ui-hint add-entry-hint">The new amount applies to every occurrence on or after that date. Needs a repeat.</small>
      <label className="ui-field">Cancel by<CheckedInput name="cancelBy" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>
      <small className="ui-hint add-entry-hint">A dated reminder in Coming up before the next charge. The app never cancels or pays anything.</small>
    </details>
  </>;
}
