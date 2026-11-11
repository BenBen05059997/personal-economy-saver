import type { Pot } from "@/lib/money/types";
import { AmountInput, PercentInput } from "@/components/ui/CheckedInput";

const plain = (n: number, currency: string) => currency === "USD" ? n.toFixed(2) : String(n);

/** The pot's fields: the Add dialog draws them empty (with a name) and the row panel fills them from the pot it edits. */
export function PotFields({ currency, pot }: { currency: string; pot?: Pot }) {
  return <>
    {!pot && <label className="ui-field">Name<input name="name" maxLength={60} required placeholder="e.g. Car, trip, tax" /></label>}
    <label className="ui-field">Saved so far ({currency})<AmountInput name="saved" currency={currency} defaultValue={pot ? plain(pot.saved, currency) : "0"} required /></label>
    <label className="ui-field">Target amount, optional ({currency})<AmountInput name="target" currency={currency} defaultValue={pot?.target === undefined ? "" : plain(pot.target, currency)} /></label>
    <label className="ui-field">Target date, optional<input name="targetDate" type="date" defaultValue={pot?.targetDate ?? ""} /></label>
    <label className="ui-field">Set aside % of each client payment, optional<PercentInput name="fillPct" maxLength={6} defaultValue={pot?.fillPct === undefined ? "" : String(pot.fillPct)} placeholder="e.g. 25" /></label>
  </>;
}
