import { ApiForm } from "@/components/ui/ApiForm";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { AmountField } from "./AmountField";
import { LABELS } from "./labels";

/** D55: the form that gives a bill its missing amount and/or date (`kind=fill` on /api/bills): only the missing fields, either may be saved alone. */
export function GapFill({ id, missing, today, currency, returnTo = "/to-check" }: { id: string; missing: ("amount" | "date")[]; today: string; currency: string; returnTo?: "/" | "/to-check" }) {
  return <ApiForm action="/api/bills" className="gap-fill">
    <input type="hidden" name="kind" value="fill" /><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
    {missing.includes("amount") && <label className="ui-field">{LABELS.amount}<AmountField name="amount" currency={currency} /></label>}
    {missing.includes("date") && <label className="ui-field">{LABELS.dueDate}<CheckedInput name="due" type="date" max={latestDate(today)} message={HORIZON_MESSAGE} /></label>}
    <button className="ui-button primary">Save</button>
  </ApiForm>;
}
