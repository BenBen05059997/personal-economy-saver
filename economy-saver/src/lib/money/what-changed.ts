// What did this change (D77). Pure: the picture without an item and the picture with it, side by side. A pending bill, charge, pot or bank
// balance gives "if you confirm" (now against with it confirmed); a confirmed bill, charge or pot gives "what it changed" (the state without it against
// now). Nothing is stored for either side: both are worked out here from the money state and the spending, by the engine's own functions.
import { categoryLabel } from "./categories";
import { dayLabel, minorMoney, minorPerUnit } from "./format";
import { monthByCategory } from "./month";
import { availableCash, low, paybackFor, safeToSpend, series } from "./runway";
import { homeSentence } from "./sentence";
import { monthName, type SpendingInput } from "./spending";
import { splitBalance } from "./split";
import type { Bill, Charge, MoneyState, Pot, SplitState } from "./types";
import { cardSummary } from "./card-summary";

/** A problem in the item asked about, written for the person. */
export class WhatChangedError extends Error {}

export type ChangedRow = { key: string; label: string; before: string; after: string; change: string | null };
export type WhatChanged = {
  name: string;
  kind: "bill" | "charge" | "pot" | "balance";
  when: "pending" | "confirmed"; // pending: before = now, after = if confirmed; confirmed: before = without it, after = now
  rows: ChangedRow[]; // the fixed order, only the rows that move, then the lowest day, then the sentence
  sentence: { before: string; after: string; changed: boolean };
  lowLateMinor: { before: number; after: number };
  lowUsualMinor: { before: number; after: number };
  safeMinor: { before: number; after: number };
};

type Side = { state: MoneyState; spending: SpendingInput };
const storedId = (id: string) => (id.includes("@") ? id.slice(0, id.indexOf("@")) : id);

