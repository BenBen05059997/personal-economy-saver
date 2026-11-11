import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { loadSettings } from "@/db/settings";
import { fromMinor } from "@/db/money";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { PanelHint } from "@/components/ui/PanelHint";
import { Currency } from "@/lib/catalogue/types";
import { aboutMoney, minorMoney, repeatWords } from "@/lib/money/format";
import { AMOUNT_NOT_KNOWN, DATE_NOT_KNOWN } from "@/lib/money/gaps";
import { amountOn, lastOneWords, nextAmountOf, nextOccurrenceAfter } from "@/lib/money/repeat";
import { CategoryFields } from "@/components/household/CategoryFields";
import { PayerOptions } from "@/components/household/PayerOptions";
import { LABELS } from "@/components/household/labels";
import { Detail, ListPage } from "@/components/household/ListPage";
import { CancelByField, RepeatUntilField } from "@/components/household/ScheduleFields";
import { dueLabel } from "@/db/bills";
import { EditAmounts } from "@/components/settings/EditAmounts";
import { Person } from "@/components/settings/CardFields";
import { hrefFor } from "@/lib/links";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { ApiForm } from "@/components/ui/ApiForm";
import "@/components/household/household.css";

type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
type Bill = SettingsData["bills"][number];
function PaidBy({ people, selected }: { people: SettingsData["people"]; selected: string | null }) {
  return <label className="ui-field">Paid by (a shared bill is split by shares)
    <select name="paidByMemberId" defaultValue={selected ?? ""}><PayerOptions people={people} /></select></label>;
}
/** Who a bill belongs to: a person, "Shared, paid by …" when split, or "Shared" with no payer (left out of who owes whom). Nothing when one person is everything. */
function billOwner(bill: Bill, people: SettingsData["people"]) {
  if (people.length < 2) return null;
  const owner = people.find(p => p.id === bill.memberId);
  if (owner) return owner.name;
  const payer = people.find(p => p.id === bill.paidByMemberId);
  if (payer) return `Shared, paid by ${payer.name}`;
  return "Shared";
}
/** The line under a bill's name in the list: its owner (two or more people) and, while it waits for a yes, where it waits. */
function billNote(bill: Bill, people: SettingsData["people"]) {
  return [billOwner(bill, people), bill.status === "pending" ? "waiting in To check" : null].filter(Boolean).join(" · ");
}
/** Remove for one bill: asks first, and says when it repeats that the whole series goes. */
function RemoveBill({ bill }: { bill: Bill }) {
  const repeats = repeatWords(bill.repeatUnit === "year" ? "year" : "month").toLowerCase();
  return <ConfirmRemove kind="bill" id={bill.id} returnTo="/bills" label={`${bill.biller} ${bill.amountMinor === null ? `(${AMOUNT_NOT_KNOWN})` : minorMoney(bill.amountMinor, Currency.parse(bill.currency))}`}
    note={bill.repeatUnit === null ? undefined : `It repeats ${repeats}, so ${repeats} goes.`} />;
}
/**
 * Edit for one confirmed bill, the add form's fields: name, amount, due date, category, for work, whose and who pays. A
 * repeating bill's amount starts from a due date (the next one by default), through its scheduled change (D48); the other
 * fields change the whole series. D54: a monthly bill has "Amount changes every month" (its amount is then the estimate before any
 * real bill, with no date); a one-off has "Part of" while this household has an amount-varies monthly bill in its category.
 */
