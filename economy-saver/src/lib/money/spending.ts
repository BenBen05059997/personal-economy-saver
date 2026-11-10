// Where did the money go (D53). Pure: one rule for what a household spent in a date range, from the bills and charges it
// already stores, used by the month view (D46), the search over months and the assistant's tools. Reads bills and charges
// only; it moves no money and nothing in the runway reads it. Amounts are integer minor units of the home currency.
import type { Currency } from "@/lib/catalogue/types";
import { minorMoney, minorPerUnit } from "./format";
import { AMOUNT_NOT_KNOWN, gapUncountedWords } from "./gaps";
import { CATEGORIES, categoryLabel, type CategoryKey } from "./categories";
import { ownLabel } from "./own-category";
import { nameKey, normalise } from "./name-key";
import { amountOn, datesIn, nextAmountOf, realBillsBySeries, unpricedBySeries, variesOccurrences } from "./repeat";
import type { Bill, Card, Charge, RepeatUnit, SplitMember } from "./types";

export { nameKey, normalise };

/** D55: true when there are items and none of them has a known amount: a total of them is not ¥0, it is not known. */
export const allUncounted = (items: readonly { uncounted?: true }[]): boolean => items.length > 0 && items.every(item => item.uncounted);

/** One confirmed bill occurrence or card charge. `id` is the stored row's id (a repeating bill's occurrences share it; id and date are unique). */
export type SpendItem = {
  kind: "bill" | "charge";
  id: string;
  label: string;
  repeat: RepeatUnit | null; // D48: the bill's repeat unit; null for a one-off bill and for every charge
  date: string; // YYYY-MM-DD
  amountMinor: number;
  category: CategoryKey;
  businessBp: number;
  own: { id: string; name: string } | null; // D75: the person's own category under `category`, or none
  ownerId: string | null; // D52: a member's id, or null for Shared
  documentId: string | null;
  cardId: string | null;
  periodStart?: string; // 27F: a one-off bill's period ("11月分" = Nov 1 to Nov 30); items still count by `date`, the day it is paid
  periodEnd?: string;
  estimated?: true; // D54, D55: an amount-varies bill in a month without its real bill, or a bill whose amount is not known and was estimated: the amount is the estimate
  uncounted?: true; // D55: a bill whose amount is not known and has nothing to estimate it from: `amountMinor` is 0 and means nothing; say "amount not known", never ¥0
};

/**
 * What the rule reads. `bills` may be the stored rows (a repeating bill once, its series starting at `due`) or the engine's
 * occurrences (`startsOn` set, ids `<id>@<date>`); either way a series counts once per occurrence in the range.
 */
