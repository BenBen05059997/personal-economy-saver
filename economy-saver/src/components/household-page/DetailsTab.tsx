import Link from "next/link";
import type { loadSettings } from "@/db/settings";
import { ApiForm } from "@/components/ui/ApiForm";
import { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";

type Household = Awaited<ReturnType<typeof loadSettings>>["household"];

/** Household → Details: the name is the only thing to change here; the bank balance is edited on Home, its one place (D42). */
export function DetailsTab({ household }: { household: Household }) {
  return <section className="ui-panel" id="household"><h2>Household</h2>
    <ApiForm><input type="hidden" name="kind" value="household" />
      <label className="ui-field">Household name<input name="name" defaultValue={household.name} maxLength={80} required /></label>
      <p className="ui-hint">Currency {household.currency} · Time zone {household.timeZone}. PayPal stays in sandbox.</p>
      <button className="ui-button">Save household</button></ApiForm>
    <p className="settings-bank">Bank balance {minorMoney(household.bank, Currency.parse(household.currency))} · <Link className="account-link" prefetch={false} href="/#bank-balance">Update on Home ›</Link></p>
  </section>;
}
