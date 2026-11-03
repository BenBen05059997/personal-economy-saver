import Link from "next/link";
import type { loadSettings } from "@/db/settings";
import { fromMinor } from "@/db/money";
import { SettingsForm } from "./SettingsForm";
import "./settings.css";

export type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
function Person({ people, selected, shared = false }: { people: SettingsData["people"]; selected: string | null; shared?: boolean }) {
  return <label className="ui-field">{shared ? "Bill belongs to" : "Card belongs to"}
    <select name="memberId" defaultValue={selected ?? ""}><option value="">{shared ? "Shared household bill" : "Household card"}</option>
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select></label>;
}
function CardFields({ data, card }: { data: SettingsData; card?: SettingsData["cards"][number] }) {
  return <><input type="hidden" name="kind" value="card" /><input type="hidden" name="id" value={card?.id ?? ""} />
    <label className="ui-field">Card label<input name="label" defaultValue={card?.label} maxLength={80} required /></label>
    <Person people={data.people} selected={card?.memberId ?? null} />
    <div className="settings-grid"><label className="ui-field">Closing day<input name="closingDay" type="number" min="1" max="31" defaultValue={card?.closingDay} required /></label>
      <label className="ui-field">Payment day<input name="dueDay" type="number" min="1" max="31" defaultValue={card?.dueDay} required /></label></div>
    <label className="ui-field">Credit limit ({data.household.currency}, optional)<input name="limit" inputMode="decimal" defaultValue={card?.limitMinor == null ? "" : fromMinor(card.limitMinor, card.currency)} maxLength={16} /></label>
    <button className="ui-button">{card ? "Save card" : "Add card"}</button></>;
}

export function SettingsView({ data, canImportPayPal = false }: { data: SettingsData; canImportPayPal?: boolean }) {
  const { household, people, cards, bills } = data;
  return <div className="settings-page"><header><p className="ui-hint">YOUR HOUSEHOLD</p><h1 className="ui-title">Settings</h1><p className="ui-hint">Keep your balances, cards and bill ownership up to date.</p></header>
    <section className="ui-panel"><h2>Household & bank</h2>
      <SettingsForm><input type="hidden" name="kind" value="household" />
        <label className="ui-field">Household name<input name="name" defaultValue={household.name} maxLength={80} required /></label>
        <label className="ui-field">Current bank balance ({household.currency})<input name="bank" inputMode="decimal" defaultValue={fromMinor(household.bank, household.currency)} maxLength={16} required /></label>
        <p className="ui-hint">{household.timeZone} · The bank balance is the amount you enter. PayPal stays in sandbox.</p>
        <button className="ui-button">Save household</button></SettingsForm>
    </section>
    <section className="ui-panel"><h2>Members</h2>
      {people.map(person => <SettingsForm key={person.id}><input type="hidden" name="kind" value="member" /><input type="hidden" name="id" value={person.id} />
        <label className="ui-field">{person.role === "owner" ? "Owner’s display name" : "Member’s display name"}<input name="name" defaultValue={person.name} maxLength={80} required /></label>
        <button className="ui-button">Save name</button></SettingsForm>)}
    </section>
    <section className="ui-panel" id="cards"><h2>Cards</h2><p className="ui-hint">31 means month end. The payment day is in the following month.</p>
      {cards.map(card => <details key={card.id}><summary>{card.label} · {people.find(p => p.id === card.memberId)?.name ?? "Household"}</summary><SettingsForm><CardFields data={data} card={card} /></SettingsForm></details>)}
      <details><summary>Add a card</summary><SettingsForm><CardFields data={data} /></SettingsForm></details>
    </section>
    <section className="ui-panel"><h2>Shared & personal bills</h2><p className="ui-hint">Every bill stays in the household runway. Choose who it belongs to.</p>
      {bills.length ? bills.map(bill => <details key={bill.id}><summary>{bill.biller} · {people.find(p => p.id === bill.memberId)?.name ?? "Shared"}</summary>
        <SettingsForm><input type="hidden" name="kind" value="bill-owner" /><input type="hidden" name="id" value={bill.id} />
          <Person people={people} selected={bill.memberId} shared /><button className="ui-button">Save bill owner</button></SettingsForm></details>) : <p className="ui-hint">Your bills appear here after you confirm a reading.</p>}
    </section>
    {canImportPayPal && <section className="ui-panel" id="paypal-import"><h2>PayPal history</h2>
      <p className="ui-hint">Add the clients and invoices from your PayPal sandbox account. This only reads from PayPal and never changes your balance.</p>
      <form method="post" action="/api/paypal/import"><button className="ui-button">Import clients and invoices from PayPal</button></form>
    </section>}
    <section className="ui-panel" id="ai-key"><h2>Your AI key</h2>
      <p className="ui-hint">{household.aiKeyHint ? `Saved key: ${household.aiKeyHint}. Model calls use your Anthropic account.` : "Using the app’s default key, with a daily household allowance. Add your own Anthropic key to use your account."}</p>
      {!household.aiKeyHint && <p className="ui-hint">{household.aiReadsDay ? `${household.aiReadsToday} default calls recorded on ${household.aiReadsDay}.` : "No default calls recorded."} The allowance resets at midnight in {household.timeZone}.</p>}
      <SettingsForm action="/api/settings/ai-key" secret><label className="ui-field">Anthropic API key<input name="key" type="password" autoComplete="new-password" spellCheck={false} maxLength={507} required /></label>
        <button className="ui-button">{household.aiKeyHint ? "Replace key" : "Save key"}</button></SettingsForm>
      {household.aiKeyHint && <SettingsForm action="/api/settings/ai-key"><input type="hidden" name="remove" value="yes" /><button className="ui-button">Remove saved key</button></SettingsForm>}
    </section>
    <section className="ui-panel" id="export"><h2>Export my data</h2>
      <p className="ui-hint">Download everything in this household as one JSON file: balances, cards, charges, bills, clients, invoices, pots and your activity history. It has no AI key, sign-in details or uploaded files.</p>
      <form method="post" action="/api/export"><button className="ui-button">Export my data</button></form>
    </section>
    <section className="ui-panel"><h2>Account</h2><p className="ui-hint">{household.demo ? "This is a fictional Try it household. Sign in to start with your own balances." : "Manage sign-in and delete your household data."}</p><Link className="ui-button" prefetch={false} href="/account">Open account</Link></section>
  </div>;
}
