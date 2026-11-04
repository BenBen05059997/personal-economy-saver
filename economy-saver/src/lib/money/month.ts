// Where the month goes (D46). Pure: the household's current calendar month, grouped by category, each amount split into
// its business and personal parts. Reads bills and charges only; it moves no money and nothing in the runway reads it.
// Amounts are integer minor units of the home currency (whole yen, cents for USD).
import type { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney } from "./format";
import { businessPart, CATEGORIES, categoryLabel, type CategoryKey } from "./categories";
import { amountOn, occurrenceDates } from "./repeat";
import type { MoneyState } from "./types";

export type MonthItem = { label: string; date: string; amountMinor: number; businessBp: number };
export type MonthCategory = {
  category: CategoryKey;
  label: string;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  items: MonthItem[];
};
export type MonthView = {
  month: string; // YYYY-MM
  name: string; // "November"
  currency: Currency;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  categories: MonthCategory[]; // categories.ts order, only the ones with items
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The first and last day of the month `today` is in. */
function monthBounds(today: string): { first: string; last: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first: `${today.slice(0, 7)}-01`, last: `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Confirmed bills due in the month (a repeating bill once, at its occurrence) and confirmed card charges dated in it, in the home
 * currency, grouped by category. Statements and pending rows are left out; so are charges and bills of other months.
 */
export function monthByCategory(state: MoneyState, today: string): MonthView {
  const { first, last } = monthBounds(today);
  const unit = state.homeCurrency === "USD" ? 100 : 1;
  const minor = (amount: number) => Math.round(amount * unit);
  const entries: { category: CategoryKey; item: MonthItem }[] = [];

  const seenSeries = new Set<string>();
  for (const bill of state.bills) {
    if (bill.status !== "confirmed") continue;
    const base = { category: bill.category };
    const next = bill.nextAmount !== undefined && bill.nextAmountFrom !== undefined ? { amount: bill.nextAmount, from: bill.nextAmountFrom } : null;
    const item = (date: string): MonthItem => ({ label: bill.biller, date, amountMinor: minor(amountOn(bill.startAmount ?? bill.amount, next, date)), businessBp: bill.businessBp });
    if (bill.repeatUnit === undefined || bill.startsOn === undefined || bill.startAmount === undefined) {
      if (bill.due >= first && bill.due <= last) entries.push({ ...base, item: item(bill.due) });
      continue;
    }
    // A repeating bill is one series of occurrences (`<id>@<date>`); the month holds at most one of them, at the amount that applies on its date.
    const series = bill.id.slice(0, bill.id.indexOf("@"));
    if (seenSeries.has(series)) continue;
    seenSeries.add(series);
    for (const date of occurrenceDates(bill.startsOn, bill.repeatUnit, bill.repeatDay ?? null, first, last)) entries.push({ ...base, item: item(date) });
  }
  for (const charge of state.charges) {
    if (charge.status !== "confirmed" || charge.date < first || charge.date > last) continue;
    entries.push({ category: charge.category, item: { label: charge.merchant, date: charge.date, amountMinor: minor(charge.amount), businessBp: charge.businessBp } });
  }

  const categories: MonthCategory[] = [];
  for (const { key } of CATEGORIES) {
    const items = entries.filter(e => e.category === key).map(e => e.item).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    if (!items.length) continue;
    const totalMinor = items.reduce((sum, i) => sum + i.amountMinor, 0);
    const businessMinor = items.reduce((sum, i) => sum + businessPart(i.amountMinor, i.businessBp), 0);
    categories.push({ category: key, label: categoryLabel(key), totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, items });
  }
  const totalMinor = categories.reduce((sum, c) => sum + c.totalMinor, 0);
  const businessMinor = categories.reduce((sum, c) => sum + c.businessMinor, 0);
  return {
    month: today.slice(0, 7), name: MONTH_NAMES[Number(today.slice(5, 7)) - 1], currency: state.homeCurrency,
    totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, categories,
  };
}

const money = (view: MonthView, minor: number) => minorMoney(minor, view.currency);

/** The one line at the top of Where the month goes: "Business ¥32,830 of ¥152,230 this month", or "All personal this month" when nothing has a business share. */
export function businessLine(view: MonthView): string {
  if (view.businessMinor === 0) return "All personal this month";
  return `Business ${money(view, view.businessMinor)} of ${money(view, view.totalMinor)} this month`;
}

/** How a row says its split: just the total when everything is one kind, otherwise the two parts. */
export function splitLine(view: MonthView, part: { totalMinor: number; businessMinor: number; personalMinor: number }): string | null {
  if (part.businessMinor === 0 || part.personalMinor === 0) return null;
  return `business ${money(view, part.businessMinor)} · personal ${money(view, part.personalMinor)}`;
}

/** The month as text the agent can quote; built here so the screen and the agent say the same numbers. */
export function monthText(view: MonthView): string {
  if (!view.categories.length) return `${view.name}: nothing confirmed yet this month.`;
  const lines = [`${view.name}: ${money(view, view.totalMinor)} in total. ${businessLine(view)}.`];
  for (const c of view.categories) {
    const split = splitLine(view, c);
    lines.push(`${c.label} ${money(view, c.totalMinor)}${split ? ` (${split})` : c.businessMinor ? " (all business)" : ""}: ${c.items.map(i =>
      `${i.label} ${dayLabel(i.date)} ${money(view, i.amountMinor)}${i.businessBp > 0 && i.businessBp < 10_000 ? ` at ${i.businessBp / 100}% business` : ""}`).join("; ")}.`);
  }
  return lines.join("\n");
}
