// What the read-only family page lists (D52). Pure.

import { minorPerUnit } from "./format";
import { addDays, WINDOW_DAYS } from "./runway";
import type { MoneyState } from "./types";

/**
 * The shared bills that fall due from today to 30 days on, by date (information only). Shared means what the month view
 * means (D52): a confirmed bill with no owner. The money state already holds one row per occurrence (D41).
 */
export function sharedBillsComing(state: MoneyState) {
  const through = addDays(state.today, WINDOW_DAYS - 1);
  const names = new Map(state.split.members.map(member => [member.id, member.name]));
  const unit = minorPerUnit(state.homeCurrency);
  return state.bills
    .filter(bill => bill.status === "confirmed" && bill.ownerId === undefined && bill.due >= state.today && bill.due <= through)
    .map(bill => ({ key: bill.id, biller: bill.biller, date: bill.due, paidBy: bill.paidBy ? names.get(bill.paidBy) ?? "" : "", amountMinor: Math.round(bill.amount * unit), ...(bill.estimated ? { estimated: true as const } : {}) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.biller < b.biller ? -1 : 1));
}
