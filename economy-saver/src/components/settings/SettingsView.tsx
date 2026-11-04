import Link from "next/link";
import type { loadSettings } from "@/db/settings";
import { fromMinor } from "@/db/money";
import { AmountInput, PercentInput } from "@/components/ui/CheckedInput";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";
import { ResetDemo } from "./ResetDemo";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import "./settings.css";

export type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
function PaidBy({ people, selected }: { people: SettingsData["people"]; selected: string | null }) {
  return <label className="ui-field">Paid by (a shared bill is split by shares)
    <select name="paidByMemberId" defaultValue={selected ?? ""}><option value="">Nobody; not split</option>
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select></label>;
}
function Person({ people, selected, shared = false }: { people: SettingsData["people"]; selected: string | null; shared?: boolean }) {
  return <label className="ui-field">{shared ? "Bill belongs to" : "Card belongs to"}
    <select name="memberId" defaultValue={selected ?? ""}><option value="">{shared ? "Shared household bill" : "Household card"}</option>
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select></label>;
}
/** Who a bill belongs to: a person, "Shared, paid by …" when split, or "Household, not split" (left out of who owes whom). Nothing when one person is everything. */
function billOwner(bill: SettingsData["bills"][number], people: SettingsData["people"]) {
  if (people.length < 2) return null;
  const owner = people.find(p => p.id === bill.memberId);
  if (owner) return owner.name;
  const payer = people.find(p => p.id === bill.paidByMemberId);
  if (payer) return `Shared, paid by ${payer.name}`;
  return "Household, not split";
}
/** The summary line of a bill: its biller, then its owner (two or more people) and, while it waits for a yes, where it waits. */
function billSummary(bill: SettingsData["bills"][number], people: SettingsData["people"]) {
  return [bill.biller, billOwner(bill, people), bill.status === "pending" ? "waiting in To check" : null].filter(Boolean).join(" · ");
}
/** Remove for one bill: asks first, and says when it repeats that the whole series goes. */
function RemoveBill({ bill }: { bill: SettingsData["bills"][number] }) {
  return <ConfirmRemove kind="bill" id={bill.id} returnTo="/settings" label={`${bill.biller} ${minorMoney(bill.amountMinor, Currency.parse(bill.currency))}`}
    note={bill.repeatUnit === null ? undefined : bill.repeatUnit === "year" ? "It repeats every year, so every year goes." : "It repeats every month, so every month goes."} />;
}
function CardFields({ data, card }: { data: SettingsData; card?: SettingsData["cards"][number] }) {
  return <><input type="hidden" name="kind" value="card" /><input type="hidden" name="id" value={card?.id ?? ""} />
    <label className="ui-field">Card label<input name="label" defaultValue={card?.label} maxLength={80} required /></label>
    {data.people.length < 2 ? <input type="hidden" name="memberId" value={card?.memberId ?? ""} /> : <Person people={data.people} selected={card?.memberId ?? null} />}
    <div className="settings-grid"><label className="ui-field">Closing day<input name="closingDay" type="number" min="1" max="31" defaultValue={card?.closingDay} required /></label>
      <label className="ui-field">Payment day<input name="dueDay" type="number" min="1" max="31" defaultValue={card?.dueDay} required /></label></div>
    <label className="ui-field">Credit limit ({data.household.currency}, optional)<AmountInput name="limit" currency={data.household.currency} defaultValue={card?.limitMinor == null ? "" : fromMinor(card.limitMinor, card.currency)} /></label>
    <button className="ui-button">{card ? "Save card" : "Add card"}</button></>;
}

