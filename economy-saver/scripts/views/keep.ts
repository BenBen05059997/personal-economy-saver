// What you keep (D77): money_flow, savings_rate and buffer_months on Ben's sample and a fixture of income and pot fills. Fictional data only.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact } from "@/lib/money/facts";
import { termOf } from "@/lib/money/terms";
import { bufferMonths, BUFFER_GUIDE } from "@/lib/money/buffer";
import { moneyFlow } from "@/lib/money/flow";
import { minorMoney } from "@/lib/money/format";
import { keptByMonth } from "@/lib/money/kept";
import { lookBy, monthTrend } from "@/lib/money/look-by";
import { availableCash } from "@/lib/money/runway";
import type { Charge, IncomeRow, PotFill } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { RunwayBar } from "@/components/views/forms/RunwayBar";
import { Sankey } from "@/components/views/forms/Sankey";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { bufferMonthsView, moneyFlowView, savingsRateView } from "@/lib/views/v/keep";
import { resolveView } from "@/lib/views/resolve";
import type { ViewContext, ViewResult } from "@/lib/views/types";

let passed = 0;
const reads = (view: ViewResult, today: string) => {
  assert.ok(view.facts && view.facts.length > 0, `${view.view} carries facts`);
  assert.deepEqual(unconfirmedNumbers(view.line ?? "", view.facts, today), [], `${view.view}: every number in the line is one of its facts`);
  for (const item of view.facts) assert.doesNotThrow(() => termOf(item.name), `${item.name} is a term`);
};
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const f = (minor: number) => minorMoney(minor, "JPY");
const row = (id: string, clientId: string | null, clientName: string, paidOn: string, homeMinor: number | null): IncomeRow => ({ id, clientId, clientName, paidOn, sentOn: null, homeMinor });
const income: IncomeRow[] = [
  row("p1", "c-acme", "Acme", "2026-09-10", 90_000), row("p2", "c-northwind", "Northwind", "2026-09-22", 70_000),
  row("p3", "c-acme", "Acme", "2026-10-10", 120_000), row("p4", "c-northwind", "Northwind", "2026-10-20", 80_000), row("p5", "c-beacon", "Beacon Studio", "2026-10-05", null),
  row("p6", "c-acme", "Acme", "2026-11-06", 20_000),
];
const potFills: PotFill[] = [{ potId: "pot-tax", potName: "Tax", date: "2026-10-12", minor: 30_000 }];
// A card charge added in October to prove it is counted once.
const extra: Charge = { id: "ch-x", cardId: "card-a", merchant: "Fixture Shop", amount: 7_777, date: "2026-10-15", category: "food", businessBp: 0, source: "manual", status: "confirmed" };
const ctx: ViewContext = { state: benMoney, spending: benMoney, income, potFills };
const withCharge: ViewContext = { ...ctx, spending: { ...benMoney, charges: [...benMoney.charges, extra] } };

const october = lookBy(benMoney, benMoney.today, "category", [], "2026-10");
const flowView = moneyFlowView({}, ctx) as ViewResult<"sankey">;
const flow = flowView.data!;
const node = (id: string) => flow.nodes.find(n => n.id === id)!;

check("the default month is October; the flow balances at every node", () => {
  assert.deepEqual(fact(flowView.facts, "paid_in")!.period, { from: "2026-10-01", to: "2026-10-31" });
  const links = flow.links;
  for (const n of flow.nodes) {
    const into = links.filter(l => l.to === n.id).reduce((s, l) => s + l.minor, 0), out = links.filter(l => l.from === n.id).reduce((s, l) => s + l.minor, 0);
    if (n.column === 1) { assert.equal(into, n.minor); assert.equal(out, n.minor); }
    else if (n.column === 0) assert.equal(out, n.minor);
    else assert.equal(into, n.minor);
  }
  const inMinor = Number(fact(flowView.facts, "paid_in")!.value), spentMinor = Number(fact(flowView.facts, "money_spent")!.value), setAsideMinor = Number(fact(flowView.facts, "money_set_aside")!.value), leftOverMinor = Number(fact(flowView.facts, "left_over_in_month")!.value);
  assert.equal(inMinor, 200_000);
  assert.equal(spentMinor, october.spent);
  assert.equal(inMinor, spentMinor + setAsideMinor + leftOverMinor);
});