export type SpendingInput = {
  homeCurrency: Currency;
  bills: (Bill & { documentId?: string })[];
  charges: (Charge & { documentId?: string })[];
  cards: Pick<Card, "id" | "ownerId">[];
  split: { members: Pick<SplitMember, "id">[] };
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** How far back Plan's month view and the search reach (D53): this many calendar months, the current one included. */
export const HISTORY_MONTHS = 12;
/** The longest search the box or the assistant takes, in characters. */
export const SEARCH_QUERY_MAX = 80;

/** "November" for "2026-11". */
export function monthName(month: string): string {
  if (!MONTH.test(month)) throw new Error(`A month is YYYY-MM, not "${month}"`);
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

/** The first and last day of a month given as YYYY-MM. */
export function monthBounds(month: string): { first: string; last: string } {
  const match = MONTH.exec(month);
  if (!match) throw new Error(`A month is YYYY-MM, not "${month}"`);
  const lastDay = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** The month `count - 1` months before `month` (YYYY-MM), so `monthsBack(m, 1)` is `m` itself. */
export function monthsBack(month: string, count: number): string {
  if (!MONTH.test(month)) throw new Error(`A month is YYYY-MM, not "${month}"`);
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 - (count - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from`'s to `to`'s (dates or months), newest first. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = to.slice(0, 7); m >= from.slice(0, 7); m = monthsBack(m, 2)) months.push(m);
  return months;
}

const byDateThenLabel = (a: SpendItem, b: SpendItem) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The confirmed bill occurrences (a repeating bill once per occurrence, at the amount that applies that day, D48) and the
 * confirmed card charges dated from `from` to `to`, both included, oldest first. Statements and pending rows are left out.
 * Whose an item is (D52): a bill is its owner's or Shared; a charge is Shared when marked so, else its card owner's.
 * An amount-varies bill (D54) follows the engine's rule in every month, past or future: a month with one of its real bills
 * counts that real bill (a one-off, once) and no occurrence; a month without one counts the estimate, marked `estimated`, so
 * a series marked "varies" keeps its history. The estimate reads every linked real bill in `bills`, in range or not.
 */
export function spendingItems(input: SpendingInput, from: string, to: string): SpendItem[] {
  const unit = minorPerUnit(input.homeCurrency);
  const minor = (amount: number) => Math.round(amount * unit);
  const memberIds = input.split.members.map(m => m.id);
  const whose = (id: string | undefined) => (id !== undefined && memberIds.includes(id) ? id : null);
  const owners = new Map(input.cards.map(card => [card.id, card.ownerId]));
  const items: SpendItem[] = [];

  const seenSeries = new Set<string>();
  const real = realBillsBySeries(input.bills, unit);
  const unpriced = unpricedBySeries(input.bills);
  for (const bill of input.bills) {
    if (bill.status !== "confirmed") continue;
    const next = nextAmountOf(bill);
    const occurrence = bill.startsOn !== undefined && bill.id.includes("@");
    const id = occurrence ? bill.id.slice(0, bill.id.indexOf("@")) : bill.id;
    const startAmount = bill.startAmount ?? bill.amount;
    const base = (date: string): SpendItem => ({
      kind: "bill", id, label: bill.biller, repeat: bill.repeatUnit ?? null, date, amountMinor: minor(amountOn(startAmount, next, date)), category: bill.category,
      businessBp: bill.businessBp, own: bill.own ?? null, ownerId: whose(bill.ownerId), documentId: bill.documentId ?? null, cardId: null,
      ...(bill.periodStart !== undefined && bill.periodEnd !== undefined && { periodStart: bill.periodStart, periodEnd: bill.periodEnd }),
    });
    const item = (date: string): SpendItem => ({
      ...base(date), ...(bill.amountUnknown && bill.estimated ? { estimated: true as const } : {}), ...(bill.uncounted ? { uncounted: true as const } : {}),
    });
    if (bill.repeatUnit !== undefined) {
      // A repeating bill is one series; the engine's list may hold several occurrences of it, and none before today.
      if (seenSeries.has(id)) continue;
      seenSeries.add(id);
      if (bill.amountVaries) {
        const series = { due: bill.startsOn ?? bill.due, repeatDay: bill.repeatDay ?? null, storedMinor: bill.amountUnknown ? null : minor(startAmount), until: bill.repeatUntil ?? null };
        for (const { date, amountMinor } of variesOccurrences(series, real.get(id) ?? [], from, to, unpriced.get(id))) {
          items.push(amountMinor === null ? { ...base(date), amountMinor: 0, uncounted: true } : { ...base(date), amountMinor, estimated: true });
        }
        continue;
      }
    }
    for (const date of datesIn({ due: bill.startsOn ?? bill.due, repeatUnit: bill.repeatUnit, repeatDay: bill.repeatDay, repeatUntil: bill.repeatUntil }, from, to)) items.push(item(date));
  }
  for (const charge of input.charges) {
    if (charge.status !== "confirmed" || charge.date < from || charge.date > to) continue;
    items.push({
      kind: "charge", id: charge.id, label: charge.merchant, repeat: null, date: charge.date, amountMinor: minor(charge.amount), category: charge.category,
      businessBp: charge.businessBp, own: charge.own ?? null, ownerId: charge.shared ? null : whose(owners.get(charge.cardId)), documentId: charge.documentId ?? null, cardId: charge.cardId,
    });
  }
  return items.sort(byDateThenLabel);
}

type SpendingMonth = {
  month: string; // YYYY-MM
  name: string; // "November"
  totalMinor: number;
  byCategory: { category: CategoryKey; label: string; totalMinor: number }[]; // categories.ts order, only the ones with items
  byOwn: { category: CategoryKey; id: string; name: string; totalMinor: number }[]; // D75: the own categories with items, in categories.ts order then by name
  items: SpendItem[]; // newest first
};
export type SpendingSearch = {
  uncounted: string[]; // D55: the names of the matching bills whose amount is not known (listed, never summed)
  query: string; // as searched: NFKC, lower case, trimmed
  currency: Currency;
  /** The category the query names exactly ("travel", "Phone & internet"), or null. */
  category: CategoryKey | null;
  /** D75: the own category the query names exactly ("coffee"), when exactly one matching item set is filed under that name; else null. */
  own: { id: string; name: string; category: CategoryKey } | null;
  totalMinor: number;
  months: SpendingMonth[]; // every month of the range, newest first, empty ones included
};

/**
 * The items that match a query, grouped by month over the range `from`..`to` (newest month first; a month with nothing is
 * listed at 0). A query matches when each of its words is in the item's name, its category key or its category label, so
 * "hotel" and "travel" both find a hotel and a bare "food" lists the Food category. An item's own category name (D75) is searched too, so
 * "coffee" finds what is filed under Coffee; a query that names one exactly totals it by month as a category name does. An empty query matches everything.
 * Items count up to `to` (today); a bill whose amount is not known is listed up to `uncountedTo` (the month's end) as well, since it is owed and not yet known (D55).
 */
export function searchSpending(items: SpendItem[], query: string, currency: Currency, range: { from: string; to: string; uncountedTo?: string }): SpendingSearch {
  const q = normalise(query);
  const terms = q.split(/\s+/).filter(Boolean);
  const matching = items.filter(item => {
    if (item.date < range.from || item.date > (item.uncounted ? range.uncountedTo ?? range.to : range.to)) return false;
    const haystack = `${normalise(item.label)} ${item.category} ${item.category.replace(/_/g, " ")} ${normalise(categoryLabel(item.category))}${item.own ? ` ${normalise(item.own.name)}` : ""}`;
    return terms.every(term => haystack.includes(term));
  });
  const named = CATEGORIES.find(c => q !== "" && (c.key === q || c.key.replace(/_/g, " ") === q || normalise(c.label) === q));
  const ownNamedById = new Map<string, { id: string; name: string; category: CategoryKey }>();
  if (q !== "") for (const i of matching) if (i.own !== null && normalise(i.own.name) === q) ownNamedById.set(i.own.id, { id: i.own.id, name: i.own.name, category: i.category });
  const ownNamed = [...ownNamedById.values()];
  const months = monthsBetween(range.from, range.to).map((month): SpendingMonth => {
    const inMonth = matching.filter(i => i.date.startsWith(month)).sort((a, b) => byDateThenLabel(b, a));
    const byCategory = CATEGORIES.map(({ key }) => ({ category: key, label: categoryLabel(key), totalMinor: inMonth.filter(i => i.category === key).reduce((sum, i) => sum + i.amountMinor, 0) }))
      .filter(c => inMonth.some(i => i.category === c.category));
    const owns = new Map<string, { category: CategoryKey; id: string; name: string; totalMinor: number }>();
    for (const i of inMonth) if (i.own) owns.set(i.own.id, { category: i.category, id: i.own.id, name: i.own.name, totalMinor: (owns.get(i.own.id)?.totalMinor ?? 0) + i.amountMinor });
    const byOwn = [...owns.values()].sort((a, b) => CATEGORIES.findIndex(c => c.key === a.category) - CATEGORIES.findIndex(c => c.key === b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { month, name: monthName(month), totalMinor: inMonth.reduce((sum, i) => sum + i.amountMinor, 0), byCategory, byOwn, items: inMonth };
  });
  return { query: q, currency, uncounted: matching.filter(i => i.uncounted).map(i => i.label), category: named?.key ?? null, own: named ? null : ownNamed.length === 1 ? ownNamed[0] : null, totalMinor: months.reduce((sum, m) => sum + m.totalMinor, 0), months };
}

/**
 * The one line the assistant quotes: "Travel: ¥48,000 in November (3 items); nothing in the other 11 months. ¥48,000 in all."
 * Only months with items are listed; when none has, every month is named so the line says plainly that nothing matched.
 */
export function searchLine(result: SpendingSearch): string {
  const money = (minor: number) => minorMoney(minor, result.currency);
  const what = result.category !== null ? categoryLabel(result.category) : result.own !== null ? ownLabel(result.own.category, result.own) : result.query === "" ? "Everything" : `"${result.query}"`;
  const latestYear = result.months[0]?.month.slice(0, 4);
  const part = (m: SpendingSearch["months"][number]) => {
    const name = m.month.slice(0, 4) === latestYear ? m.name : `${m.name} ${m.month.slice(0, 4)}`;
    return `${allUncounted(m.items) ? AMOUNT_NOT_KNOWN : money(m.totalMinor)} in ${name}${m.items.length ? ` (${m.items.length} ${m.items.length === 1 ? "item" : "items"})` : ""}`;
  };
  const used = result.months.filter(m => m.items.length);
  const listed = used.length ? used : result.months;
  const empty = used.length ? result.months.length - used.length : 0;
  const uncounted = gapUncountedWords(result.uncounted);
  const total = used.length > 0 && used.every(m => allUncounted(m.items)) ? "" : ` ${money(result.totalMinor)} in all.`;
  return `${what}: ${listed.map(part).join(", ")}${empty ? `; nothing in the other ${empty} ${empty === 1 ? "month" : "months"}` : ""}.${total}${uncounted ? ` ${uncounted}.` : ""}`;
}
