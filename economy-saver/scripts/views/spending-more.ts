// Regular costs by month and the search by month (D54, D77): the fixed_costs and search_months views on Ben's sample, with their forms.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fixedByMonth } from "@/lib/money/fixed";
import { monthTrend } from "@/lib/money/look-by";
import { searchLine, searchSpending, spendingItems, monthBounds, monthsBack } from "@/lib/money/spending";
import { reads } from "../fixtures/view-reads";
import { benMoney } from "@/lib/sample/ben";
import { fact } from "@/lib/money/facts";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";
import { createSyncChecks } from "../fixtures/harness";

const { check, tally } = createSyncChecks();
const ctx = { state: benMoney, spending: benMoney };
const fixed = resolveView("fixed_costs", {}, ctx) as ViewResult<"stacked_columns">;
const search = (text: string, months?: number) => resolveView("search_months", months === undefined ? { text } : { text, months }, ctx) as ViewResult<"stacked_columns">;
const byKey = (r: ViewResult<"stacked_columns">) => Object.fromEntries(r.data!.columns.map(c => [c.key, c.total]));

check("Regular costs + everything else = the month's total in Over time, every month", () => {
  const trend = monthTrend(benMoney, benMoney.today), found = fixedByMonth(benMoney, benMoney.today);
  assert.deepEqual(found.months.map(m => m.month), trend.map(m => m.month));
  for (const [i, m] of found.months.entries()) {
    assert.equal(m.regularMinor + m.otherMinor, trend[i].total, m.month);
    assert.equal(fixed.data!.columns[i].parts[0] + fixed.data!.columns[i].parts[1], trend[i].total);
  }
  assert.ok(found.months.some(m => m.regularMinor > 0) && found.months.some(m => m.otherMinor > 0));
});

check("The regular part is what the regular costs list says: November Rent, Mobaile, CloudBox and the rest", () => {
  const nov = fixedByMonth(benMoney, benMoney.today).months.find(m => m.current)!;
  assert.equal(nov.regularMinor, 82_000 + 4_800 + 1_980 + 8_820 + 1_880 + 0);
  assert.equal(nov.biggest?.label, "Rent");
});

check("Table, line and figures: head, a row per column, integers", () => {
  assert.deepEqual(fixed.table!.head, ["Month", "Regular costs", "Everything else", "Total"]);
  assert.equal(fixed.table!.rows.length, fixed.data!.columns.length);
  assert.match(fixed.line!, /is regular costs \(\d+%\); the biggest is Rent \(¥82,000\)\.$/);
  for (const item of fixed.facts) if (item.unit === "money") assert.ok(Number.isInteger(item.value), item.name);
  assert.equal(resolveView("fixed_costs", { months: 2 }, ctx).data !== null, true);
});

check("No regular costs reads as empty with an Add a bill button", () => {
  const none = resolveView("fixed_costs", {}, { state: benMoney, spending: { ...benMoney, bills: [], charges: [] } });
  assert.equal(none.data, null);
  assert.equal(none.empty?.add, "bill");
  assert.match(none.empty!.words, /once a bill repeats/);
});

check("\"food\" gives ¥10,700 in November, ¥11,440 in October, ¥5,960 in September, ¥28,100 in all", () => {
  const r = search("food");
  assert.deepEqual(byKey(r), { "2026-09": 5_960, "2026-10": 11_440, "2026-11": 10_700 });
  assert.equal(fact(r.facts, "search_total")!.value, 28_100);
  assert.equal(r.data!.columns.length, 3);
  assert.equal(r.data!.columns[2].current, true);
  assert.deepEqual(r.table!.head, ["Month", "Food", "Total"]);
});

check("\"hotel\" gives ¥28,600 in September; \"Coffee\" ¥2,800 in October and ¥1,880 in November (D75)", () => {
  const hotel = search("hotel");
  assert.equal(fact(hotel.facts, "search_total")!.value, 28_600);
  assert.equal(byKey(hotel)["2026-09"], 28_600);
  const coffee = search("Coffee");
  assert.equal(byKey(coffee)["2026-10"], 2_800);
  assert.equal(byKey(coffee)["2026-11"], 1_880);
  assert.equal(fact(coffee.facts, "search_total")!.value, 4_680);
});

check("The line is the search sentence; a bigger window or none changes nothing it says", () => {
  const items = spendingItems(benMoney, `${monthsBack("2026-11", 12)}-01`, monthBounds("2026-11").last);
  const direct = searchSpending(items, "food", "JPY", { from: `${monthsBack("2026-11", 12)}-01`, to: benMoney.today, uncountedTo: monthBounds("2026-11").last });
  const r = search("food");
  assert.equal(r.line, searchLine(direct));
  assert.equal(r.title, "“food” by month");
  assert.equal(search("food", 2).data!.columns.length, 2);
});

check("More than four categories keep three and an Other; a search with no match is empty in words", () => {
  const wide = search("a"), cats = wide.data!.segments;
  assert.ok(cats.length <= 4 || cats[cats.length - 1].key === "other");
  assert.ok(cats.length <= 4);
  const none = search("zzzz");
  assert.equal(none.data, null);
  assert.match(none.empty!.words, /Nothing matches “zzzz”/);
});

check("The arguments are strict: a search takes text, not more; no spending is an error", () => {
  assert.throws(() => resolveView("search_months", {}, ctx), ViewError);
  assert.throws(() => resolveView("search_months", { text: "food", extra: 1 }, ctx), ViewError);
  assert.throws(() => resolveView("fixed_costs", { months: 1 }, ctx), ViewError);
});

check("The form draws a column per month with its aria text", () => {
  for (const r of [fixed, search("food")]) {
    const html = renderToStaticMarkup(createElement(StackedColumns, { result: r }));
    assert.equal((html.match(/class="sc-col/g) ?? []).length, r.data!.columns.length);
    for (const c of r.data!.columns) assert.ok(html.includes(c.aria.replace(/'/g, "&#x27;")) || html.includes(c.aria));
  }
});

check("search_months on \"food\" reads clean", () => {
  reads(search("food"), benMoney.today);
});

check("fixed_costs: the regular share and what changed per cost are facts about the cost", () => {
  const share = fixed.facts!.find(f => f.name === "regular_share")!;
  assert.equal(share.value, fixedByMonth(benMoney, benMoney.today).months.find(m => m.current)!.regularShare);
  const costs = fixed.facts!.filter(f => f.about?.type === "cost" && f.name !== "biggest_regular_cost");
  assert.ok(costs.every(f => ["regular_costs", "change_from_last_month", "regular_cost_started", "regular_cost_stopped", "about_estimate"].includes(f.name)));
});

console.log(`spending-more: ${tally.passed} passed`);