check("a pot fill event is under Set aside; the unrated payment is named and not counted", () => {
  assert.equal(node("p:pot-tax").label, "Set aside: Tax");
  assert.equal(node("p:pot-tax").minor, 30_000);
  assert.equal(fact(flowView.facts, "money_set_aside")!.value, 30_000);
  assert.equal(flow.nodes.filter(n => n.column === 0).reduce((s, n) => s + n.minor, 0), 200_000);
  assert.match(flowView.line!, /Beacon Studio paid in a currency with no rate/);
});

check("the top five categories and Other make up the month's spending", () => {
  const categories = flow.nodes.filter(n => n.column === 2 && n.id !== "left" && !n.id.startsWith("p:"));
  assert.ok(categories.length <= 6);
  assert.equal(categories.reduce((s, n) => s + n.minor, 0), october.spent);
});

check("a card charge appears once", () => {
  const more = moneyFlowView({}, withCharge) as ViewResult<"sankey">;
  assert.equal(fact(more.facts, "money_spent")!.value, october.spent + 7_777);
  assert.equal(more.data!.links.reduce((s, l) => s + (l.to === "month" ? l.minor : 0), 0), 200_000);
});

check("spending higher than money in draws From earlier money; flows still balance", () => {
  const poor = moneyFlow([row("q", "c-acme", "Acme", "2026-10-10", 50_000)], [], october, "2026-10")!;
  assert.equal(poor.fromEarlierMinor, october.spent - 50_000);
  assert.equal(poor.leftOverMinor, 0);
  const earlier = poor.nodes.find(n => n.id === "earlier")!;
  assert.equal(earlier.label, "From earlier money");
  assert.equal(poor.links.filter(l => l.to === "month").reduce((s, l) => s + l.minor, 0), poor.nodes.find(n => n.id === "month")!.minor);
  const view = moneyFlowView({ month: "2026-10" }, { ...ctx, income: [row("q", "c-acme", "Acme", "2026-10-10", 50_000)], potFills: [] });
  assert.match(view.line!, /came from earlier money/);
});

check("the table and the line say every amount (checked words)", () => {
  assert.deepEqual(unconfirmedNumbers(flowView.line ?? "", flowView.facts, benMoney.today), []);
  assert.deepEqual(flowView.table!.head, ["From", "To", "Amount"]);
  assert.equal(flowView.table!.rows.length, flow.links.length);
});

const kept = savingsRateView({}, ctx) as ViewResult<"stacked_columns">;
check("kept is money in minus spending, only from the first month with both records", () => {
  const trend = monthTrend(benMoney, benMoney.today, 6);
  const months = keptByMonth(income, trend);
  assert.equal(months[0].month, "2026-09", "June to August have spending but no income in the fixture");
  const columns = kept.data!.columns;
  assert.deepEqual(columns.map(c => c.key), ["2026-09", "2026-10", "2026-11"]);
  for (const m of months) {
    const t = trend.find(x => x.month === m.month)!;
    assert.equal(m.keptMinor, m.incomeMinor - t.spent);
  }
  const sep = columns[0], oct = columns[1];
  assert.deepEqual(sep.parts, [150_380, 160_000 - 150_380]);
  assert.deepEqual(oct.parts, [132_060, 200_000 - 132_060]);
  assert.equal(oct.total, 200_000);
});

check("a month spent beyond what came in has a part below zero; the line and table agree", () => {
  const nov = kept.data!.columns[2];
  assert.ok(nov.current);
  assert.equal(nov.parts[1], nov.total - nov.parts[0]);
  assert.ok(nov.parts[1] < 0, "November's 20,000 is less than its spending so far");
  const html = renderToStaticMarkup(createElement(StackedColumns, { result: kept }));
  assert.ok(html.includes("sc-seg-short"));
  assert.deepEqual(unconfirmedNumbers(kept.line ?? "", kept.facts, benMoney.today), []);
  assert.deepEqual(kept.table!.head, ["Month", "Money in", "Spent", "Kept"]);
});