/** The item as the two sides it makes. Throws `WhatChangedError` when the household has no such item or it cannot be compared. */
function sides(state: MoneyState, spending: SpendingInput, itemId: string): { name: string; kind: WhatChanged["kind"]; when: WhatChanged["when"]; without: Side; with: Side; category: { key: Bill["category"]; month: string } | null } {
  const per = minorPerUnit(state.homeCurrency), minor = (value: number) => Math.round(value * per);
  const now: Side = { state, spending };
  const billsNamed = state.bills.filter(bill => bill.id === itemId || storedId(bill.id) === itemId);
  const stored = state.storedBills.find(bill => bill.id === itemId || storedId(itemId) === bill.id);
  if (billsNamed.length > 0 || stored) {
    const pending = (billsNamed[0] ?? stored!).status === "pending";
    const id = storedId(billsNamed[0]?.id ?? stored!.id), shared = (billsNamed[0] ?? stored!).ownerId === undefined && (billsNamed[0] ?? stored!).paidBy !== undefined && state.split.members.length >= 2;
    const own = billsNamed.length > 0 ? billsNamed : stored && stored.amount !== null && stored.due !== null ? [{ ...stored, amount: stored.amount, due: stored.due } as Bill] : [];
    if (own.length === 0) throw new WhatChangedError("That bill has no amount or date yet, so there is nothing to compare.");
    const first = own[0], name = first.biller, month = (first.dueUnknown ? state.today : first.due).slice(0, 7);
    const category = { key: first.category, month };
    const confirmedOwn = own.map((bill): Bill => ({ ...bill, status: "confirmed" }));
    const asSplit = (): SplitState["bills"][number] => ({
      id, biller: name, amountMinor: minor(first.amount), due: first.due, paidBy: first.paidBy!, createdAt: `${state.today}T23:59:59.000Z`,
      repeatUnit: first.repeatUnit ?? null, repeatDay: first.repeatDay ?? null, repeatUntil: first.repeatUntil ?? null,
      nextAmountMinor: first.nextAmount === undefined ? null : minor(first.nextAmount), nextAmountFrom: first.nextAmountFrom ?? null,
    });
    const without = (side: Side): Side => ({ state: { ...side.state, bills: side.state.bills.filter(bill => storedId(bill.id) !== id), storedBills: side.state.storedBills.filter(bill => bill.id !== id), split: { ...side.state.split, bills: side.state.split.bills.filter(bill => bill.id !== id) } },
      spending: { ...side.spending, bills: side.spending.bills.filter(bill => storedId(bill.id) !== id) } });
    if (pending) {
      const confirmed: Side = {
        state: { ...state, bills: [...state.bills.filter(bill => storedId(bill.id) !== id), ...(billsNamed.length > 0 ? confirmedOwn : [])].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0)), storedBills: state.storedBills.map(bill => bill.id === id ? { ...bill, status: "confirmed" as const } : bill), split: shared ? { ...state.split, bills: [...state.split.bills, asSplit()] } : state.split },
        spending: { ...spending, bills: [...spending.bills, ...confirmedOwn] },
      };
      return { name, kind: "bill", when: "pending", without: now, with: confirmed, category };
    }
    return { name, kind: "bill", when: "confirmed", without: without(now), with: now, category };
  }
  const charge: Charge | undefined = state.charges.find(item => item.id === itemId);
  if (charge) {
    const owner = state.cards.find(card => card.id === charge.cardId)?.ownerId, shared = charge.shared === true && owner !== undefined && state.split.members.length >= 2;
    const category = { key: charge.category, month: charge.date.slice(0, 7) };
    const asSplit = () => ({ id: charge.id, merchant: charge.merchant, amountMinor: minor(charge.amount), date: charge.date, paidBy: owner!, createdAt: `${state.today}T23:59:59.000Z` });
    if (charge.status === "pending") {
      const confirmed: Side = {
        state: { ...state, charges: state.charges.map(item => item.id === itemId ? { ...item, status: "confirmed" as const } : item), split: shared ? { ...state.split, charges: [...state.split.charges, asSplit()] } : state.split },
        spending: { ...spending, charges: [...spending.charges, { ...charge, status: "confirmed" }] },
      };
      return { name: charge.merchant, kind: "charge", when: "pending", without: now, with: confirmed, category };
    }
    const gone: Side = { state: { ...state, charges: state.charges.filter(item => item.id !== itemId), split: { ...state.split, charges: state.split.charges.filter(item => item.id !== itemId) } }, spending: { ...spending, charges: spending.charges.filter(item => item.id !== itemId) } };
    return { name: charge.merchant, kind: "charge", when: "confirmed", without: gone, with: now, category };
  }
  const pot: Pot | undefined = state.pendingPots.find(item => item.id === itemId);
  if (pot) return { name: pot.name, kind: "pot", when: "pending", without: now, with: { state: { ...state, pots: [...state.pots, pot], pendingPots: state.pendingPots.filter(item => item.id !== itemId) }, spending }, category: null };
  const update = state.balanceUpdates.find(item => item.id === itemId);
  if (update) return { name: "Your new bank balance", kind: "balance", when: "pending", without: now, with: { state: { ...state, bank: update.amount, balanceUpdates: state.balanceUpdates.filter(item => item.id !== itemId) }, spending }, category: null };
  const saved: Pot | undefined = state.pots.find(item => item.id === itemId);
  if (saved) return { name: saved.name, kind: "pot", when: "confirmed", without: { state: { ...state, pots: state.pots.filter(item => item.id !== itemId) }, spending }, with: now, category: null };
  throw new WhatChangedError("That item is not in your records.");
}

