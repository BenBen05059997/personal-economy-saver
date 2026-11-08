// Repeating bills (D41, D48). A stored bill that repeats monthly or yearly becomes one Bill per occurrence, each with the
// amount that applies on its date, so the engine in runway.ts only ever sees dated one-off bills. Pure: dates are
// YYYY-MM-DD strings handled in UTC.

import { z } from "zod";
import type { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorPerUnit } from "./format";
import { estimatedFields, gapEstimate, nameHistory } from "./gaps";
import type { Bill, CancelNotice, RealBill, RepeatUnit, StoredBill } from "./types";

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
export function occurrenceDates(due: string, unit: RepeatUnit, repeatDay: number | null, today: string, through: string, until: string | null = null): string[] {
  const dates: string[] = [];
  if (until !== null && until < through) through = until; // D41: nothing after the last payment
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
export function datesIn(bill: { due: string; repeatUnit?: RepeatUnit | null; repeatDay?: number | null; repeatUntil?: string | null }, from: string, to: string): string[] {
  if (bill.repeatUnit === undefined || bill.repeatUnit === null) return bill.due >= from && bill.due <= to ? [bill.due] : [];
  return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, from, to, bill.repeatUntil ?? null);
}

const bump = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

/** The first date after `after` that a stored bill falls due on, or null when it never does (a one-off already past). */
export function nextOccurrenceAfter(bill: Pick<Bill, "due" | "repeatUnit" | "repeatDay" | "repeatUntil">, after: string): string | null {
  if (bill.repeatUnit === undefined) return bill.due > after ? bill.due : null;
  // The series starts at the stored due date; a yearly one has an occurrence within 13 months, a monthly one within 32 days.
  const through = bump(after, bill.repeatUnit === "year" ? 400 : 40);
  return occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, bump(after, 1), through, bill.repeatUntil ?? null)[0] ?? null;
}

/** The last occurrence of a repeating bill on or before its last payment day (D41); never empty, because `repeatUntil >= due`. */
export function lastPayment(bill: { due: string; repeatUnit: RepeatUnit; repeatDay?: number | null; repeatUntil: string }): string {
  const dates = occurrenceDates(bill.due, bill.repeatUnit, bill.repeatDay ?? null, bill.due, bill.repeatUntil, bill.repeatUntil);
  const last = dates[dates.length - 1];
  if (last === undefined) throw new Error("A last payment is on or after the first due date");
  return last;
}

/** "last one Dec 27", or "last one Dec 1, 2027" when the year is not today's; null without a last payment. The one place these words are written. */
export function lastOneWords(bill: { due: string; repeatUnit?: RepeatUnit | null; repeatDay?: number | null; repeatUntil?: string | null }, today: string): string | null {
  if (bill.repeatUnit === undefined || bill.repeatUnit === null || bill.repeatUntil === undefined || bill.repeatUntil === null) return null;
  const last = lastPayment({ due: bill.due, repeatUnit: bill.repeatUnit, repeatDay: bill.repeatDay, repeatUntil: bill.repeatUntil });
  return `last one ${dayLabel(last)}${last.slice(0, 4) === today.slice(0, 4) ? "" : ", " + last.slice(0, 4)}`;
}

// ---------------------------------------------------------------- D54: a monthly bill whose amount varies

/** The calendar months (YYYY-MM) that have a real bill. */
function realMonths(real: RealBill[]): Set<string> {
  return new Set(real.map(bill => bill.due.slice(0, 7)));
}

/**
 * What an occurrence of an amount-varies series dated `date` is forecast at, in whole minor units: the average of the last three
 * real bills due before it (fewer when fewer exist), rounded to the minor unit (half up), or `storedMinor`, the series' own
 * amount, when there are none. Only called for a month without its own real bill (that month is the real bill instead).
 */
export function variesEstimate(real: RealBill[], storedMinor: number, date: string): number {
  return gapEstimate(real, date)?.averageMinor ?? storedMinor;
}

/**
 * The dates and amounts (minor units) an amount-varies series counts on from `from` to `to`: every occurrence in a month with no
 * real bill, at `variesEstimate` (null when the series has no amount of its own and no real bill before the date). A month with a
 * real bill has no occurrence here; the real bill counts on its own date, once. `unpriced` are the due dates of the series' real
 * bills whose amount is not known (D55): they take their month as the others do but are no part of any estimate.
 */
export function variesOccurrences(series: { due: string; repeatDay: number | null; storedMinor: number | null; until?: string | null }, real: RealBill[], from: string, to: string, unpriced: string[] = []): { date: string; amountMinor: number | null }[] {
  const months = new Set([...realMonths(real), ...unpriced.map(due => due.slice(0, 7))]);
  return occurrenceDates(series.due, "month", series.repeatDay, from, to, series.until ?? null)
    .filter(date => !months.has(date.slice(0, 7)))
    .map(date => ({ date, amountMinor: series.storedMinor === null ? (gapEstimate(real, date)?.averageMinor ?? null) : variesEstimate(real, series.storedMinor, date) }));
}

