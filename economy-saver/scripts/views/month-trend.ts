// Spending by month (D73): the month_trend view on Ben's sample and the stacked-columns form.
import assert from "node:assert/strict";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { TERMS } from "@/lib/money/terms";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { minorMoney } from "@/lib/money/format";
import { monthTrend } from "@/lib/money/look-by";
import { benMoney } from "@/lib/sample/ben";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { monthTrendView } from "@/lib/views/v/month-trend";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney, spending: benMoney };
const result = monthTrendView({}, ctx) as ViewResult<"stacked_columns">;
const data = result.data!;

check("Ben's columns hold only months with data, oldest first, the current one last", () => {
  const trend = monthTrend(benMoney, benMoney.today);
  assert.deepEqual(data.columns.map(c => c.key), trend.map(m => m.month));
  assert.equal(data.columns[data.columns.length - 1].current, true);
  assert.equal(data.columns.filter(c => c.current).length, 1);
  assert.ok(data.columns.every(c => c.total > 0 || c.current));
});

check("September 150,380; October 132,060; November 152,230 split into spent and still to come", () => {
  const by = (key: string) => data.columns.find(c => c.key === key)!;
  assert.equal(by("2026-09").total, 150_380);
  assert.equal(by("2026-10").total, 132_060);
  const nov = by("2026-11");
  assert.equal(nov.total, 152_230);
  assert.equal(nov.parts.length, 2);
  assert.equal(nov.parts[0] + nov.parts[1], 152_230);
  assert.ok(nov.parts[1] > 0);
  assert.equal(by("2026-10").parts[1], 0);
});

check("The line is the sentence Over time printed before; the table has Month, Spent, Still to come, Total", () => {
  const past = monthTrend(benMoney, benMoney.today).filter(m => !m.current && m.total > 0), high = [...past].sort((a, b) => b.total - a.total)[0];
  const f = (v: number) => minorMoney(v, "JPY");
  assert.equal(result.line, `${high.name} was the highest month (${f(high.total)})${high.biggest ? `, mostly because of ${high.biggest.label} (${f(high.biggest.amount)})` : ""}.`);
  assert.deepEqual(result.table!.head, ["Month", "Spent", "Still to come", "Total"]);
  assert.equal(result.table!.rows.length, data.columns.length);
  assert.equal(result.title, "Spending over time");
});

check("months narrows the columns; figures are integers and say every amount the line does", () => {
  const two = monthTrendView({ months: 2 }, ctx).data as typeof data;
  assert.ok(two.columns.length <= 2);
  for (const item of result.facts) if (item.unit === "money") assert.ok(Number.isInteger(item.value), item.name);
  assert.deepEqual(unconfirmedNumbers(result.line ?? "", result.facts, { today: benMoney.today }), []);
});

check("No spending at all reads as empty with an Add a bill button", () => {
  const none = monthTrendView({}, { state: benMoney, spending: { ...benMoney, bills: [], charges: [] } });
  assert.equal(none.data, null);
  assert.equal(none.empty?.add, "bill");
});

check("The form draws one labelled group, a column per month, a bold current label and a table-free chart", () => {
  const html = renderToStaticMarkup(createElement(StackedColumns, { result }));
  assert.ok(html.includes(`aria-label="${result.aria}"`));
  assert.equal((html.match(/class="sc-col/g) ?? []).length, data.columns.length);
  assert.equal((html.match(/sc-now/g) ?? []).length, 1);
  for (const c of data.columns) assert.ok(html.includes(c.aria.replace(/'/g, "&#x27;")) || html.includes(c.aria));
  assert.ok(html.includes("Still to come in November"));
});

check("A part below zero draws in the short tone and a reference line is labelled", () => {
  const custom: ViewResult<"stacked_columns"> = { ...result, data: { ...data, refs: [{ label: "Budget", minor: 140_000 }], columns: data.columns.map((c, i) => i === 0 ? { ...c, parts: [c.parts[0], -20_000] } : c) } };
  const html = renderToStaticMarkup(createElement(StackedColumns, { result: custom }));
  assert.ok(html.includes("sc-seg-short"));
  assert.ok(html.includes("Budget"));
});

check("month_trend: every fact is a term and the line has no number a fact does not confirm", () => {
  for (const r of [result]) {
    assert.ok(r.facts && r.facts.length > 0);
    assert.ok(r.facts.every(f => TERMS.some(t => t.name === f.name)));
    assert.deepEqual(unconfirmedNumbers(r.line ?? "", r.facts, { today: benMoney.today }), []);
  }
});

check("month_trend: the highest month and its largest one-off item are facts with their period and name", () => {
  const high = result.facts!.find(f => f.name === "highest_month")!, biggest = result.facts!.find(f => f.name === "biggest_one_off");
  assert.equal(high.value, Math.max(...result.facts.filter(f => f.name === "month_total" && f.period && "to" in f.period && f.period.to < benMoney.today).map(f => Number(f.value))));
  assert.ok(high.period && "from" in high.period);
  assert.equal(biggest?.about?.type, "charge");
  assert.ok(result.line!.includes(biggest!.about!.name));
});

console.log(`month-trend: ${passed} passed`);
