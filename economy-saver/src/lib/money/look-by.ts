// Spending's This month and Over time (D73, D74): one month looked at three ways, from the same items (the month's confirmed bills and charges), and the months side by side.
// Pure: the screen only draws these rows. Amounts are integer minor units of the home currency.
import { businessPart } from "./categories";
import { plural } from "./format";
import { businessLine, monthByCategory, monthWhen } from "./month";
import { monthBounds, monthLabel, monthsBack, spendingItems, type SpendingInput } from "./spending";

export type LookBy = "category" | "business" | "person";
export type DisplayMode = "chart" | "table";

/** One bar. `business` and `personal` add up to `total`; `spent` is dated on or before today, `coming` is a later bill. */
export type LookRow = {
  key: string; label: string; note: string;
  spent: number; coming: number; total: number; previous: number;
  business: number; personal: number;
  unknown: boolean;
  /** D75, Category only: one row per own category with items this month or last month (largest first), then "Everything else in <category>"; they add up to this row in both months. Absent when the category has none. */
  children?: LookRow[];
};
export type LookByView = {
  by: LookBy;
  rows: LookRow[];
  spent: number; coming: number; total: number;
  name: string; lastName: string; lastTotal: number;
  businessMinor: number; personalMinor: number; businessLine: string;
};
export type LookMember = { id: string; name: string };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const noteFor = (count: number, unknown: boolean) => unknown ? "an amount is not known" : plural(count, "item");

