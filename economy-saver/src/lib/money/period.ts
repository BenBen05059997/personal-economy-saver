// The month a bill covers (27F). Pure. A bill's due date is its time identity and the only date the money counts by; its period
// ("11月分", "Service period Oct 1 – Oct 31") is information: it says what the bill is for, so "November's electricity" can be found.
import type { Currency } from "@/lib/catalogue/types";
import type { CategoryKey } from "./categories";
import { dayLabel, minorMoney, ordinal } from "./format";
import { AMOUNT_NOT_KNOWN } from "./gaps";
import { normalise } from "./name-key";
import { monthBounds, monthName } from "./spending";

export type Period = { start: string; end: string };

/** What is wrong with a period, in words; null when it is fine. Both dates or neither, the start on or before the end. */
export function periodProblem(start: string | null | undefined, end: string | null | undefined): string | null {
  if ((start === null || start === undefined) !== (end === null || end === undefined)) return "Give both the first and the last day of the period, or neither.";
  if (start && end && start > end) return "The period must start on or before its last day.";
  return null;
}

/** "11月分" for a period that is exactly one calendar month, else "Oct 5 – Nov 4" (with the year when the two ends are in different years). */
export function periodLabel(period: Period): string {
  const month = period.start.slice(0, 7);
  const { first, last } = monthBounds(month);
  if (period.start === first && period.end === last) return `${Number(month.slice(5, 7))}月分`;
  const year = (iso: string) => (iso.slice(0, 4) === period.start.slice(0, 4) && period.end.slice(0, 4) === period.start.slice(0, 4) ? "" : `, ${iso.slice(0, 4)}`);
  return `${dayLabel(period.start)}${year(period.start)} – ${dayLabel(period.end)}${year(period.end)}`;
}

/** The first day of the month after `iso`. */
const nextMonth = (iso: string) => {
  const year = Number(iso.slice(0, 4)), month = Number(iso.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};

/**
 * The due date to propose for a bill that shows the period it covers and no due date: the household's usual due day for that
 * biller in the month after the period ends, else the last day of that month. It is an estimate: the caller marks it as one and
 * shows `basis`, and the person confirms it or types the day. A usual day the month does not have (the 31st in November) falls on
 * the month's last day.
 */
export function estimatedDue(period: Period, usualDay: number | null): { date: string; basis: string } {
  const month = nextMonth(period.end);
  const { last } = monthBounds(month);
  const lastDay = Number(last.slice(8, 10));
  const label = periodLabel(period);
  if (usualDay === null) return { date: last, basis: `Estimated from ${label}: no usual day is known, so the last day of the next month` };
  const day = Math.min(usualDay, lastDay);
  return { date: `${month}-${String(day).padStart(2, "0")}`, basis: `Estimated from ${label}: usually paid on the ${ordinal(usualDay)}` };
}

// ---------------------------------------------------------------- "What was November's electricity?"

/** A stored one-off bill that carries a period, as it is stored: its own currency, its amount or null when not known (D55). */
export type PeriodBill = {
  id: string; biller: string; amountMinor: number | null; currency: Currency; due: string | null;
  periodStart: string; periodEnd: string; status: "confirmed" | "pending"; category: CategoryKey;
};
export type PeriodItem = PeriodBill & { periodLabel: string };
export type BillsForMonth = {
  month: string; // YYYY-MM
  text: string; // as searched: NFKC, lower case, trimmed; "" = every bill
  items: PeriodItem[]; // by due date (not known last), then name
  totals: { currency: Currency; totalMinor: number; count: number }[]; // known amounts only, one row per currency
  summary: string;
  note: string;
};

/** Where counting stays (D63): a bill with no period is counted by its due date, which is what month_by_category reads. */
export const NO_PERIOD_NOTE = "Only bills that name the month they are for are listed here. A bill with no period is counted by its due or paid date: use month_by_category for the month money was paid.";

/** True when the bill's period shares at least one day with the month (YYYY-MM). */
export const periodOverlaps = (period: Period, month: string): boolean => {
  const { first, last } = monthBounds(month);
  return period.start <= last && period.end >= first;
};

/**
 * Every stored bill whose period overlaps `month`, confirmed or waiting, past or future, optionally narrowed by name (each word of
 * `text` must be in the biller's name, the same normaliser as the spending search). Information only: it moves no money and the
 * forecast never reads it. A bill whose amount is not known is listed as such and never summed (D55).
 */
export function billsForMonth(bills: readonly PeriodBill[], month: string, text = ""): BillsForMonth {
  const q = normalise(text);
  const terms = q.split(/\s+/).filter(Boolean);
  const items = bills
    .filter(bill => periodOverlaps({ start: bill.periodStart, end: bill.periodEnd }, month) && terms.every(term => normalise(bill.biller).includes(term)))
    .map((bill): PeriodItem => ({ ...bill, periodLabel: periodLabel({ start: bill.periodStart, end: bill.periodEnd }) }))
    .sort((a, b) => (a.due ?? "9999") < (b.due ?? "9999") ? -1 : (a.due ?? "9999") > (b.due ?? "9999") ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : a.id < b.id ? -1 : 1);
  const totals: BillsForMonth["totals"] = [];
  for (const item of items) {
    if (item.amountMinor === null) continue;
    const row = totals.find(t => t.currency === item.currency);
    if (row) { row.totalMinor += item.amountMinor; row.count += 1; } else totals.push({ currency: item.currency, totalMinor: item.amountMinor, count: 1 });
  }
  const when = `${monthName(month)} ${month.slice(0, 4)}`;
  const line = (item: PeriodItem) => `${item.biller} (${item.periodLabel}): ${item.amountMinor === null ? AMOUNT_NOT_KNOWN : minorMoney(item.amountMinor, item.currency)}, ${item.due === null ? "due date not known" : `due ${dayLabel(item.due)}`}${item.status === "pending" ? ", waiting in To check" : ""}`;
  const known = totals.map(t => `${minorMoney(t.totalMinor, t.currency)} in all`).join(", ");
  const summary = items.length === 0
    ? `No bill names ${when} as the month it is for${q === "" ? "" : ` and matches "${q}"`}.`
    : `${items.length} ${items.length === 1 ? "bill" : "bills"} for ${when}${known ? `, ${known}` : ""}: ${items.map(line).join("; ")}.`;
  return { month, text: q, items, totals, summary, note: NO_PERIOD_NOTE };
}
