// Where the month goes (D46). Pure: one calendar month (the household's current one unless asked for another), grouped by category, each amount split into
// its business and personal parts. Reads bills and charges only; it moves no money and nothing in the runway reads it.
// Amounts are integer minor units of the home currency (whole yen, cents for USD).
import type { Currency } from "@/lib/catalogue/types";
import { aboutMoney, dayLabel, minorMoney } from "./format";
import { businessPart, CATEGORIES, categoryLabel, type CategoryKey } from "./categories";
import { monthBounds, monthName, spendingItems, type SpendingInput } from "./spending";

/** D52: whose an item is: a member's id, or null for Shared (a bill with no owner, a charge marked shared or on a card nobody owns). */
export type MonthItem = { label: string; date: string; amountMinor: number; businessBp: number; ownerId: string | null; estimated?: true };
/** D52: a total split by whose it is. `byMember` has one entry per household member, in member order. */
export type WhoseTotals = { sharedMinor: number; byMember: { id: string; minor: number }[] };
export type MonthCategory = {
  category: CategoryKey;
  label: string;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  items: MonthItem[];
} & WhoseTotals;
export type MonthView = {
  month: string; // YYYY-MM
  name: string; // "November"
  currency: Currency;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  categories: MonthCategory[]; // categories.ts order, only the ones with items
} & WhoseTotals;

function whoseTotals(memberIds: string[], items: MonthItem[]): WhoseTotals {
  const sum = (ownerId: string | null) => items.filter(i => i.ownerId === ownerId).reduce((total, i) => total + i.amountMinor, 0);
  return { sharedMinor: sum(null), byMember: memberIds.map(id => ({ id, minor: sum(id) })) };
}

/**
 * Confirmed bills due in the month (a repeating bill once, at its occurrence) and confirmed card charges dated in it, in the home
 * currency, grouped by category: `spendingItems` over the month (D53), so the search and this view share one rule. `month` is
 * YYYY-MM and defaults to the month `today` is in. Statements and pending rows are left out; so are charges and bills of other months.
 */
export function monthByCategory(state: SpendingInput, today: string, month: string = today.slice(0, 7)): MonthView {
  const { first, last } = monthBounds(month);
  const memberIds = state.split.members.map(m => m.id);
  const entries = spendingItems(state, first, last);

  const categories: MonthCategory[] = [];
  for (const { key } of CATEGORIES) {
    const items = entries.filter(e => e.category === key)
      .map(({ label, date, amountMinor, businessBp, ownerId, estimated }): MonthItem => ({ label, date, amountMinor, businessBp, ownerId, ...(estimated ? { estimated } : {}) }));
    if (!items.length) continue;
    const totalMinor = items.reduce((sum, i) => sum + i.amountMinor, 0);
    const businessMinor = items.reduce((sum, i) => sum + businessPart(i.amountMinor, i.businessBp), 0);
    categories.push({ category: key, label: categoryLabel(key), totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, items, ...whoseTotals(memberIds, items) });
  }
  const totalMinor = categories.reduce((sum, c) => sum + c.totalMinor, 0);
  const businessMinor = categories.reduce((sum, c) => sum + c.businessMinor, 0);
  return {
    ...whoseTotals(memberIds, categories.flatMap(c => c.items)),
    month, name: monthName(month), currency: state.homeCurrency,
    totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, categories,
  };
}

const money = (view: MonthView, minor: number) => minorMoney(minor, view.currency);

/** The one wording for when a month view is about: "this month" for the household's current month, "in October" for a past one (`past` is the name to show). */
export function monthWhen(past?: string): string {
  return past === undefined ? "this month" : `in ${past}`;
}

/** The one line at the top of Where the month goes: "Business ¥32,830 of ¥152,230 this month" ("in October" for a past month), or "All personal this month" when nothing has a business share. */
export function businessLine(view: MonthView, when = monthWhen()): string {
  if (view.businessMinor === 0) return `All personal ${when}`;
  return `Business ${money(view, view.businessMinor)} of ${money(view, view.totalMinor)} ${when}`;
}

/** How a row says its split: just the total when everything is one kind, otherwise the two parts. */
export function splitLine(view: MonthView, part: { totalMinor: number; businessMinor: number; personalMinor: number }): string | null {
  if (part.businessMinor === 0 || part.personalMinor === 0) return null;
  return `business ${money(view, part.businessMinor)} · personal ${money(view, part.personalMinor)}`;
}

/** The month as text the agent can quote; built here so the screen and the agent say the same numbers. */
export function monthText(view: MonthView, when = monthWhen()): string {
  if (!view.categories.length) return `${view.name}: nothing confirmed ${when === monthWhen() ? "yet " : ""}${when}.`;
  const lines = [`${view.name}: ${money(view, view.totalMinor)} in total. ${businessLine(view, when)}.`];
  for (const c of view.categories) {
    const split = splitLine(view, c);
    lines.push(`${c.label} ${money(view, c.totalMinor)}${split ? ` (${split})` : c.businessMinor ? " (all business)" : ""}: ${c.items.map(i =>
      `${i.label} ${dayLabel(i.date)} ${i.estimated ? aboutMoney(i.amountMinor, view.currency) : money(view, i.amountMinor)}${i.businessBp > 0 && i.businessBp < 10_000 ? ` at ${i.businessBp / 100}% business` : ""}`).join("; ")}.`);
  }
  return lines.join("\n");
}