/** The rows for a month (default: the one `today` is in; any earlier month has nothing still to come) and a choice. `person` needs two or more members; with fewer it gives the category rows. */
export function lookBy(input: SpendingInput, today: string, by: LookBy, members: LookMember[], month: string = today.slice(0, 7)): LookByView {
  const previous = monthsBack(month, 2);
  const current = monthByCategory(input, today, month), last = monthByCategory(input, today, previous);
  const { first, last: end } = monthBounds(month);
  const items = spendingItems(input, first, end);
  const split = (matches: typeof items) => {
    const spent = sum(matches.filter(item => item.date <= today).map(item => item.amountMinor));
    const coming = sum(matches.filter(item => item.date > today && item.kind === "bill").map(item => item.amountMinor));
    const business = sum(matches.map(item => businessPart(item.amountMinor, item.businessBp)));
    const amount = sum(matches.map(item => item.amountMinor));
    return { spent, coming, total: spent + coming, business, personal: amount - business, unknown: matches.some(item => item.uncounted), count: matches.length };
  };

  const rowOf = (key: string, label: string, matches: typeof items, previousAmount: number): LookRow => {
    const part = split(matches);
    return { key, label, note: noteFor(part.count, part.unknown), spent: part.spent, coming: part.coming, total: part.total, previous: previousAmount, business: part.business, personal: part.personal, unknown: part.unknown };
  };
  // D75: the own categories of one category, this month and last, then what has none.
  const childrenOf = (category: (typeof current.categories)[number], matches: typeof items, lastCategory: (typeof last.categories)[number] | undefined): LookRow[] | undefined => {
    const lastOwn = lastCategory?.ownCategories ?? [];
    const names = new Map<string, string>();
    for (const own of [...lastOwn, ...category.ownCategories]) if (own.id !== null) names.set(own.id, own.name!);
    if (names.size === 0) return undefined;
    const kids = [...names].map(([id, name]) => rowOf(`${category.category}:${id}`, name, matches.filter(item => item.own?.id === id), lastOwn.find(own => own.id === id)?.totalMinor ?? 0));
    kids.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    const restItems = matches.filter(item => !item.own);
    const restPrevious = (lastCategory?.totalMinor ?? 0) - sum(lastOwn.map(own => own.totalMinor));
    if (restItems.length > 0 || restPrevious !== 0) kids.push(rowOf(`${category.category}:rest`, `Everything else in ${category.label}`, restItems, restPrevious));
    return kids;
  };

  const categoryRows = current.categories.map((category): LookRow => {
    const matches = items.filter(item => item.category === category.category);
    const lastCategory = last.categories.find(item => item.category === category.category);
    const children = childrenOf(category, matches, lastCategory);
    return { ...rowOf(category.category, category.label, matches, lastCategory?.totalMinor ?? 0), ...(children ? { children } : {}) };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  let rows = categoryRows, effective = by;
  if (by === "business") rows = categoryRows.map(({ children, ...row }) => { void children; return row; });
  if (by === "person" && members.length < 2) effective = "category";
  if (effective === "person") {
    const owners: { key: string; label: string; ownerId: string | null; previous: number }[] = [
      ...members.map(member => ({ key: member.id, label: member.name, ownerId: member.id as string | null, previous: last.byMember.find(m => m.id === member.id)?.minor ?? 0 })),
      { key: "shared", label: "Shared", ownerId: null, previous: last.sharedMinor },
    ];
    rows = owners.map((owner): LookRow => {
      const part = split(items.filter(item => item.ownerId === owner.ownerId));
      return { key: owner.key, label: owner.label, note: noteFor(part.count, part.unknown), spent: part.spent, coming: part.coming, total: part.total, previous: owner.previous, business: part.business, personal: part.personal, unknown: part.unknown };
    }).filter(row => row.total !== 0 || row.previous !== 0 || row.unknown);
  }
  const spent = sum(rows.map(row => row.spent)), coming = sum(rows.map(row => row.coming));
  return {
    by: effective, rows, spent, coming, total: spent + coming, name: current.name, lastName: last.name, lastTotal: last.totalMinor,
    businessMinor: current.businessMinor, personalMinor: current.personalMinor, businessLine: businessLine(current, monthWhen(month === today.slice(0, 7) ? undefined : monthLabel(month, today))),
  };
}

/** One column of Over time: what was spent by the end of `today` and, for the current month only, the bills still to come. */
export type TrendMonth = { month: string; name: string; spent: number; coming: number; total: number; current: boolean; unknown: boolean; biggest: { label: string; amount: number } | null };

/** The last six months, oldest first, leaving out empty past months (the current month always stays). */
export function monthTrend(input: SpendingInput, today: string): TrendMonth[] {
  const month = today.slice(0, 7);
  return Array.from({ length: 6 }, (_, index) => monthsBack(month, 6 - index)).map(date => {
    const bounds = monthBounds(date), entries = spendingItems(input, bounds.first, bounds.last);
    const spent = sum(entries.filter(item => item.date <= today).map(item => item.amountMinor));
    const coming = date === month ? sum(entries.filter(item => item.date > today && item.kind === "bill").map(item => item.amountMinor)) : 0;
    const biggest = entries.filter(item => !item.uncounted && (item.kind === "charge" || item.repeat === null)).sort((a, b) => b.amountMinor - a.amountMinor)[0];
    return { month: date, name: monthByCategory(input, today, date).name, spent, coming, total: spent + coming, current: date === month, hasItems: entries.length > 0, unknown: entries.some(item => item.uncounted), biggest: biggest ? { label: biggest.label, amount: biggest.amountMinor } : null };
  }).filter(entry => entry.hasItems || entry.current).map(({ hasItems, ...entry }) => { void hasItems; return entry; });
}

/** The remembered choices on this device, "<This month: chart|table>|<look at it by>|<Over time: chart|table>". Person without two people reads as Category; anything missing reads as chart and Category. */
export function parseSpendingView(stored: string, memberCount: number): { mode: DisplayMode; by: LookBy; trendMode: DisplayMode } {
  const [rawMode, rawBy, rawTrend] = stored.split("|");
  const by: LookBy = rawBy === "business" ? "business" : rawBy === "person" && memberCount >= 2 ? "person" : "category";
  return { mode: rawMode === "table" ? "table" : "chart", by, trendMode: rawTrend === "table" ? "table" : "chart" };
}
export const formatSpendingView = (mode: DisplayMode, by: LookBy, trendMode: DisplayMode) => `${mode}|${by}|${trendMode}`;

/** Home's remembered Chart or Table. An earlier value, "<view>|<mode>|<by>", still reads as its mode. */
export function parseHomeMode(stored: string): DisplayMode {
  const parts = stored.split("|");
  return (parts[1] ?? parts[0]) === "table" ? "table" : "chart";
}
