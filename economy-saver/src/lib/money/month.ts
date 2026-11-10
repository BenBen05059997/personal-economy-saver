// Where the month goes (D46). Pure: one calendar month (the household's current one unless asked for another), grouped by category, each amount split into
// its business and personal parts. Reads bills and charges only; it moves no money and nothing in the runway reads it.
// Amounts are integer minor units of the home currency (whole yen, cents for USD).
import type { Currency } from "@/lib/catalogue/types";
import { aboutMoney, dayLabel, minorMoney } from "./format";
import { AMOUNT_NOT_KNOWN } from "./gaps";
import { periodLabel } from "./period";
import { businessPart, CATEGORIES, categoryLabel, type CategoryKey } from "./categories";
import { ownLabel } from "./own-category";
import { allUncounted, monthBounds, monthName, spendingItems, type SpendingInput } from "./spending";

/** D52: whose an item is: a member's id, or null for Shared (a bill with no owner, a charge marked shared or on a card nobody owns). */
export type MonthItem = { label: string; date: string; amountMinor: number; businessBp: number; own: { id: string; name: string } | null /* D75 */; ownerId: string | null; periodStart?: string; periodEnd?: string /* 27F: the period a one-off bill covers */; estimated?: true; uncounted?: true /* D55: amount not known: amountMinor is 0 and means nothing */ };
/** D52: a total split by whose it is. `byMember` has one entry per household member, in member order. */
export type WhoseTotals = { sharedMinor: number; byMember: { id: string; minor: number }[] };
/** D75: the items of one category filed under one own category (or, with `id` and `name` null, under none), summed like a category. */
export type MonthOwn = {
  id: string | null;
  name: string | null;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  items: MonthItem[];
} & WhoseTotals;
export type MonthCategory = {
  category: CategoryKey;
  label: string;
  totalMinor: number;
  businessMinor: number;
  personalMinor: number;
  items: MonthItem[];
  /** D75: the own categories with items this month, largest first then by name; empty when no item of this category is filed under one. */
  ownCategories: MonthOwn[];
  /** D75: what is left without an own category ("Everything else in Food"); null unless `ownCategories` is not empty and some item has none. */
  withoutOwn: MonthOwn | null;
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

function ownGroup(memberIds: string[], own: { id: string; name: string } | null, items: MonthItem[]): MonthOwn {
  const totalMinor = items.reduce((sum, i) => sum + i.amountMinor, 0);
  const businessMinor = items.reduce((sum, i) => sum + businessPart(i.amountMinor, i.businessBp), 0);
  return { id: own?.id ?? null, name: own?.name ?? null, totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, items, ...whoseTotals(memberIds, items) };
}

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
      .map(({ label, date, amountMinor, businessBp, own, ownerId, estimated, uncounted, periodStart, periodEnd }): MonthItem => ({ label, date, amountMinor, businessBp, own, ownerId, ...(estimated ? { estimated } : {}), ...(uncounted ? { uncounted } : {}), ...(periodStart !== undefined && periodEnd !== undefined ? { periodStart, periodEnd } : {}) }));
    if (!items.length) continue;
    const totalMinor = items.reduce((sum, i) => sum + i.amountMinor, 0);
    const businessMinor = items.reduce((sum, i) => sum + businessPart(i.amountMinor, i.businessBp), 0);
    const filed = new Map<string, { id: string; name: string }>();
    for (const i of items) if (i.own) filed.set(i.own.id, i.own);
    const ownCategories = [...filed.values()].map(own => ownGroup(memberIds, own, items.filter(i => i.own?.id === own.id)))
      .sort((a, b) => b.totalMinor - a.totalMinor || a.name!.localeCompare(b.name!) || a.id!.localeCompare(b.id!));
    const rest = items.filter(i => !i.own);
    categories.push({ category: key, label: categoryLabel(key), totalMinor, businessMinor, personalMinor: totalMinor - businessMinor, items, ownCategories,
      withoutOwn: ownCategories.length > 0 && rest.length > 0 ? ownGroup(memberIds, null, rest) : null, ...whoseTotals(memberIds, items) });
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
    lines.push(`${c.label} ${allUncounted(c.items) ? AMOUNT_NOT_KNOWN : money(view, c.totalMinor)}${split ? ` (${split})` : c.businessMinor ? " (all business)" : ""}: ${c.items.map(i =>
      `${i.label}${i.periodStart !== undefined && i.periodEnd !== undefined ? ` (for ${periodLabel({ start: i.periodStart, end: i.periodEnd })})` : ""} ${dayLabel(i.date)} ${i.uncounted ? AMOUNT_NOT_KNOWN : i.estimated ? aboutMoney(i.amountMinor, view.currency) : money(view, i.amountMinor)}${i.businessBp > 0 && i.businessBp < 10_000 ? ` at ${i.businessBp / 100}% business` : ""}`).join("; ")}.`);
    if (c.ownCategories.length > 0) {
      const part = (o: MonthOwn, name: string) => `${name} ${allUncounted(o.items) ? AMOUNT_NOT_KNOWN : money(view, o.totalMinor)}`;
      lines.push(`In ${c.label}: ${[...c.ownCategories.map(o => part(o, ownLabel(c.category, { name: o.name! }))), ...(c.withoutOwn ? [part(c.withoutOwn, `${c.label} without a category of your own`)] : [])].join("; ")}.`);
    }
  }
  return lines.join("\n");
}