export function SettingsView({ data, canImportPayPal = false }: { data: SettingsData; canImportPayPal?: boolean }) {
  const { household, people, cards, bills } = data;
  return <><header><p className="ui-hint">YOUR HOUSEHOLD</p><h1 className="ui-title">Settings</h1><p className="ui-hint">Keep your balances, cards and bill ownership up to date.</p></header>
    <section className="ui-panel"><h2>Household & bank</h2>
      <ApiForm><input type="hidden" name="kind" value="household" />
        <label className="ui-field">Household name<input name="name" defaultValue={household.name} maxLength={80} required /></label>
        <label className="ui-field">Current bank balance ({household.currency})<AmountInput name="bank" currency={household.currency} signed defaultValue={fromMinor(household.bank, household.currency)} required /></label>
        <p className="ui-hint">{household.timeZone} · The bank balance is the amount you enter. PayPal stays in sandbox.</p>
        <button className="ui-button">Save household</button></ApiForm>
    </section>
    <section className="ui-panel" id="people"><h2>People</h2>
      <ApiFormGroup><ApiForm action="/api/people"><input type="hidden" name="kind" value="people" />
        {people.length > 1 && <p className="ui-hint">Each person’s share of the shared bills and charges. The shares must total 100%.</p>}
        <div key={people.map(person => `${person.id}:${person.name}:${person.shareBp}`).join("|")}>{people.map(person => <div key={person.id} className="settings-person">
          <label className="ui-field">{person.role === "owner" ? "Owner’s name" : "Member’s name"}<input name={`name:${person.id}`} defaultValue={person.name} maxLength={80} required /></label>
          {people.length > 1 && <label className="ui-field">Share (%)<PercentInput name={`share:${person.id}`} defaultValue={String(person.shareBp / 100)} maxLength={6} required /></label>}
        </div>)}</div>
        <button className="ui-button">Save people</button></ApiForm>
      <ApiForm action="/api/people"><input type="hidden" name="kind" value="add" />
        <p className="ui-hint">{people.length > 1 ? "Adding someone splits the shared costs equally again." : "Add a partner or housemate to split shared bills and charges. You start equal and can change the shares afterwards."}</p>
        <label key={people.length} className="ui-field">Add a person<input name="name" maxLength={80} required /></label>
        <button className="ui-button">Add person</button></ApiForm></ApiFormGroup>
    </section>
    <section className="ui-panel" id="cards"><h2>Cards</h2><p className="ui-hint">31 means month end. The payment day is in the following month.</p>
      {cards.map(card => <details key={card.id}><summary>{card.label} · {people.find(p => p.id === card.memberId)?.name ?? "Household"}</summary><ApiForm><CardFields data={data} card={card} /></ApiForm></details>)}
      <details><summary>Add a card</summary><ApiForm><CardFields key={cards.length} data={data} /></ApiForm></details>
    </section>
    <section className="ui-panel"><h2>{people.length < 2 ? "Bills" : "Shared & personal bills"}</h2><p className="ui-hint">Every bill stays in the household runway.{people.length > 1 && " Choose who it belongs to."}</p>
      {bills.length ? bills.map(bill => people.length < 2 ? <div key={bill.id} className="settings-bill"><p>{billSummary(bill, people)}</p><RemoveBill bill={bill} /></div> : <details key={bill.id}><summary>{billSummary(bill, people)}</summary>
        <ApiForm><input type="hidden" name="kind" value="bill-owner" /><input type="hidden" name="id" value={bill.id} />
          <Person people={people} selected={bill.memberId} shared /><PaidBy people={people} selected={bill.paidByMemberId} /><button className="ui-button">Save bill owner</button></ApiForm><RemoveBill bill={bill} /></details>) : <p className="ui-hint">Your bills appear here after you confirm a reading.</p>}
    </section>
    {canImportPayPal && <section className="ui-panel" id="paypal-import"><h2>PayPal history</h2>
      <p className="ui-hint">Add the clients and invoices from your PayPal sandbox account. This only reads from PayPal and never changes your balance.</p>
      <form method="post" action="/api/paypal/import"><button className="ui-button">Import clients and invoices from PayPal</button></form>
    </section>}
    <section className="ui-panel" id="ai-key"><h2>Your AI key</h2>
      <p className="ui-hint">{household.aiKeyHint ? `Saved key: ${household.aiKeyHint}. Model calls use your Anthropic account.` : "Using the app’s default key, with a daily household allowance. Add your own Anthropic key to use your account."}</p>
      {!household.aiKeyHint && <p className="ui-hint">{household.aiReadsDay ? `${household.aiReadsToday} default calls recorded on ${household.aiReadsDay}.` : "No default calls recorded."} The allowance resets at midnight in {household.timeZone}.</p>}
      <ApiForm action="/api/settings/ai-key" secret><label className="ui-field">Anthropic API key<input name="key" type="password" autoComplete="new-password" spellCheck={false} maxLength={507} required /></label>
        <button className="ui-button">{household.aiKeyHint ? "Replace key" : "Save key"}</button></ApiForm>
      {household.aiKeyHint && <ApiForm action="/api/settings/ai-key"><input type="hidden" name="remove" value="yes" /><button className="ui-button">Remove saved key</button></ApiForm>}
    </section>
    <section className="ui-panel" id="export"><h2>Export my data</h2>
      <p className="ui-hint">Download everything in this household as one JSON file: balances, cards, charges, bills, clients, invoices, pots and your activity history. It has no AI key, sign-in details or uploaded files.</p>
      <form method="post" action="/api/export"><button className="ui-button">Export my data</button></form>
    </section>
    <section className="ui-panel"><h2>Account</h2><p className="ui-hint">{household.demo ? "This is a fictional Try it household. Sign in to start with your own balances." : "Manage sign-in and delete your household data."}</p><Link className="ui-button" prefetch={false} href="/account">Open account</Link>
      {household.demo && <ResetDemo />}</section>
  </>;
}
