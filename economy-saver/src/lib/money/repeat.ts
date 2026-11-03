// Monthly bills (D41). A stored bill with a repeat day becomes one Bill per occurrence, so the engine in
// runway.ts only ever sees dated one-off bills. Pure: dates are YYYY-MM-DD strings handled in UTC.

import type { Bill } from "./types";

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
 * The dates a monthly bill falls due on from `today` to `through`, both ends included: the stored due date when it is
 * today or later, then the same day of each following month (31 becomes the 28th, 29th or 30th in a short month).
 */
export function occurrenceDates(due: string, repeatDay: number, today: string, through: string): string[] {
  const dates: string[] = [];
  const year = Number(due.slice(0, 4));
  const month = Number(due.slice(5, 7));
  for (let k = 0; ; k++) {
    const date = k === 0 ? due : monthDay(year, month + k, repeatDay);
    if (date > through) break;
    if (date >= today) dates.push(date);
  }
  return dates;
}

/**
 * Turns stored bills into the bills the engine reads. A confirmed bill with a repeat day becomes one bill per
 * occurrence, each with the id `<id>@<date>` so keys stay unique, `repeatDay` marking it as monthly and `startsOn` the stored due date. Anything
 * else (one-off, or pending: it never repeats until confirmed) passes through unchanged.
 */
export function expandBills(bills: Bill[], today: string, through: string): Bill[] {
  const expanded = bills.flatMap((bill): Bill[] => {
    if (bill.repeatDay === undefined || bill.status !== "confirmed") return [bill];
    return occurrenceDates(bill.due, bill.repeatDay, today, through).map(due => ({ ...bill, id: `${bill.id}@${due}`, due, startsOn: bill.due }));
  });
  // The order the database gives stored bills: due date, then biller.
  return expanded.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}
