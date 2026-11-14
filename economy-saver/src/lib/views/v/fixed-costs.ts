// Regular costs by month (D54, D77): how much of each month is costs that come back, and how much is everything else. Pure; every amount integer minor units.
import { fixedByMonth } from "@/lib/money/fixed";
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { regularCosts } from "@/lib/money/regular";
import { monthBounds, monthsBack, spendingItems, type SpendingInput } from "@/lib/money/spending";
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
    return { ...base, data: null, table: null, line: null, aria: "No regular costs yet.", facts: [],
      empty: { words: "Regular costs show up once a bill repeats or a name comes back two months running.", add: "bill", addLabel: "Add a bill" } };
  }
  const now = found.months.find(month => month.current)!;
  // The facts first (D79); the sentence is written from them.
  const period = { from: monthBounds(now.month).first, to: monthBounds(now.month).last };
  const money = (name: "regular_costs" | "month_total" | "biggest_regular_cost", value: number, about?: Fact["about"]) => engineFact(name, value, { from: "fixed_costs", currency, period, ...(about ? { about } : {}) });
  const regularFact = money("regular_costs", now.regularMinor), totalFact = money("month_total", now.totalMinor);
  const shareFact = engineFact("regular_share", now.regularShare, { from: "fixed_costs", period });
  const biggestFact = now.biggest ? money("biggest_regular_cost", now.biggest.amountMinor, { type: "cost", id: now.biggest.label, name: now.biggest.label }) : null;
  const facts: Fact[] = [regularFact, totalFact, shareFact, ...(biggestFact ? [biggestFact] : [])];
  // What changed this month, per cost, from the regular costs' own statuses (largest change first, as `regularCosts` orders them).
  const months = args.months ?? 6, current = today.slice(0, 7);
  const items = spendingItems(spending, monthBounds(monthsBack(current, months)).first, monthBounds(current).last);
  for (const cost of regularCosts(items, currency, today, months).items) {
    const about = { type: "cost" as const, id: cost.key, name: cost.label };
    const add = (name: "change_from_last_month" | "regular_cost_started" | "regular_cost_stopped", value: number) => facts.push(engineFact(name, value, { from: "fixed_costs", currency, period, about }));
    if (cost.status === "up" || cost.status === "down") add("change_from_last_month", cost.changeMinor!);
    else if (cost.status === "started") add("regular_cost_started", cost.thisMinor);
    else if (cost.status === "stopped") add("regular_cost_stopped", cost.lastMinor);
    else continue;
    if (cost.estimated) facts.push(engineFact("about_estimate", 1, { from: "fixed_costs", period, about }));
  }
  const said = (item: Fact) => format(item.value as number);
  const line = `${now.name}: ${said(regularFact)} of ${said(totalFact)} is regular costs (${shareFact.value}%)${biggestFact ? `; the biggest is ${biggestFact.about!.name} (${said(biggestFact)})` : ""}.`;
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
    empty: null, line, strip: null, facts,
    aria: "Regular costs by month. Use Tab to move between months.",
  };
}
