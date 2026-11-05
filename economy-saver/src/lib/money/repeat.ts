// Repeating bills (D41, D48). A stored bill that repeats monthly or yearly becomes one Bill per occurrence, each with the
// amount that applies on its date, so the engine in runway.ts only ever sees dated one-off bills. Pure: dates are
// YYYY-MM-DD strings handled in UTC.

import { z } from "zod";
import type { Currency } from "@/lib/catalogue/types";
import { minorPerUnit } from "./format";
import type { Bill, CancelNotice, RealBill, RepeatUnit } from "./types";

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

/** The date and amount of the change a bill carries (D48), whichever way the bill keeps it: `nextAmount` (units, a `Bill`) or `nextAmountMinor` (a stored row); null when it has none. */
export function nextAmountOf(bill: { nextAmount?: number | null; nextAmountMinor?: number | null; nextAmountFrom?: string | null }): { amount: number; from: string } | null {
  const amount = bill.nextAmount ?? bill.nextAmountMinor ?? null;
  const from = bill.nextAmountFrom ?? null;
  return amount !== null && from !== null ? { amount, from } : null;
}

/** The dates a bill falls due on from `from` to `to`, both included: its due date when it is a one-off in range, else every occurrence in range. */
export function datesIn(bill: { due: string; repeatUnit?: RepeatUnit | null; repeatDay?: number | null }, from: string, to: string): string[] {
  if (bill.repeatUnit === undefined || bill.repeatUnit === null) return bill.due >= from && bill.due <= to ? [bill.due] : [];
  return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, from, to);
}

const bump = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

/** The first date after `after` that a stored bill falls due on, or null when it never does (a one-off already past). */
export function nextOccurrenceAfter(bill: Pick<Bill, "due" | "repeatUnit" | "repeatDay">, after: string): string | null {
  if (bill.repeatUnit === undefined) return bill.due > after ? bill.due : null;
  // The series starts at the stored due date; a yearly one has an occurrence within 13 months, a monthly one within 32 days.
  const through = bump(after, bill.repeatUnit === "year" ? 400 : 40);
  return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, bump(after, 1), through)[0] ?? null;
}

// ---------------------------------------------------------------- D54: a monthly bill whose amount varies

/** The calendar months (YYYY-MM) that have a real bill. */
export function realMonths(real: RealBill[]): Set<string> {
  return new Set(real.map(bill => bill.due.slice(0, 7)));
}

/**
 * What an occurrence of an amount-varies series dated `date` is forecast at, in whole minor units: the average of the last three
 * real bills due before it (fewer when fewer exist), rounded to the minor unit (half up), or `storedMinor`, the series' own
 * amount, when there are none. Only called for a month without its own real bill (that month is the real bill instead).
 */
export function variesEstimate(real: RealBill[], storedMinor: number, date: string): number {
  const last = real.filter(bill => bill.due < date)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.amountMinor - b.amountMinor)).slice(-3);
  if (last.length === 0) return storedMinor;
  return Math.round(last.reduce((sum, bill) => sum + bill.amountMinor, 0) / last.length);
}

/**
 * The dates and amounts (minor units) an amount-varies series counts on from `from` to `to`: every occurrence in a month with no
 * real bill, at `variesEstimate`. A month with a real bill has no occurrence here; the real bill counts on its own date, once.
 */
export function variesOccurrences(series: { due: string; repeatDay: number | null; storedMinor: number }, real: RealBill[], from: string, to: string): { date: string; amountMinor: number }[] {
  const months = realMonths(real);
  return occurrenceDates(series.due, "month", series.repeatDay, from, to)
    .filter(date => !months.has(date.slice(0, 7)))
    .map(date => ({ date, amountMinor: variesEstimate(real, series.storedMinor, date) }));
}

