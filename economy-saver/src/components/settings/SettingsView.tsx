import Link from "next/link";
import type { loadSettings } from "@/db/settings";
import type { McpTokenInfo } from "@/db/mcp-tokens";
import type { reminderView } from "@/db/reminders";
import { fromMinor } from "@/db/money";
import { AmountInput, PercentInput } from "@/components/ui/CheckedInput";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { Currency } from "@/lib/catalogue/types";
import { aboutMoney, minorMoney, repeatWords } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN, DATE_NOT_KNOWN } from "@/lib/money/gaps";
import { closingBefore } from "@/lib/money/runway";
import { amountOn, lastOneWords, nextAmountOf, nextOccurrenceAfter } from "@/lib/money/repeat";
import { CategoryFields } from "@/components/household/CategoryFields";
import { PayerOptions } from "@/components/household/PayerOptions";
import { LABELS } from "@/components/household/labels";
import { CancelByField, RepeatUntilField } from "@/components/household/ScheduleFields";
import { dueLabel } from "@/db/bills";
import { Suspense } from "react";
import { AiModelPanel } from "./AiModelPanel";
import { YourData } from "./YourData";
import { Reminders } from "./Reminders";
import { EditAmounts } from "./EditAmounts";
import { FamilyShare, type FamilyLinkRow } from "./FamilyShare";
import { HouseholdAccess } from "./HouseholdAccess";
import { InvitePeople, type InviteRow } from "./InvitePeople";
import { ResetDemo } from "./ResetDemo";
import { ImportStatement } from "./ImportStatement";
import { OwnCategories } from "./OwnCategories";
import { CardFields, Person } from "./CardFields";
import { groupOwnCategories } from "@/db/own-categories";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { LoadingIndicator } from "@/components/ui/LoadingState";
import "./settings.css";

type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
function PaidBy({ people, selected }: { people: SettingsData["people"]; selected: string | null }) {
  return <label className="ui-field">Paid by (a shared bill is split by shares)
    <select name="paidByMemberId" defaultValue={selected ?? ""}><PayerOptions people={people} /></select></label>;
}
/** Who a bill belongs to: a person, "Shared, paid by …" when split, or "Shared" with no payer (left out of who owes whom). Nothing when one person is everything. */
function billOwner(bill: SettingsData["bills"][number], people: SettingsData["people"]) {
  if (people.length < 2) return null;
  const owner = people.find(p => p.id === bill.memberId);
  if (owner) return owner.name;
  const payer = people.find(p => p.id === bill.paidByMemberId);
  if (payer) return `Shared, paid by ${payer.name}`;
  return "Shared";
}
/** The summary line of a bill: its biller, then its owner (two or more people) and, while it waits for a yes, where it waits. */
function billSummary(bill: SettingsData["bills"][number], people: SettingsData["people"]) {
  return [bill.biller, billOwner(bill, people), bill.status === "pending" ? "waiting in To check" : null].filter(Boolean).join(" · ");
}
/** Remove for one bill: asks first, and says when it repeats that the whole series goes. */
function RemoveBill({ bill }: { bill: SettingsData["bills"][number] }) {
  const repeats = repeatWords(bill.repeatUnit === "year" ? "year" : "month").toLowerCase();
  return <ConfirmRemove kind="bill" id={bill.id} returnTo="/settings" label={`${bill.biller} ${bill.amountMinor === null ? `(${AMOUNT_NOT_KNOWN})` : minorMoney(bill.amountMinor, Currency.parse(bill.currency))}`}
    note={bill.repeatUnit === null ? undefined : `It repeats ${repeats}, so ${repeats} goes.`} />;
}
/**
 * Edit for one confirmed bill, the add form's fields: name, amount, due date, category, for work, whose and who pays. A
 * repeating bill's amount starts from a due date (the next one by default), through its scheduled change (D48); the other
 * fields change the whole series. D54: a monthly bill has "Amount changes every month" (its amount is then the estimate before any
 * real bill, with no date); a one-off has "Part of" while this household has an amount-varies monthly bill in its category.
 */
