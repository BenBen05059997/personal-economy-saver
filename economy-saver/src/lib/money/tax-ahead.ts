// Will the pot cover the tax bills? (D77) Pure; integer minor units. The pot starts at what it holds today and steps up by its fill share of each
// open client invoice on its usual pay date (only invoices already sent: future work is never guessed). Its Government & tax bills due in the
// window add up beside it. A pending bill is named and not counted. Never a judgement of the tax itself (D7).
import { minorPerUnit } from "./format";
import { fillShare } from "./pots";
import { arrivals, daysBetween } from "./runway";
import type { MoneyState } from "./types";

/** The days the tax pot is held against the tax bills, for the picture and for the finding. */
export const TAX_AHEAD_DAYS = 90;

export type TaxStep = { index: number; date: string; client: string; number?: string; invoiceMinor: number; addMinor: number };
export type TaxBill = { id: string; index: number; date: string; biller: string; amountMinor: number; pending: boolean; counted: boolean };
export type TaxAhead = {
  potId: string; potName: string; days: number; startDate: string; fillBp: number;
  pot: number[]; bills: number[]; // one value per day from today: the pot, and the tax bills due so far (cumulative)
  steps: TaxStep[]; taxBills: TaxBill[];
  low: { index: number; short: boolean; shortMinor: number; marginMinor: number }; // the first day the bills exceed the pot, else the day with the least to spare on a bill day
};

/** The pot at `potId` against its tax bills; null when the pot does not exist or has no fill rule (the caller says so in words). */
export function taxAhead(state: MoneyState, potId: string, days: number): TaxAhead | null {
  const pot = state.pots.find(row => row.id === potId);
  if (!pot || pot.fillPct === undefined) return null;
  const per = minorPerUnit(state.homeCurrency), fillBp = Math.round(pot.fillPct * 100), minor = (amount: number) => Math.round(amount * per);
  const delta = new Array<number>(days).fill(0), owed = new Array<number>(days).fill(0);
  const steps: TaxStep[] = [];
  for (const arrival of arrivals(state)) {
    const index = daysBetween(state.today, arrival.expectedOn);
    if (index < 0 || index >= days) continue;
    const invoiceMinor = minor(arrival.amountHome), addMinor = fillShare(invoiceMinor, fillBp);
    delta[index] += addMinor;
    steps.push({ index, date: arrival.expectedOn, client: arrival.clientName, number: arrival.number, invoiceMinor, addMinor });
  }
  steps.sort((a, b) => a.index - b.index || a.client.localeCompare(b.client));
  const taxBills: TaxBill[] = [];
  for (const bill of state.bills) {
    if (bill.category !== "government_tax") continue;
    const index = daysBetween(state.today, bill.due);
    if (index < 0 || index >= days) continue;
    const pending = bill.status === "pending", counted = !pending && !bill.uncounted;
    const amountMinor = minor(bill.amount);
    if (counted) owed[index] += amountMinor;
    taxBills.push({ id: bill.id, index, date: bill.due, biller: bill.biller, amountMinor, pending, counted });
  }
  taxBills.sort((a, b) => a.index - b.index || a.biller.localeCompare(b.biller));
  let held = minor(pot.saved), due = 0;
  const potLine: number[] = [], billsLine: number[] = [];
  for (let i = 0; i < days; i++) { held += delta[i]; due += owed[i]; potLine.push(held); billsLine.push(due); }
  let index = billsLine.findIndex((value, i) => value > potLine[i]);
  const short = index >= 0;
  // Else the least to spare on a day a counted bill falls due (before any bill the margin is just the pot); with none counted, the first tax bill's day.
  if (!short) { const due = owed.flatMap((value, i) => value > 0 ? [i] : []); index = due.length ? due[0] : taxBills[0]?.index ?? 0; due.forEach(i => { if (potLine[i] - billsLine[i] < potLine[index] - billsLine[index]) index = i; }); }
  const margin = potLine[index] - billsLine[index];
  return { potId, potName: pot.name, days, startDate: state.today, fillBp, pot: potLine, bills: billsLine, steps, taxBills, low: { index, short, shortMinor: short ? -margin : 0, marginMinor: margin } };
}