const lasts = bufferMonthsView({}, ctx) as ViewResult<"runway_bar">;
check("buffer is cash over the average of the last three full months, to one decimal", () => {
  const trend = monthTrend(benMoney, benMoney.today, 6).filter(m => !m.current && m.total > 0).slice(-3);
  assert.equal(trend.length, 3);
  const average = Math.round(trend.reduce((s, m) => s + m.total, 0) / 3), cash = availableCash(benMoney);
  assert.equal(cash, 128_000);
  const b = bufferMonths(benMoney, monthTrend(benMoney, benMoney.today, 6))!;
  assert.equal(b.monthlyMinor, average);
  assert.equal(b.cashMinor, 128_000);
  assert.equal(b.months, Math.round((128_000 / average) * 10) / 10);
  assert.equal(lasts.data!.months, b.months);
  assert.equal(fact(lasts.facts, "cash_to_spend")!.value, 128_000);
  assert.deepEqual(lasts.table!.rows.map(r => r.cells[1]).slice(-2), [f(average), "¥128,000"]);
  assert.equal(lasts.table!.foot![1], `${b.months.toFixed(1)} months`);
});

check("the bar has marks at 3 and 6 months and the guide line, drawn as information", () => {
  assert.deepEqual(lasts.data!.marks.map(m => m.months), [3, 6]);
  assert.equal(lasts.data!.guide, "The usual guide is 3–6 months; 9–12 for a variable income.");
  assert.equal(lasts.data!.guide, BUFFER_GUIDE);
  const html = renderToStaticMarkup(createElement(RunwayBar, { result: lasts }));
  assert.ok(html.includes("3 months") && html.includes("6 months") && html.includes("The usual guide is 3–6 months; 9–12 for a variable income."));
  assert.doesNotMatch(html, /target|goal|behind|on track/i);
  assert.deepEqual(unconfirmedNumbers(lasts.line ?? "", lasts.facts, benMoney.today), []);
});

check("the sankey draws a node and a flow per row, with labels", () => {
  const html = renderToStaticMarkup(createElement(Sankey, { result: flowView }));
  assert.equal((html.match(/class="sk-node/g) ?? []).length, flow.nodes.length);
  assert.equal((html.match(/class="sk-link/g) ?? []).length, flow.links.length);
  assert.ok(html.includes("Set aside: Tax") && html.includes("Left over") && html.includes("Money in"));
});

check("empty states: no income, no spending history", () => {
  const noIncome = { ...ctx, income: [] };
  for (const view of ["money_flow", "savings_rate"]) {
    const r = resolveView(view, {}, noIncome);
    assert.equal(r.data, null);
    assert.equal(r.empty?.words, "What you keep shows here once a client has paid you.");
  }
  const none = bufferMonthsView({}, { ...ctx, spending: { ...benMoney, bills: [], charges: [] } });
  assert.equal(none.data, null);
  assert.equal(none.empty?.words, "Add your bills and card charges to see how long your money lasts.");
  assert.equal(none.empty?.add, "bill");
});

check("resolveView refuses a month outside the history and an extra key", () => {
  assert.throws(() => resolveView("money_flow", { month: "2030-01" }, ctx), /covers/);
  assert.throws(() => resolveView("buffer_months", { months: 3 }, ctx), /does not take "months"/);
  assert.equal(fact(resolveView("money_flow", { month: "2026-09" }, ctx).facts, "paid_in")!.value, 160_000);
});

check("Ben's sample: money_flow, savings_rate and buffer_months read clean, and every fact is a term", () => {
  const overspent: ViewContext = { ...ctx, spending: { ...benMoney, charges: [...benMoney.charges, { ...extra, id: "ch-big", amount: 900_000, date: "2026-10-16" }] } };
  for (const id of ["money_flow", "savings_rate", "buffer_months"] as const) reads(resolveView(id, {}, ctx) as ViewResult, benMoney.today);
  const october2 = resolveView("money_flow", { month: "2026-10" }, overspent) as ViewResult;
  reads(october2, benMoney.today);
  reads(resolveView("savings_rate", {}, overspent) as ViewResult, benMoney.today);
  assert.equal(lasts.facts!.find(f => f.name === "buffer_months")!.value, lasts.data!.months);
  assert.equal(lasts.facts!.find(f => f.name === "cash_to_spend")!.value, 128_000);
  assert.ok(flowView.facts!.some(f => f.name === "paid_in" && f.period !== null && "from" in f.period));
});

console.log(`keep: ${passed} passed`);
