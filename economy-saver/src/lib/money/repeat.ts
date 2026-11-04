// Repeating bills (D41, D48). A stored bill that repeats monthly or yearly becomes one Bill per occurrence, each with the
// amount that applies on its date, so the engine in runway.ts only ever sees dated one-off bills. Pure: dates are
// YYYY-MM-DD strings handled in UTC.

import { z } from "zod";
import type { Bill, CancelNotice, RepeatUnit } from "./types";

/** The repeat units a stored bill may have; no repeat at all (a one-off) is null in storage. */
export const RepeatUnitSchema = z.enum(["month", "year"]);

const pad = (n: number) => String(n).padStart(2, "0");

/** The date `day` falls on in the given month (month 1-12, may overflow), clamped to the month's last day. */
function monthDay(year: number, month: number, day: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(day, last))}`;
}

/**
 * The dates a repeating bill falls due on from `today` to `through`, both ends included: the stored due date when it is
 * today or later, then the same day of each following month (31 becomes the 28th, 29th or 30th in a short month), or for
 * a yearly bill the same month and day of each following year (29 February becomes the 28th in a common year).
 * `repeatDay` is the day of the month for a monthly bill and is not read for a yearly one.
 */
export function occurrenceDates(due: string, unit: RepeatUnit, repeatDay: number | null, today: string, through: string): string[] {
  const dates: string[] = [];
  const year = Number(due.slice(0, 4));
  const month = Number(due.slice(5, 7));
  if (unit === "month" && repeatDay === null) throw new Error("A monthly bill needs its day of the month");
  for (let k = 0; ; k++) {
    const date = k === 0 ? due : unit === "month" ? monthDay(year, month + k, repeatDay!) : monthDay(year + k, month, Number(due.slice(8, 10)));
    if (date > through) break;
    if (date >= today) dates.push(date);
  }
  return dates;
}

/** What an occurrence dated `date` costs: the new amount when it falls on or after the date the amount changes. */
export function amountOn<T>(amount: T, next: { amount: T; from: string } | null, date: string): T {
  return next !== null && date >= next.from ? next.amount : amount;
}

const bump = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

/** The first date after `after` that a stored bill falls due on, or null when it never does (a one-off already past). */
export function nextOccurrenceAfter(bill: Pick<Bill, "due" | "repeatUnit" | "repeatDay">, after: string): string | null {
  if (bill.repeatUnit === undefined) return bill.due > after ? bill.due : null;
  // The series starts at the stored due date; a yearly one has an occurrence within 13 months, a monthly one within 32 days.
  const through = bump(after, bill.repeatUnit === "year" ? 400 : 40);
  return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, bump(after, 1), through)[0] ?? null;
}

/**
 * Turns stored bills into the bills the engine reads. A confirmed bill that repeats becomes one bill per occurrence, each
 * with the id `<id>@<date>` so keys stay unique, the amount that applies on its date, and `startsOn` the stored due date.
 * Anything else (one-off, or pending: it never repeats until confirmed) passes through unchanged.
 */
export function expandBills(bills: Bill[], today: string, through: string): Bill[] {
  const expanded = bills.flatMap((bill): Bill[] => {
    if (bill.repeatUnit === undefined || bill.status !== "confirmed") return [bill];
    const next = bill.nextAmount !== undefined && bill.nextAmountFrom !== undefined ? { amount: bill.nextAmount, from: bill.nextAmountFrom } : null;
    return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, today, through)
      .map(due => ({ ...bill, id: `${bill.id}@${due}`, due, amount: amountOn(bill.amount, next, due), startsOn: bill.due, startAmount: bill.amount }));
  });
  // The order the database gives stored bills: due date, then biller.
  return expanded.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}

/**
 * The cancel-by rows of Coming up (D48): for each confirmed stored bill with a cancel-by date from `today` on, the date, and the
 * first occurrence after it with the amount that applies then (the renewal). Information only; sorted by cancel-by date.
 */
export function cancelNotices(bills: Bill[], today: string): CancelNotice[] {
  const notices: CancelNotice[] = [];
  for (const bill of bills) {
    if (bill.status !== "confirmed" || bill.cancelBy === undefined || bill.cancelBy < today) continue;
    const renewsOn = nextOccurrenceAfter(bill, bill.cancelBy);
    if (renewsOn === null) continue;
    const next = bill.nextAmount !== undefined && bill.nextAmountFrom !== undefined ? { amount: bill.nextAmount, from: bill.nextAmountFrom } : null;
    notices.push({ billId: bill.id, biller: bill.biller, category: bill.category, cancelBy: bill.cancelBy, renewsOn, amount: amountOn(bill.amount, next, renewsOn), repeats: bill.repeatUnit !== undefined });
  }
  return notices.sort((a, b) => (a.cancelBy < b.cancelBy ? -1 : a.cancelBy > b.cancelBy ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}
