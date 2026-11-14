// Spending by month (D73, D77): the months side by side, spent so far and still to come. Pure; every amount integer minor units.
import type { Currency } from "@/lib/catalogue/types";
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { monthTrend } from "@/lib/money/look-by";
import { monthBounds } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";

const span = (month: string) => ({ from: monthBounds(month).first, to: monthBounds(month).last });

/** The highest past month and what made it so, as facts (the highest month's total, its largest one-off item named in `about`), and the sentence written from them; null until two past months exist. */
export function highestMonthLine(months: ReturnType<typeof monthTrend>, format: (minor: number) => string, currency: Currency): { line: string; facts: Fact[] } | null {
  const past = months.filter(month => !month.current && month.total > 0), high = [...past].sort((a, b) => b.total - a.total)[0];
  if (!high || past.length < 2) return null;
  const highest = engineFact("highest_month", high.total, { from: "month_trend", currency, period: span(high.month) });
  const biggest = high.biggest ? engineFact("biggest_one_off", high.biggest.amount, { from: "month_trend", currency, period: span(high.month), about: { type: "charge", id: high.biggest.label, name: high.biggest.label } }) : null;
  return {
    line: `${high.name} was the highest month (${format(highest.value as number)})${biggest ? `, mostly because of ${biggest.about!.name} (${format(biggest.value as number)})` : ""}.`,
    facts: biggest ? [highest, biggest] : [highest],
  };
}

export const monthTrendView: Resolver<"month_trend"> = (args, ctx): ViewResult => {
  const { spending } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  const meta = VIEW_META.month_trend, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const months = monthTrend(spending, ctx.state.today, args.months ?? 6);
  const base = { view: "month_trend" as const, args: args as Record<string, unknown>, form: meta.form as "stacked_columns", title: "Spending over time", question: "How has my spending changed over recent months?", hint: "Your recent months at a glance", home: meta.home, currency, source: "Your bills and card charges" };
  if (!months.some(month => month.total > 0)) {
    return { ...base, data: null, table: null, line: null, strip: null, aria: "No months to compare yet.", facts: [],
      empty: { words: "Nothing to compare yet. Months show here once you have bills or card charges.", add: "bill", addLabel: "Add a bill" } };
  }
  const current = months.find(month => month.current)!, high = highestMonthLine(months, format, currency);
  const facts = [...months.map(month => engineFact("month_total", month.total, { from: "month_trend", currency, period: span(month.month) })), ...months.filter(month => month.unknown).map(month => engineFact("not_counted", 1, { from: "month_trend", period: span(month.month), about: { type: "cost", id: `unknown-${month.month}`, name: "Costs with no known amount" } })), ...(high?.facts ?? [])];
  return {
    ...base,
    data: {
      segments: [{ key: "spent", legend: "Spent so far", tone: "main" }, { key: "coming", legend: `Still to come in ${current.name}`, tone: "soft" }],
      columns: months.map(month => ({ key: month.month, label: month.name.slice(0, 3), parts: [month.spent, month.coming], total: month.total, totalLabel: format(month.total), current: month.current,
        aria: `${month.name}: ${format(month.total)}. Spent ${format(month.spent)}${month.current ? `, still to come ${format(month.coming)}` : ""}.` })),
      refs: [],
    },
    table: { caption: "Monthly spending trend", head: ["Month", "Spent", "Still to come", "Total"], foot: null,
      rows: months.map(month => ({ key: month.month, cells: [`${month.name} ${month.month.slice(0, 4)}`, format(month.spent), format(month.coming), format(month.total)] })) },
    empty: null, line: high?.line ?? null, strip: null,
    aria: "Monthly spending. Use Tab to move between months.",
    facts,
  };
};