export function whatChanged(input: { state: MoneyState; spending: SpendingInput }, { itemId }: { itemId: string }): WhatChanged {
  const { state } = input, currency = state.homeCurrency, per = minorPerUnit(currency), minor = (value: number) => Math.round(value * per), format = (value: number) => minorMoney(value, currency);
  const item = sides(state, input.spending, itemId);
  const before = item.without, after = item.with; // pending: now and if confirmed; confirmed: without it and now
  const delta = (a: number, b: number) => `${b - a < 0 ? "−" : "+"}${format(Math.abs(b - a))}`;
  const rows: ChangedRow[] = [];
  const money = (key: string, label: string, a: number, b: number) => { if (a !== b) rows.push({ key, label, before: format(a), after: format(b), change: delta(a, b) }); };

  if (item.kind === "pot") { const [a, b] = [before.state.pots.length, after.state.pots.length]; if (a !== b) rows.push({ key: "pots", label: "Saving pots", before: String(a), after: String(b), change: `${b - a < 0 ? "−" : "+"}${Math.abs(b - a)}` }); }
  money("bank", "Bank balance", minor(before.state.bank), minor(after.state.bank));
  money("cash", "Cash to spend", minor(availableCash(before.state)), minor(availableCash(after.state)));
  for (const card of state.cards) {
    money(`owed-${card.id}`, `${card.label} owed now`, minor(cardSummary(before.state, card.id).owed), minor(cardSummary(after.state, card.id).owed));
    const a = paybackFor(before.state, card.id), b = paybackFor(after.state, card.id);
    if (a?.amount !== b?.amount || a?.dueOn !== b?.dueOn) {
      const words = (next: typeof a) => next ? (a?.dueOn === b?.dueOn ? format(minor(next.amount)) : `${format(minor(next.amount))} on ${dayLabel(next.dueOn)}`) : "None";
      rows.push({ key: `statement-${card.id}`, label: `${card.label} next statement${b && a?.dueOn === b.dueOn ? ` (due ${dayLabel(b.dueOn)})` : ""}`, before: words(a), after: words(b), change: a && b ? delta(minor(a.amount), minor(b.amount)) : null });
    }
  }
  if (item.category) {
    const total = (side: Side) => monthByCategory(side.spending, state.today, item.category!.month).categories.find(c => c.category === item.category!.key)?.totalMinor ?? 0;
    const month = item.category.month === state.today.slice(0, 7) ? "this month" : `in ${monthName(item.category.month)}`;
    money("category", `${categoryLabel(item.category.key)} ${month}`, total(before), total(after));
  }
  const owes = (side: Side) => splitBalance(side.state.split, state.today).transfers;
  const [owesBefore, owesAfter] = [owes(before), owes(after)];
  const pairs = new Map<string, { line: string; a: number; b: number }>();
  for (const [side, list] of [["a", owesBefore], ["b", owesAfter]] as const) for (const t of list) {
    const key = `${t.fromId}>${t.toId}`, row = pairs.get(key) ?? { line: `${t.fromName} owes ${t.toName}`, a: 0, b: 0 };
    row[side] = t.amountMinor; pairs.set(key, row);
  }
  for (const [key, row] of pairs) if (row.a !== row.b) rows.push({ key: `owes-${key}`, label: row.line, before: format(row.a), after: format(row.b), change: delta(row.a, row.b) });

  const safe = (side: Side) => minor(safeToSpend(side.state, 0).amount);
  money("safe", "Safe to spend", safe(before), safe(after));
  const lowOf = (side: Side, kind: "worst" | "expected") => minor(low(series(side.state, kind)).amount);
  const lateA = lowOf(before, "worst"), lateB = lowOf(after, "worst");
  rows.push({ key: "low", label: "Lowest if clients pay late", before: format(lateA), after: format(lateB), change: lateA === lateB ? null : delta(lateA, lateB) });
  const sentenceBefore = homeSentence(before.state).text, sentenceAfter = homeSentence(after.state).text;
  rows.push({ key: "sentence", label: "Your sentence", before: sentenceBefore, after: sentenceAfter, change: null });
  return {
    name: item.name, kind: item.kind, when: item.when, rows,
    sentence: { before: sentenceBefore, after: sentenceAfter, changed: sentenceBefore !== sentenceAfter },
    lowLateMinor: { before: lateA, after: lateB }, lowUsualMinor: { before: lowOf(before, "expected"), after: lowOf(after, "expected") },
    safeMinor: { before: safe(before), after: safe(after) },
  };
}
