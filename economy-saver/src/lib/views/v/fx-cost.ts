// What foreign money cost (D62, D77): by month, what receiving dollars and paying in another currency cost. Ask only. Pure; every amount integer minor units.
import type { Currency } from "@/lib/catalogue/types";
import { aboutMoney, minorMoney, plural } from "@/lib/money/format";
import { fxByMonth } from "@/lib/money/fx-cost";
import { monthLabel } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type ViewResult } from "../types";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const fxCostView: Resolver<"fx_cost"> = (args, ctx): ViewResult => {
  const { foreignCosts: costs, state } = ctx;
  if (!costs) throw new ViewError("Foreign costs are not loaded for this view.");
  const meta = VIEW_META.fx_cost, currency = state.homeCurrency as Currency, format = (minor: number) => minorMoney(minor, currency), about = (minor: number) => aboutMoney(minor, currency);
  const months = fxByMonth(costs, state.today, args.months ?? 6);
  const base = { view: "fx_cost" as const, args: args as Record<string, unknown>, form: meta.form as "stacked_columns", title: "What foreign money cost", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "PayPal's published business rates on your paid dollar invoices, and your card purchases in another currency" };
  const costOf = (m: (typeof months)[number]) => m.payoutMinor + m.chargeExactMinor + m.chargeEstimatedMinor;
  if (months.every(m => costOf(m) === 0 && m.unknownCount === 0)) {
    return { ...base, data: null, table: null, line: null, aria: "No foreign costs to show.", figures: { months: months.length }, empty: { words: "Foreign costs show here once a client has paid you in dollars or you have a card purchase in another currency.", add: "client", addLabel: "Add a client" } };
  }
  const label = (m: (typeof months)[number]) => `${MONTH_NAMES[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`;
  const shown = (minor: number, estimated: boolean) => estimated ? about(minor) : format(minor);
  const guess = (m: (typeof months)[number]) => m.chargeEstimatedMinor > 0;
  const totalMinor = months.reduce((sum, m) => sum + costOf(m), 0), payoutMinor = months.reduce((sum, m) => sum + m.payoutMinor, 0);
  const chargeMinor = months.reduce((sum, m) => sum + m.chargeExactMinor + m.chargeEstimatedMinor, 0), estimated = months.some(guess), unknown = months.reduce((sum, m) => sum + m.unknownCount, 0);
  const high = [...months].sort((a, b) => costOf(b) - costOf(a))[0];
  const first = months[0].month, last = months[months.length - 1].month;
  const line = `Over ${monthLabel(first, state.today)} to ${monthLabel(last, state.today)}, foreign money cost you ${shown(totalMinor, estimated)}: ${format(payoutMinor)} to receive and convert payments${chargeMinor > 0 ? ` and ${shown(chargeMinor, estimated)} on card purchases in another currency` : ""}. ${label(high)} cost the most (${guess(high) ? about(costOf(high)) : format(costOf(high))}).${unknown > 0 ? ` ${plural(unknown, "purchase")} in another currency ${unknown === 1 ? "has" : "have"} no cost yet.` : ""}`;
  return {
    ...base,
    data: {
      segments: [{ key: "payouts", legend: "Receiving and converting payments", tone: "main" }, { key: "charges", legend: "Card purchases in another currency", tone: "soft" }],
      columns: months.map(m => ({
        key: m.month, label: MONTH_NAMES[Number(m.month.slice(5)) - 1].slice(0, 3), parts: [m.payoutMinor, m.chargeExactMinor + m.chargeEstimatedMinor], total: costOf(m), totalLabel: shown(costOf(m), guess(m)), current: m.current,
        aria: `${label(m)}: ${shown(costOf(m), guess(m))}. Receiving payments ${format(m.payoutMinor)}, card purchases ${shown(m.chargeExactMinor + m.chargeEstimatedMinor, guess(m))}.`,
      })),
      refs: [],
    },
    table: {
      caption: "Foreign money cost by month", head: ["Month", "Receiving payments", "Card purchases", "Total"], foot: ["Total", format(payoutMinor), shown(chargeMinor, estimated), shown(totalMinor, estimated)],
      rows: months.map(m => ({ key: m.month, cells: [label(m), format(m.payoutMinor), shown(m.chargeExactMinor + m.chargeEstimatedMinor, guess(m)), shown(costOf(m), guess(m))] })),
    },
    empty: null, line,
    aria: "What foreign money cost, month by month. Use Tab to move between months.",
    figures: { months: months.length, totalMinor, payoutMinor, chargeMinor, highestMinor: costOf(high), unknownCount: unknown },
  };
};