/** The fields of a bill the series rules read: a stored bill, or an engine bill (D55: `amountUnknown` / `dueUnknown` say the same as a null). */
type SeriesBill = Pick<StoredBill, "id" | "status" | "repeatUnit" | "seriesBillId" | "amountVaries" | "amount" | "due"> & { amountUnknown?: true; dueUnknown?: true };

const priced = (bill: SeriesBill) => bill.amount !== null && !bill.amountUnknown && bill.due !== null && !bill.dueUnknown;

function linkedReal(bills: SeriesBill[]) {
  const series = new Set(bills.filter(bill => bill.amountVaries && bill.status === "confirmed").map(bill => bill.id.split("@")[0]));
  return bills.filter(bill => bill.status === "confirmed" && bill.repeatUnit === undefined && bill.seriesBillId !== undefined && series.has(bill.seriesBillId));
}

/** The confirmed one-off real bills linked to each confirmed amount-varies series in `bills`, by series id, in minor units (`unit` per unit). Real bills whose amount or date is not known are left out (D55). */
export function realBillsBySeries(bills: SeriesBill[], unit: number): Map<string, RealBill[]> {
  const real = new Map<string, RealBill[]>();
  for (const bill of linkedReal(bills)) {
    if (!priced(bill)) continue;
    real.set(bill.seriesBillId!, [...(real.get(bill.seriesBillId!) ?? []), { due: bill.due!, amountMinor: Math.round(bill.amount! * unit) }]);
  }
  return real;
}

/** The due dates of each series' confirmed real bills whose amount is not known (D55), by series id: they replace that month's occurrence but are in no average. */
export function unpricedBySeries(bills: SeriesBill[]): Map<string, string[]> {
  const unpriced = new Map<string, string[]>();
  for (const bill of linkedReal(bills)) {
    if (priced(bill) || bill.due === null || bill.dueUnknown) continue;
    unpriced.set(bill.seriesBillId!, [...(unpriced.get(bill.seriesBillId!) ?? []), bill.due]);
  }
  return unpriced;
}

/** The unit an amount-varies estimate rounds to; refuses to guess the currency when one is needed and not given. */
function estimateUnit(bills: StoredBill[], currency: Currency | undefined): number {
  if (currency !== undefined) return minorPerUnit(currency);
  if (bills.some(bill => (bill.amountVaries && bill.status === "confirmed") || bill.amount === null)) throw new Error("A bill whose amount varies or is not known needs the home currency to round its estimate");
  return 1; // never read: no bill here has an estimate
}

/** One stored bill as the engine reads it (D55): an unknown date is `today`, an unknown amount is its estimate or, with no history, 0 and `uncounted`. */
function resolveOne(bill: StoredBill, today: string, unit: number, bills: StoredBill[], real: Map<string, RealBill[]>): Bill {
  if (bill.amount !== null && bill.due !== null) return bill as Bill;
  const due = bill.due ?? today;
  const date = bill.due === null ? { dueUnknown: true as const } : {};
  if (bill.amount !== null) return { ...bill, amount: bill.amount, due, ...date };
  // A repeating series has no amount of its own: its occurrences are estimated one by one (`expandBills`).
  if (bill.repeatUnit !== undefined) return { ...bill, amount: 0, due, amountUnknown: true, uncounted: true, ...date };
  const seriesId = bill.seriesBillId ?? (bill.amountVaries ? bill.id : undefined);
  const history = seriesId !== undefined ? real.get(seriesId) ?? [] : nameHistory(bills, bill.biller, bill.category, unit);
  return { ...bill, due, ...date, amountUnknown: true, ...estimatedFields(gapEstimate(history, bill.due), unit, seriesId !== undefined ? "series" : "bills") };
}

/**
 * Stored bills as the engine reads them without expanding repeating ones: a bill whose amount or date is not known gets its estimate,
 * or `uncounted`, and today as its date (`resolveOne`). `currency` is needed exactly when a bill's amount is not known.
 */
export function resolveBills(bills: StoredBill[], today: string, currency?: Currency): Bill[] {
  const unit = estimateUnit(bills, currency);
  const real = realBillsBySeries(bills, unit);
  return bills.map(bill => resolveOne(bill, today, unit, bills, real));
}

/** Earlier one-offs can estimate a new series before it has a real bill of its own. */
function unlinkedHistory(bills: StoredBill[], bill: StoredBill, unit: number) {
  const start = bill.due;
  if (start === null) return [];
  const earlier = bills.filter(row => row.seriesBillId === undefined && row.due !== null && row.due < start);
  return nameHistory(earlier, bill.biller, bill.category, unit);
}

