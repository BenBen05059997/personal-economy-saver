// Spending by month (D73, D77): the months side by side, spent so far and still to come. Pure; every amount integer minor units.
import { minorMoney } from "@/lib/money/format";
import { monthTrend } from "@/lib/money/look-by";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";

/** The sentence under the columns: the highest past month and what made it so; null until two past months exist. */
export function highestMonthLine(months: ReturnType<typeof monthTrend>, format: (minor: number) => string): { line: string; highest: number; biggest: number | null } | null {
  const past = months.filter(month => !month.current && month.total > 0), high = [...past].sort((a, b) => b.total - a.total)[0];
  if (!high || past.length < 2) return null;
  return { line: `${high.name} was the highest month (${format(high.total)})${high.biggest ? `, mostly because of ${high.biggest.label} (${format(high.biggest.amount)})` : ""}.`, highest: high.total, biggest: high.biggest?.amount ?? null };
}

export const monthTrendView: Resolver<"month_trend"> = (args, ctx): ViewResult => {
  const { spending } = ctx;
  if (!spending) throw new ViewError("Spending is not loaded for this view.");
  const meta = VIEW_META.month_trend, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const months = monthTrend(spending, ctx.state.today, args.months ?? 6);
  const base = { view: "month_trend" as const, args: args as Record<string, unknown>, form: meta.form as "stacked_columns", title: "Spending over time", question: "How has my spending changed over recent months?", hint: "Your recent months at a glance", home: meta.home, currency, source: "Your bills and card charges" };
  if (!months.some(month => month.total > 0)) {
    return { ...base, data: null, table: null, line: null, strip: null, aria: "No months to compare yet.", figures: { months: 0 },
      empty: { words: "Nothing to compare yet. Months show here once you have bills or card charges.", add: "bill", addLabel: "Add a bill" } };
  }
  const current = months.find(month => month.current)!, high = highestMonthLine(months, format);
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
    figures: { months: months.length, unknownMonths: months.filter(month => month.unknown).length, currentSpentMinor: current.spent, currentComingMinor: current.coming, currentTotalMinor: current.total, highestMinor: high?.highest ?? null, biggestMinor: high?.biggest ?? null },
  };
};