function EditBill({ bill, bills, people, today, own }: { bill: Bill; bills: SettingsData["bills"]; people: SettingsData["people"]; today: string; own: OwnChoices }) {
  const currency = Currency.parse(bill.currency);
  const repeat = bill.repeatUnit === "month" || bill.repeatUnit === "year" ? bill.repeatUnit : null;
  const series = repeat !== null ? [] : bills.filter(b => b.amountVaries && b.status === "confirmed" && (b.category === bill.category || b.id === bill.seriesBillId));
  const next = nextAmountOf(bill);
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const from = repeat === null || bill.due === null ? null : nextOccurrenceAfter({ due: bill.due, repeatUnit: repeat, repeatDay: bill.repeatDay ?? undefined, ...(bill.repeatUntil !== null && { repeatUntil: bill.repeatUntil }) }, yesterday) ?? bill.due;
  const amount = bill.amountMinor === null ? null : from === null || bill.amountVaries ? bill.amountMinor : amountOn(bill.amountMinor, next, from);
  const fromHint = `Repeats ${repeatWords(repeat).toLowerCase()}: a new amount starts on this due date. Choose the first due date${bill.due === null ? "" : `, ${dueLabel(bill.due, today)},`} to correct every one.${next ? ` It changes to ${minorMoney(next.amount, currency)} from ${dueLabel(next.from, today)}.` : ""}`;
  return <details className="directory-edit"><summary aria-label={`Edit ${bill.biller}`}>Edit</summary>
    <ApiForm action="/api/bills"><input type="hidden" name="kind" value="edit" /><input type="hidden" name="id" value={bill.id} /><input type="hidden" name="returnTo" value={`/bills/${bill.id}`} />
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
function lastOne(bill: Bill, today: string) {
  return bill.due === null || (bill.repeatUnit !== "month" && bill.repeatUnit !== "year") ? null : lastOneWords({ due: bill.due, repeatUnit: bill.repeatUnit, repeatDay: bill.repeatDay, repeatUntil: bill.repeatUntil }, today);
}
/** When a bill is next due: a repeating bill's next occurrence from today (its stored date is the first one), else its date. */
function nextDue(bill: Bill, today: string) {
  if (bill.due === null || (bill.repeatUnit !== "month" && bill.repeatUnit !== "year")) return bill.due;
  const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
  return nextOccurrenceAfter({ due: bill.due, repeatUnit: bill.repeatUnit, repeatDay: bill.repeatDay ?? undefined, ...(bill.repeatUntil !== null && { repeatUntil: bill.repeatUntil }) }, yesterday) ?? bill.due;
}
/** One bill in the list: its biller and summary, its amount and due date. A click opens its panel. */
function BillRow({ bill, people, today, selected }: { bill: Bill; people: SettingsData["people"]; today: string; selected: boolean }) {
  const currency = Currency.parse(bill.currency);
  const last = lastOne(bill, today);
  return <Link prefetch={false} id={`bill-${bill.id}`} className="ui-row directory-link" href={hrefFor({ type: "bill", id: bill.id })} aria-label={bill.biller} aria-current={selected ? "page" : undefined}>
    <div>{bill.biller}{billNote(bill, people) && <small>{billNote(bill, people)}</small>}{last && <small>{last}</small>}</div>
    <div>{bill.amountMinor === null ? AMOUNT_NOT_KNOWN : bill.amountVaries ? `${aboutMoney(bill.amountMinor, currency)} · varies` : minorMoney(bill.amountMinor, currency)}
      <small>{nextDue(bill, today) === null ? DATE_NOT_KNOWN : `due ${dueLabel(nextDue(bill, today)!, today)}`}</small></div>
  </Link>;
}

function BillPanel({ bill, bills, people, today, own }: { bill: Bill; bills: Bill[]; people: SettingsData["people"]; today: string; own: OwnChoices }) {
  const currency = Currency.parse(bill.currency);
  const owner = billOwner(bill, people);
  const last = lastOne(bill, today);
  return <Detail title={bill.biller} close="/bills">
    <dl>
      <div className="ui-row"><dt>Amount</dt><dd>{bill.amountMinor === null ? AMOUNT_NOT_KNOWN : bill.amountVaries ? `${aboutMoney(bill.amountMinor, currency)} · varies` : minorMoney(bill.amountMinor, currency)}</dd></div>
      <div className="ui-row"><dt>{bill.repeatUnit === null ? "Due" : "Next due"}</dt><dd>{nextDue(bill, today) === null ? DATE_NOT_KNOWN : dueLabel(nextDue(bill, today)!, today)}</dd></div>
      {bill.repeatUnit !== null && <div className="ui-row"><dt>Repeats</dt><dd>{repeatWords(bill.repeatUnit === "year" ? "year" : "month")}</dd></div>}
      {last && <div className="ui-row"><dt>Last payment</dt><dd>{last}</dd></div>}
      {owner && <div className="ui-row"><dt>Belongs to</dt><dd>{owner}</dd></div>}
      {bill.status === "pending" && <div className="ui-row"><dt>Status</dt><dd>Waiting in To check</dd></div>}
    </dl>
    {bill.status === "confirmed" && <EditBill bill={bill} bills={bills} people={people} today={today} own={own} />}
    <RemoveBill bill={bill} />
  </Detail>;
}

/**
 * The Bills page: the household's current bills, one row each, then Past bills as a fold (a one-off already due is history). A row opens its
 * panel on the right with Edit and Remove; the forwarding address, where bills arrive, is a section under the list.
 */
export function BillsView({ data, own, selected, forwarding }: { data: SettingsData; own: OwnChoices; selected?: string; forwarding: ReactNode }) {
  const { people, bills, today } = data;
  const bill = selected ? bills.find(row => row.id === selected) : undefined;
  if (selected && !bill) notFound();
  const isPast = (row: Bill) => row.status === "confirmed" && row.repeatUnit === null && row.due !== null && row.due < today;
  const current = bills.filter(row => !isPast(row));
  const past = bills.filter(isPast);
  return <ListPage title="Bills" hint={`Every bill stays in the household runway.${people.length > 1 ? " Choose who it belongs to." : ""}`} add="bill" addLabel="Add a bill"
    panel={bill && <BillPanel bill={bill} bills={bills} people={people} today={today} own={own} />}>
    {current.map(row => <BillRow key={row.id} bill={row} people={people} today={today} selected={row.id === selected} />)}
    {bills.length === 0 && <PanelHint className="directory-empty" add="bill" label="Add a bill">No bills yet.</PanelHint>}
    {past.length > 0 && <details className="directory-fold" open={bill !== undefined && isPast(bill)}><summary>Past bills ({past.length})</summary>
      {past.map(row => <BillRow key={row.id} bill={row} people={people} today={today} selected={row.id === selected} />)}</details>}
    <div className="directory-section">{forwarding}</div>
  </ListPage>;
}