function EditBill({ bill, bills, people, today, own }: { bill: SettingsData["bills"][number]; bills: SettingsData["bills"]; people: SettingsData["people"]; today: string; own: OwnChoices }) {
  const currency = Currency.parse(bill.currency);
  const repeat = bill.repeatUnit === "month" || bill.repeatUnit === "year" ? bill.repeatUnit : null;
  const series = repeat !== null ? [] : bills.filter(b => b.amountVaries && b.status === "confirmed" && (b.category === bill.category || b.id === bill.seriesBillId));
  const next = nextAmountOf(bill);
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const from = repeat === null || bill.due === null ? null : nextOccurrenceAfter({ due: bill.due, repeatUnit: repeat, repeatDay: bill.repeatDay ?? undefined, ...(bill.repeatUntil !== null && { repeatUntil: bill.repeatUntil }) }, yesterday) ?? bill.due;
  const amount = bill.amountMinor === null ? null : from === null || bill.amountVaries ? bill.amountMinor : amountOn(bill.amountMinor, next, from);
  const fromHint = `Repeats ${repeatWords(repeat).toLowerCase()}: a new amount starts on this due date. Choose the first due date${bill.due === null ? "" : `, ${dueLabel(bill.due, today)},`} to correct every one.${next ? ` It changes to ${minorMoney(next.amount, currency)} from ${dueLabel(next.from, today)}.` : ""}`;
  return <details className="settings-edit"><summary aria-label={`Edit ${bill.biller}`}>Edit</summary>
    <ApiForm action="/api/bills"><input type="hidden" name="kind" value="edit" /><input type="hidden" name="id" value={bill.id} /><input type="hidden" name="returnTo" value="/settings" />
      <label className="ui-field">{LABELS.name}<input name="biller" maxLength={160} required defaultValue={bill.biller} /></label>
      <EditAmounts amountUnknown={bill.amountMinor === null} dueUnknown={bill.due === null} hasNext={next !== null} dueOffered={repeat === null && bill.seriesBillId === null && bill.cancelBy === null} id={bill.id} currency={bill.currency} amount={amount === null ? "" : String(fromMinor(amount, currency))} from={from} fromHint={fromHint} due={bill.due ?? ""} dueLabel={repeat === null ? LABELS.dueDate : "First due date"} today={today} repeat={repeat} varies={bill.amountVaries} />
      {series.length > 0 && <label className="ui-field">{LABELS.partOf}<select name="seriesBillId" defaultValue={bill.seriesBillId ?? ""}>
        <option value="">None</option>{series.map(s => <option key={s.id} value={s.id}>{`${s.biller} (${repeatWords("month").toLowerCase()})`}</option>)}</select>
        <small className="ui-hint">A real bill for that month: it replaces the month’s estimate and counts once.</small></label>}
      <CancelByField today={today} defaultValue={bill.cancelBy ?? undefined} />
      {repeat !== null && <RepeatUntilField today={today} defaultValue={bill.repeatUntil ?? undefined} />}
      {repeat === null && <details className="add-entry-more" open={bill.periodStart !== null}>
        <summary>Month this bill covers</summary>
        <label className="ui-field">First day<input name="periodStart" type="date" defaultValue={bill.periodStart ?? ""} /></label>
        <label className="ui-field">Last day<input name="periodEnd" type="date" defaultValue={bill.periodEnd ?? ""} /></label>
        <small className="ui-hint add-entry-hint">What the bill is for, like “11月分”. Information only: the forecast counts it on the due date.</small>
      </details>}
      <CategoryFields name={bill.biller} own={own} defaultCategory={bill.category} defaultOwn={bill.ownCategoryId} defaultBp={bill.businessBp} />
      {people.length < 2 ? <><input type="hidden" name="memberId" value={bill.memberId ?? ""} /><input type="hidden" name="paidByMemberId" value={bill.paidByMemberId ?? ""} /></>
        : <><Person people={people} selected={bill.memberId} shared /><PaidBy people={people} selected={bill.paidByMemberId} /></>}
      <button className="ui-button primary">Save bill</button></ApiForm></details>;
}
/** D41: "last one Dec 27" for a repeating bill with a last payment, else null. */
function lastOne(bill: SettingsData["bills"][number], today: string) {
  return bill.due === null || (bill.repeatUnit !== "month" && bill.repeatUnit !== "year") ? null : lastOneWords({ due: bill.due, repeatUnit: bill.repeatUnit, repeatDay: bill.repeatDay, repeatUntil: bill.repeatUntil }, today);
}
/** One bill in Settings → Bills: its summary and amount ("about ¥6,000 · varies" for a monthly bill whose amount changes), Edit and Remove. */
function BillRow({ bill, bills, people, today, own }: { bill: SettingsData["bills"][number]; bills: SettingsData["bills"]; people: SettingsData["people"]; today: string; own: OwnChoices }) {
  const currency = Currency.parse(bill.currency);
  return <div id={`bill-${bill.id}`} className="settings-bill"><p>{billSummary(bill, people)} · {bill.amountMinor === null ? AMOUNT_NOT_KNOWN : bill.amountVaries ? `${aboutMoney(bill.amountMinor, currency)} · varies` : minorMoney(bill.amountMinor, currency)}{bill.due === null ? ` · ${DATE_NOT_KNOWN}` : ""}{lastOne(bill, today) === null ? "" : ` · ${lastOne(bill, today)}`}</p>
    {bill.status === "confirmed" && <EditBill bill={bill} bills={bills} people={people} today={today} own={own} />}<RemoveBill bill={bill} /></div>;
}
/** Remove for one person who is not the owner: asks first and says where their bills and cards go (the rule is on `removeMember`). */
function RemovePerson({ person, people, cards }: { person: SettingsData["people"][number]; people: SettingsData["people"]; cards: SettingsData["cards"] }) {
  const owner = people.find(p => p.role === "owner")?.name ?? people[0].name;
  const note = [`${person.name}’s bills become shared and paid by ${owner}.`,
    ...(cards.some(card => card.memberId === person.id) ? [`Their cards become shared cards (${owner}’s if they carry shared charges).`] : []),
    ...(people.length > 2 ? ["Everyone’s share becomes equal again."] : [])].join(" ");
  return <div className="settings-bill"><p>{person.name}</p><ConfirmRemove kind="person" id={person.id} returnTo="/settings" label={person.name} note={note} /></div>;
}
export function SettingsView({ data, own, canImportPayPal = false, familyLinks, reminders, canManage, access }: {
  data: SettingsData; own: OwnChoices; canImportPayPal?: boolean; familyLinks: FamilyLinkRow[]; reminders: Awaited<ReturnType<typeof reminderView>>;
  canManage: boolean; access: { invites: InviteRow[]; tokens: McpTokenInfo[]; invited: string[] } | null;
}) {
  const { household, people, cards, bills } = data;
  const isPast = (bill: SettingsData["bills"][number]) => bill.status === "confirmed" && bill.repeatUnit === null && bill.due !== null && bill.due < data.today; // a one-off already due: history, kept below the rest
  const current = bills.filter(bill => !isPast(bill));
  const past = bills.filter(isPast);
  return <><header><p className="ui-hint">YOUR HOUSEHOLD</p><h1 className="ui-title">Settings</h1><p className="ui-hint">Keep your balances, cards and bill ownership up to date.</p></header>
    <section className="ui-panel"><h2>Household & bank</h2>
      <ApiForm><input type="hidden" name="kind" value="household" />
        <label className="ui-field">Household name<input name="name" defaultValue={household.name} maxLength={80} required /></label>
        <label className="ui-field">Current bank balance ({household.currency})<AmountInput name="bank" currency={household.currency} signed defaultValue={fromMinor(household.bank, household.currency)} required /></label>
        <p className="ui-hint">{household.timeZone} · The bank balance is the amount you enter. PayPal stays in sandbox.</p>
        <button className="ui-button">Save household</button></ApiForm>
    </section>
    <section className="ui-panel" id="nudge"><h2>Assistant rules</h2>
      <p className="ui-hint">Choose when the assistant suggests a nudge or flags an upcoming expense.</p>
      <Link className="ui-button" href="/memory?tab=rules" prefetch={false}>Open Rules</Link>
    </section>
    <Reminders view={reminders} timeZone={household.timeZone} />
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
        <label id="add-person" key={people.length} className="ui-field">Add a person<input name="name" maxLength={80} required /></label>
        <button className="ui-button">Add person</button></ApiForm></ApiFormGroup>
      {canManage && people.length > 1 && <div className="settings-remove-people"><p className="ui-hint">A person can be removed once they owe nobody and nobody owes them.</p>
        {people.filter(person => person.role !== "owner").map(person => <RemovePerson key={person.id} person={person} people={people} cards={cards} />)}</div>}
      {access && <InvitePeople people={people.filter(person => person.role === "member" && !person.signedIn && !access.invited.includes(person.id))} invites={access.invites} />}
      {canManage && <FamilyShare links={familyLinks} />}
    </section>
    {access && <HouseholdAccess people={people} familyLinks={familyLinks} tokens={access.tokens} />}
    <section className="ui-panel" id="cards"><h2>Cards</h2><p className="ui-hint">31 means month end. The payment day is in the following month.</p>
      {cards.map(card => <details key={card.id}><summary>{card.label} · {people.find(p => p.id === card.memberId)?.name ?? "Shared"}{card.foreignFeeBp == null ? "" : ` · Foreign fee ${card.foreignFeeBp / 100}%`}</summary><ApiForm><CardFields data={data} card={card} /></ApiForm></details>)}
      <details><summary>Add a card</summary><ApiForm><CardFields key={cards.length} data={data} /></ApiForm></details>
    </section>
    <ImportStatement cards={cards.map(card => ({ id: card.id, label: card.label, lastClose: closingBefore({ closingDay: card.closingDay }, data.today) }))} currency={Currency.parse(household.currency)} own={own} />
    <OwnCategories groups={groupOwnCategories(data.ownCategories)} />
    <section className="ui-panel"><h2>{people.length < 2 ? "Bills" : "Shared & personal bills"}</h2><p className="ui-hint">Every bill stays in the household runway.{people.length > 1 && " Choose who it belongs to."}</p>
      {bills.length ? <>{current.map(bill => <BillRow key={bill.id} bill={bill} bills={bills} people={people} today={data.today} own={own} />)}
        {past.length > 0 && <details className="settings-past"><summary>Past bills ({past.length})</summary>
          {past.map(bill => <BillRow key={bill.id} bill={bill} bills={bills} people={people} today={data.today} own={own} />)}</details>}</> : <p className="ui-hint">Your bills appear here after you confirm a reading.</p>}
    </section>
    {canImportPayPal && <section className="ui-panel" id="paypal-import"><h2>PayPal history</h2>
      <p className="ui-hint">Add the clients and invoices from your PayPal sandbox account. This only reads from PayPal and never changes your balance.</p>
      <form method="post" action="/api/paypal/import"><button className="ui-button">Import clients and invoices from PayPal</button></form>
    </section>}
    {canManage && <Suspense fallback={<section className="ui-panel" id="ai-model"><h2>Your AI model</h2><LoadingIndicator label="Loading…" /></section>}>
      <AiModelPanel demo={household.demo} /></Suspense>}
    <Suspense fallback={<section className="ui-panel" id="your-data"><h2>Your data</h2><LoadingIndicator label="Loading…" /></section>}><YourData canDeleteHousehold={canManage} /></Suspense>
    <section className="ui-panel"><h2>Account</h2><p className="ui-hint">{household.demo ? "This is a fictional Try it household. Sign in to start with your own balances." : canManage ? "Manage sign-in and delete your household data." : "Manage sign-in or leave this household."}</p><Link className="ui-button" prefetch={false} href="/account">Open account</Link> <Link className="account-link" href="/privacy">Privacy ›</Link>
      {household.demo && <ResetDemo />}</section>
  </>;
}
