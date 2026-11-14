// What you keep (D77): where each payment went, what was kept each month, and how long the cash would last. Pure; every amount integer minor units.
import { bufferMonths, BUFFER_GUIDE, BUFFER_MARKS } from "@/lib/money/buffer";
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { keptByMonth } from "@/lib/money/kept";
import { moneyFlow } from "@/lib/money/flow";
import { lookBy, monthTrend } from "@/lib/money/look-by";
import { monthBounds, monthLabel, monthsBack, HISTORY_MONTHS } from "@/lib/money/spending";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type Tone, type ViewResult } from "../types";

const NO_INCOME = "What you keep shows here once a client has paid you.";
const NO_SPENDING = "Add your bills and card charges to see how long your money lasts.";

const missing = (what: string) => new ViewError(`${what} is not loaded for this view.`);

export const moneyFlowView: Resolver<"money_flow"> = (args, ctx): ViewResult => {
  const { spending, income, potFills, state } = ctx;
  if (!spending) throw missing("Spending");
  if (!income) throw missing("Income");
  if (!potFills) throw missing("Pot fills");
  const meta = VIEW_META.money_flow, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const current = state.today.slice(0, 7), oldest = monthsBack(current, HISTORY_MONTHS);
  if (args.month !== undefined && (args.month > current || args.month < oldest)) throw new ViewError(`Where each payment went covers ${monthLabel(oldest, state.today)} to ${monthLabel(current, state.today)}.`);
  // The last full month, unless only this month has anything to show.
  const last = monthsBack(current, 2);
  const has = (m: string) => income.some(row => row.paidOn.slice(0, 7) === m) || lookBy(spending, state.today, "category", [], m).spent > 0;
  const month = args.month ?? (has(last) || !has(current) ? last : current);
  const base = { view: "money_flow" as const, args: args as Record<string, unknown>, form: meta.form as "sankey", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your clients' payments, what you set aside and your bills and card charges" };
  const none = (words: string, add: "client" | "bill" | null, addLabel: string | null) => ({ ...base, title: "Where each payment went", data: null, table: null, line: null, aria: "Nothing to draw yet.", facts: [] as Fact[], empty: { words, add, addLabel } });
  if (income.length === 0) return none(NO_INCOME, "client", "Add a client");
  const flow = moneyFlow(income, potFills, lookBy(spending, state.today, "category", [], month), month);
  if (!flow) return none(`Nothing came in or went out in ${monthLabel(month, state.today)}.`, null, null);

  const tone = (kind: (typeof flow.nodes)[number]["kind"]): Tone => kind === "left" ? "in" : kind === "pot" ? "soft" : kind === "earlier" || kind === "other" ? "quiet" : "main";
  const nodes = flow.nodes.map(node => ({ id: node.id, label: node.label, column: node.column, minor: node.minor, amountLabel: format(node.minor), tone: tone(node.kind) }));
  const label = new Map(nodes.map(node => [node.id, node.label]));
  const through = flow.nodes.find(node => node.id === "month")!.minor;
  const parts = [`${format(flow.spentMinor)} went on spending`, ...(flow.setAsideMinor > 0 ? [`${format(flow.setAsideMinor)} was set aside`] : []), ...(flow.leftOverMinor > 0 ? [`${format(flow.leftOverMinor)} is left over`] : [])];
  const line = flow.fromEarlierMinor > 0
    ? `In ${flow.name} you spent and set aside ${format(through)}, ${format(flow.fromEarlierMinor)} more than the ${format(flow.inMinor)} that came in, so that much came from earlier money.`
    : `In ${flow.name}, ${format(flow.inMinor)} came in: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`;
  const bounds = monthBounds(flow.month), period = { from: bounds.first, to: bounds.last }, money = (name: "paid_in" | "money_spent" | "money_set_aside" | "left_over_in_month" | "from_earlier_money" | "spent_and_set_aside", minor: number) => engineFact(name, minor, { from: "money_flow", currency, period });
  const facts: Fact[] = [money("paid_in", flow.inMinor), money("money_spent", flow.spentMinor), money("money_set_aside", flow.setAsideMinor), money("spent_and_set_aside", through), money("left_over_in_month", flow.leftOverMinor), money("from_earlier_money", flow.fromEarlierMinor),
    ...flow.unrated.map(name => engineFact("not_counted", 1, { from: "money_flow", about: { type: "client", id: name, name } }))];
  return {
    ...base, title: `Where ${flow.name}'s money went`, data: { nodes, links: flow.links }, empty: null, facts,
    table: { caption: `Where ${flow.name}'s money went`, head: ["From", "To", "Amount"], align: ["start", "end"], foot: ["Money in", "", format(through)],
      rows: flow.links.map(link => ({ key: `${link.from}>${link.to}`, cells: [label.get(link.from)!, label.get(link.to)!, format(link.minor)] })) },
    line: flow.unrated.length ? `${line} ${flow.unrated.join(" and ")} paid in a currency with no rate, so that payment is not counted.` : line,
    aria: `Where ${flow.name}'s money went: ${format(flow.inMinor)} in, ${format(flow.spentMinor)} spent${flow.setAsideMinor ? `, ${format(flow.setAsideMinor)} set aside` : ""}.`,
  };
};

export const savingsRateView: Resolver<"savings_rate"> = (args, ctx): ViewResult => {
  const { spending, income, state } = ctx;
  if (!spending) throw missing("Spending");
  if (!income) throw missing("Income");
  const meta = VIEW_META.savings_rate, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const base = { view: "savings_rate" as const, args: args as Record<string, unknown>, form: meta.form as "stacked_columns", title: "What you kept each month", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "Your clients' payments and your bills and card charges" };
  const none = (words: string, add: "client" | "bill", addLabel: string) => ({ ...base, data: null, table: null, line: null, aria: "No months to compare yet.", facts: [] as Fact[], empty: { words, add, addLabel } });
  if (income.length === 0) return none(NO_INCOME, "client", "Add a client");
  const months = keptByMonth(income, monthTrend(spending, state.today, args.months ?? 6));
  if (months.length === 0) return none("Months show here once a client has paid you and you have bills or card charges in the same month.", "bill", "Add a bill");
  const inMinor = months.reduce((sum, month) => sum + month.incomeMinor, 0), keptMinor = months.reduce((sum, month) => sum + month.keptMinor, 0);
  const unrated = months.reduce((sum, month) => sum + month.unrated, 0);
  const spentMinor = inMinor - keptMinor, span = { from: monthBounds(months[0].month).first, to: monthBounds(months[months.length - 1].month).last };
  const facts: Fact[] = [
    engineFact("paid_in", inMinor, { from: "savings_rate", currency, period: span }), engineFact("money_spent", spentMinor, { from: "savings_rate", currency, period: span }), engineFact("kept", keptMinor, { from: "savings_rate", currency, period: span }),
    ...months.map(month => engineFact("kept", month.keptMinor, { from: "savings_rate", currency, period: { from: monthBounds(month.month).first, to: monthBounds(month.month).last } })),
  ];
  return {
    ...base, empty: null, facts,
    data: {
      segments: [{ key: "spent", legend: "Spent", tone: "main" }, { key: "kept", legend: "Kept", tone: "soft" }],
      columns: months.map(month => ({ key: month.month, label: month.name.slice(0, 3), parts: [month.spentMinor, month.keptMinor], total: month.incomeMinor, totalLabel: format(month.incomeMinor), current: month.current,
        aria: `${month.name}: ${format(month.incomeMinor)} came in, ${format(month.spentMinor)} spent${month.current ? " so far" : ""}, ${month.keptMinor < 0 ? `${format(-month.keptMinor)} more spent than came in` : `${format(month.keptMinor)} kept`}.` })),
      refs: [],
    },
    table: { caption: "Money in, spent and kept by month", head: ["Month", "Money in", "Spent", "Kept"], foot: ["Together", format(inMinor), format(months.reduce((sum, month) => sum + month.spentMinor, 0)), format(keptMinor)],
      rows: months.map(month => ({ key: month.month, cells: [`${month.name} ${month.month.slice(0, 4)}${month.current ? " (so far)" : ""}`, format(month.incomeMinor), format(month.spentMinor), format(month.keptMinor)], ...(month.keptMinor < 0 ? { tone: "short" as const } : {}) })) },
    line: `${keptMinor >= 0 ? `You kept ${format(keptMinor)}` : `You spent ${format(-keptMinor)} more than came in`} over ${months.length} month${months.length === 1 ? "" : "s"}, from ${format(inMinor)} that came in.${unrated ? " A payment with no rate to yen is not counted." : ""}`,
    aria: "Money in each month, split into spent and kept. Use Tab to move between months.",
  };
};

export const bufferMonthsView: Resolver<"buffer_months"> = (args, ctx): ViewResult => {
  const { spending, state } = ctx;
  if (!spending) throw missing("Spending");
  const meta = VIEW_META.buffer_months, currency = spending.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const base = { view: "buffer_months" as const, args: args as Record<string, unknown>, form: meta.form as "runway_bar", title: "How long your money lasts", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "The cash you can spend and your last full months of bills and card charges" };
  const buffer = bufferMonths(state, monthTrend(spending, state.today, 6));
  if (!buffer) return { ...base, data: null, table: null, line: null, aria: "No months of spending yet.", facts: [] as Fact[], empty: { words: NO_SPENDING, add: "bill", addLabel: "Add a bill" } };
  const lasts = `${buffer.months.toFixed(1)} months`;
  const facts: Fact[] = [engineFact("cash_to_spend", buffer.cashMinor, { from: "buffer_months", currency }), engineFact("average_monthly_spending", buffer.monthlyMinor, { from: "buffer_months", currency }), engineFact("buffer_months", buffer.months, { from: "buffer_months" })];
  return {
    ...base, empty: null, facts,
    data: { months: buffer.months, cashLabel: format(buffer.cashMinor), monthlyLabel: format(buffer.monthlyMinor), marks: BUFFER_MARKS.map(months => ({ months, label: `${months} months` })), guide: BUFFER_GUIDE },
    table: { caption: "How long your money lasts", head: ["", "Amount"], foot: ["How long it lasts", lasts],
      rows: [...buffer.basis.map(month => ({ key: month.month, cells: [`Spent in ${month.name}`, format(month.minor)] })),
        { key: "average", cells: [`Average a month (last ${buffer.basis.length})`, format(buffer.monthlyMinor)] }, { key: "cash", cells: ["Cash you can spend", format(buffer.cashMinor)] }] },
    line: buffer.cashMinor <= 0 ? `You have no cash to spend after what is in pots, against ${format(buffer.monthlyMinor)} a month.` : `${format(buffer.cashMinor)} would last about ${lasts} at your usual ${format(buffer.monthlyMinor)} a month.`,
    aria: `${format(buffer.cashMinor)} lasts about ${lasts} at ${format(buffer.monthlyMinor)} a month, drawn against 3 and 6 months.`,
  };
};