/** The confirmed one-off real bills linked to each confirmed amount-varies series in `bills`, by series id, in minor units (`unit` per unit). */
export function realBillsBySeries(bills: Bill[], unit: number): Map<string, RealBill[]> {
  const series = new Set(bills.filter(bill => bill.amountVaries && bill.status === "confirmed").map(bill => bill.id.split("@")[0]));
  const real = new Map<string, RealBill[]>();
  for (const bill of bills) {
    if (bill.status !== "confirmed" || bill.repeatUnit !== undefined || bill.seriesBillId === undefined || !series.has(bill.seriesBillId)) continue;
    real.set(bill.seriesBillId, [...(real.get(bill.seriesBillId) ?? []), { due: bill.due, amountMinor: Math.round(bill.amount * unit) }]);
  }
  return real;
}

/** The unit an amount-varies estimate rounds to; refuses to guess the currency when one is needed and not given. */
function estimateUnit(bills: Bill[], currency: Currency | undefined): number {
  if (currency !== undefined) return minorPerUnit(currency);
  if (bills.some(bill => bill.amountVaries && bill.status === "confirmed")) throw new Error("A bill whose amount varies needs the home currency to round its estimate");
  return 1; // never read: no bill here has an estimate
}

/**
 * Turns stored bills into the bills the engine reads. A confirmed bill that repeats becomes one bill per occurrence, each
 * with the id `<id>@<date>` so keys stay unique, the amount that applies on its date, and `startsOn` the stored due date.
 * Anything else (one-off, or pending: it never repeats until confirmed) passes through unchanged.
 * An amount-varies monthly bill (D54) has no occurrence in a month that holds one of its real bills (the real bill, a one-off
 * here, is the month's amount, counted once on its own date); every other occurrence is `estimated` at `variesEstimate`.
 * `currency` (the home currency) is needed exactly when there is such a bill: the estimate is rounded to its minor unit.
 */
export function expandBills(bills: Bill[], today: string, through: string, currency?: Currency): Bill[] {
  const unit = estimateUnit(bills, currency);
  const real = realBillsBySeries(bills, unit);
  const expanded = bills.flatMap((bill): Bill[] => {
    if (bill.repeatUnit === undefined || bill.status !== "confirmed") return [bill];
    const series = { startsOn: bill.due, startAmount: bill.amount };
    if (bill.amountVaries) {
      return variesOccurrences({ due: bill.due, repeatDay: bill.repeatDay ?? null, storedMinor: Math.round(bill.amount * unit) }, real.get(bill.id) ?? [], today, through)
        .map(({ date, amountMinor }) => ({ ...bill, id: `${bill.id}@${date}`, due: date, amount: amountMinor / unit, estimated: true as const, ...series }));
    }
    const next = nextAmountOf(bill);
    return datesIn(bill, today, through)
      .map(due => ({ ...bill, id: `${bill.id}@${due}`, due, amount: amountOn(bill.amount, next, due), ...series }));
  });
  // The order the database gives stored bills: due date, then biller.
  return expanded.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}

/**
 * The cancel-by rows of Coming up (D48): for each confirmed stored bill with a cancel-by date from `today` on, the date, and the
 * first occurrence after it with the amount that applies then (the renewal; for an amount-varies bill its estimate, D54, which
 * needs `currency` as `expandBills` does). Information only; sorted by cancel-by date.
 */
export function cancelNotices(bills: Bill[], today: string, currency?: Currency): CancelNotice[] {
  const unit = estimateUnit(bills, currency);
  const real = realBillsBySeries(bills, unit);
  const notices: CancelNotice[] = [];
  for (const bill of bills) {
    if (bill.status !== "confirmed" || bill.cancelBy === undefined || bill.cancelBy < today) continue;
    const renewsOn = nextOccurrenceAfter(bill, bill.cancelBy);
    if (renewsOn === null) continue;
    const next = nextAmountOf(bill);
    const amount = bill.amountVaries ? variesEstimate(real.get(bill.id) ?? [], Math.round(bill.amount * unit), renewsOn) / unit : amountOn(bill.amount, next, renewsOn);
    notices.push({ billId: bill.id, biller: bill.biller, category: bill.category, cancelBy: bill.cancelBy, renewsOn, amount, repeats: bill.repeatUnit !== undefined });
  }
  return notices.sort((a, b) => (a.cancelBy < b.cancelBy ? -1 : a.cancelBy > b.cancelBy ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}
