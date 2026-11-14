// A search by month (D53, D77): what a word in Spending's search matches, month by month, split by category. Pure; every amount integer minor units.
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { allUncounted, HISTORY_MONTHS, monthBounds, monthName, monthsBack, searchLine, searchSpending, spendingItems, type SpendingSearch } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type FormData, type Resolver, type Tone, type ViewResult } from "../types";

const TONES: Tone[] = ["main", "soft", "quiet"];

/** The columns of a finished search, from the first month with a match through the last month searched; every amount is the one `searchSpending` totalled. `typed` is the text as the person wrote it. */
export function searchMonthsFrom(result: SpendingSearch, typed: string, args: Record<string, unknown>): ViewResult {
  const meta = VIEW_META.search_months, currency = result.currency, format = (minor: number) => minorMoney(minor, currency);
  const oldestFirst = [...result.months].reverse(), firstHit = oldestFirst.findIndex(month => month.items.length > 0);
  const base = { view: "search_months" as const, args, form: meta.form as "stacked_columns", title: `“${typed}” by month`, question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your bills and card charges" };
  if (firstHit < 0) {
    return { ...base, data: null, table: null, line: null, aria: "Nothing matches.", facts: [],
      empty: { words: `Nothing matches “${typed}” in the last ${result.months.length} months.`, add: null, addLabel: null } };
  }
  const months = oldestFirst.slice(firstHit), latest = months[months.length - 1].month;
  // The categories the matches fall in, the biggest three, then Other.
  const byCategory = new Map<CategoryKey, number>();
  for (const month of months) for (const item of month.items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.amountMinor);
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  const top = ranked.slice(0, ranked.length > 4 ? 3 : 4), restKeys = ranked.slice(top.length);
  const segments: FormData["stacked_columns"]["segments"] = [...top.map((key, i) => ({ key, legend: categoryLabel(key), tone: TONES[i] ?? ("ghost" as Tone) })), ...(restKeys.length ? [{ key: "other", legend: "Other", tone: "ghost" as Tone }] : [])];
  const nameOf = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
  const columns = months.map(month => {
    const parts = [...top.map(key => month.byCategory.find(c => c.category === key)?.totalMinor ?? 0), ...(restKeys.length ? [restKeys.reduce((sum, key) => sum + (month.byCategory.find(c => c.category === key)?.totalMinor ?? 0), 0)] : [])];
    const unknown = month.items.length > 0 && month.items.every(item => item.uncounted);
    return { key: month.month, label: month.name.slice(0, 3), parts, total: month.totalMinor, totalLabel: unknown ? AMOUNT_NOT_KNOWN : format(month.totalMinor), current: month.month === latest, ...(unknown ? { unknown: true as const } : {}),
      aria: `${nameOf(month.month)}: ${unknown ? AMOUNT_NOT_KNOWN : format(month.totalMinor)}${month.items.length ? ` in ${month.items.length} ${month.items.length === 1 ? "item" : "items"}` : ""}${segments.length > 1 && parts.some(v => v > 0) ? `. ${segments.filter((_, i) => parts[i] > 0).map(segment => `${segment.legend} ${format(parts[segments.indexOf(segment)])}`).join(", ")}` : ""}.` };
  });
  const head = ["Month", ...segments.map(segment => segment.legend), "Total"];
  // The facts (D79): each month's total and the total of the search; a bill with no known amount is named, never summed. `searchLine` writes the sentence from the same result.
  const facts: Fact[] = months.filter(month => month.items.length > 0 && !allUncounted(month.items)).map(month => engineFact("search_month_total", month.totalMinor, { from: "search_months", currency, period: { from: monthBounds(month.month).first, to: monthBounds(month.month).last } }));
  facts.push(engineFact("search_total", result.totalMinor, { from: "search_months", currency }));
  for (const name of result.uncounted) facts.push(engineFact("not_counted", 1, { from: "search_months", about: { type: "bill", id: name, name } }));
  return {
    ...base,
    facts,
    data: { segments, columns, refs: [] },
    table: { caption: `“${typed}” by month`, head, foot: null,
      rows: columns.map((column, i) => ({ key: column.key, cells: [`${months[i].name} ${column.key.slice(0, 4)}`, ...column.parts.map(part => column.unknown ? AMOUNT_NOT_KNOWN : format(part)), column.totalLabel] })) },
    empty: null, line: searchLine(result), strip: null,
    aria: `“${typed}” by month. Use Tab to move between months.`,
  };
}

export const searchMonthsView: Resolver<"search_months"> = (args, ctx): ViewResult => {
  const { spending } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  const current = ctx.state.today.slice(0, 7), from = `${monthsBack(current, Math.min(args.months ?? HISTORY_MONTHS, HISTORY_MONTHS))}-01`, last = monthBounds(current).last;
  const result = searchSpending(spendingItems(spending, from, last), args.text, spending.homeCurrency, { from, to: ctx.state.today, uncountedTo: last });
  return searchMonthsFrom(result, args.text, { ...args });
};
