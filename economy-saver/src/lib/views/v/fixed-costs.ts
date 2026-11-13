// Regular costs by month (D54, D77): how much of each month is costs that come back, and how much is everything else. Pure; every amount integer minor units.
import { fixedByMonth } from "@/lib/money/fixed";
import { minorMoney } from "@/lib/money/format";
import type { SpendingInput } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";

export const fixedCostsView: Resolver<"fixed_costs"> = (args, ctx): ViewResult => {
  if (!ctx.spending) throw new ViewError("Spending is not loaded for this view.");
  return fixedCostsFor(args, ctx.spending, ctx.state.today);
};

/** The view from the spending and today alone, for a page that has no money state in hand. */
export function fixedCostsFor(args: { months?: number }, spending: SpendingInput, today: string): ViewResult {
  const meta = VIEW_META.fixed_costs, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const found = fixedByMonth(spending, today, args.months ?? 6);
  const base = { view: "fixed_costs" as const, args: { ...args }, form: meta.form as "stacked_columns", title: "Regular costs by month", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your bills and card charges" };
  if (found.regularCount === 0 || !found.months.some(month => month.totalMinor > 0)) {
    return { ...base, data: null, table: null, line: null, aria: "No regular costs yet.", figures: { months: 0 },
      empty: { words: "Regular costs show up once a bill repeats or a name comes back two months running.", add: "bill", addLabel: "Add a bill" } };
  }
  const now = found.months.find(month => month.current)!;
  const share = now.totalMinor > 0 ? Math.round(now.regularMinor * 100 / now.totalMinor) : 0;
  const line = `${now.name}: ${format(now.regularMinor)} of ${format(now.totalMinor)} is regular costs (${share}%)${now.biggest ? `; the biggest is ${now.biggest.label} (${format(now.biggest.amountMinor)})` : ""}.`;
  return {
    ...base,
    data: {
      segments: [{ key: "regular", legend: "Regular costs", tone: "main" }, { key: "other", legend: "Everything else", tone: "soft" }],
      columns: found.months.map(month => ({ key: month.month, label: month.name.slice(0, 3), parts: [month.regularMinor, month.otherMinor], total: month.totalMinor, totalLabel: format(month.totalMinor), current: month.current,
        aria: `${month.name}: ${format(month.totalMinor)}. Regular costs ${format(month.regularMinor)}, everything else ${format(month.otherMinor)}${month.current ? ", so far plus the bills still due this month" : ""}.` })),
      refs: [],
    },
    table: { caption: "Regular costs by month", head: ["Month", "Regular costs", "Everything else", "Total"], foot: null,
      rows: found.months.map(month => ({ key: month.month, cells: [`${month.name} ${month.month.slice(0, 4)}${month.current ? " (so far)" : ""}`, format(month.regularMinor), format(month.otherMinor), format(month.totalMinor)] })) },
    empty: null, line, strip: null,
    aria: "Regular costs by month. Use Tab to move between months.",
    figures: { months: found.months.length, regularCount: found.regularCount, currentRegularMinor: now.regularMinor, currentOtherMinor: now.otherMinor, currentTotalMinor: now.totalMinor, biggestMinor: now.biggest?.amountMinor ?? null },
  };
}