/**
 * Turns stored bills into the bills the engine reads. A confirmed bill that repeats becomes one bill per occurrence, each
 * with the id `<id>@<date>` so keys stay unique, the amount that applies on its date, and `startsOn` the stored due date.
 * Anything else (one-off, or pending: it never repeats until confirmed) passes through unchanged.
 * An amount-varies monthly bill (D54) has no occurrence in a month that holds one of its real bills (the real bill, a one-off
 * here, is the month's amount, counted once on its own date); every other occurrence is `estimated` at `variesEstimate`.
 * A bill whose amount or date is not known (D55) is resolved by `resolveOne`: the same rule for a one-off, and for an amount-varies
 * series without an amount of its own each occurrence is estimated from earlier linked bills or matching one-offs, if available.
 * `currency` (the home currency) is needed exactly when there is such a bill: the estimate is rounded to its minor unit.
 */
export function expandBills(bills: StoredBill[], today: string, through: string, currency?: Currency): Bill[] {
  const unit = estimateUnit(bills, currency);
  const real = realBillsBySeries(bills, unit);
  const unpriced = unpricedBySeries(bills);
  const expanded = bills.flatMap((bill): Bill[] => {
    if (bill.repeatUnit === undefined || bill.status !== "confirmed") return [resolveOne(bill, today, unit, bills, real)];
    if (bill.due === null) throw new Error("A repeating bill has its date");
    const series = { startsOn: bill.due, ...(bill.amount === null ? {} : { startAmount: bill.amount }) };
    if (bill.amountVaries) {
      const history = real.get(bill.id) ?? [];
      const older = bill.amount === null ? unlinkedHistory(bills, bill, unit) : [];
      return variesOccurrences({ due: bill.due, repeatDay: bill.repeatDay ?? null, storedMinor: bill.amount === null ? null : Math.round(bill.amount * unit), until: bill.repeatUntil ?? null }, history, today, through, unpriced.get(bill.id) ?? [])
        .map(({ date, amountMinor }) => {
          const occurrence = { ...bill, id: `${bill.id}@${date}`, due: date, ...series };
          if (bill.amount !== null) return { ...occurrence, amount: amountMinor! / unit, estimated: true as const };
          const linked = gapEstimate(history, date);
          return { ...occurrence, amountUnknown: true as const,
            ...estimatedFields(linked ?? gapEstimate(older, date), unit, linked ? "series" : "bills") };
        });
    }
    if (bill.amount === null) throw new Error("A repeating bill with a fixed amount has its amount");
    const fixed = bill.amount;
    const next = nextAmountOf(bill);
    return datesIn({ ...bill, due: bill.due }, today, through)
      .map(due => ({ ...bill, id: `${bill.id}@${due}`, due, amount: amountOn(fixed, next, due), startsOn: bill.due!, startAmount: fixed }));
  });
  // The order the database gives stored bills: due date, then biller.
  return expanded.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}

/**
 * The cancel-by rows of Coming up (D48): for each confirmed stored bill with a cancel-by date from `today` on, the date, and the
 * first occurrence after it with the amount that applies then (the renewal; for an amount-varies bill its estimate, D54, which
 * needs `currency` as `expandBills` does; null when the amount is not known and there is nothing to estimate it from, D55).
 * Information only; sorted by cancel-by date.
 */
export function cancelNotices(bills: StoredBill[], today: string, currency?: Currency): CancelNotice[] {
  const unit = estimateUnit(bills, currency);
  const real = realBillsBySeries(bills, unit);
  const notices: CancelNotice[] = [];
  for (const bill of bills) {
    if (bill.status !== "confirmed" || bill.cancelBy === undefined || bill.cancelBy < today || bill.due === null) continue;
    const dated = { ...bill, due: bill.due };
    const renewsOn = nextOccurrenceAfter(dated, bill.cancelBy); // null after the last payment (D41): no notice
    if (renewsOn === null) continue;
    const next = nextAmountOf(bill);
    let amount: number | null;
    if (bill.amountVaries) {
      const estimate = gapEstimate(real.get(bill.id) ?? [], renewsOn)?.averageMinor
        ?? (bill.amount === null ? gapEstimate(unlinkedHistory(bills, bill, unit), renewsOn)?.averageMinor ?? null : Math.round(bill.amount * unit));
      amount = estimate === null ? null : estimate / unit;
    } else if (bill.amount === null) {
      const resolved = resolveOne(bill, today, unit, bills, real);
      amount = resolved.uncounted ? null : resolved.amount;
    } else amount = amountOn(bill.amount, next, renewsOn);
    notices.push({ billId: bill.id, biller: bill.biller, category: bill.category, cancelBy: bill.cancelBy, renewsOn, amount, repeats: bill.repeatUnit !== undefined });
  }
  return notices.sort((a, b) => (a.cancelBy < b.cancelBy ? -1 : a.cancelBy > b.cancelBy ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
}
