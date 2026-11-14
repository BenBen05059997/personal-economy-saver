// The forecast view and the step line (D77), on Ben's sample.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { HomeViews } from "@/components/home/HomeViews";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import { fact, type Fact } from "@/lib/money/facts";
import { low, safeToSpend, series } from "@/lib/money/runway";
import { TERMS } from "@/lib/money/terms";
import { benMoney } from "@/lib/sample/ben";
import { forecastView } from "@/lib/views/v/forecast";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
/** The facts as the number check reads them: a one-day period becomes its date. */
const checkable = (facts: readonly Fact[]) => facts.map(item => ({ ...item, period: item.period && "on" in item.period ? item.period.on : item.period }));
const result = forecastView({}, { state: benMoney }) as ViewResult<"step_line">;

check("the low and safe to spend match the engine", () => {
  const worst = low(series(benMoney, "worst"), benMoney.today);
  assert.equal(fact(result.facts, "low_point", "late")!.value, -18780);
  assert.equal(fact(result.facts, "low_point_day", "late")!.value, "2026-11-27");
  assert.equal(fact(result.facts, "low_point", "late")!.value, Math.round(worst.amount));
  assert.equal(fact(result.facts, "low_point_day", "late")!.value, worst.date);
  assert.equal(fact(result.facts, "safe_to_spend")!.value, 0);
  assert.equal(result.data!.low.label, "Short ¥18,780 on Fri, Nov 27");
});

check("mark names a bill: Rent is drawn on Nov 27, no mark leaves Home's forecast alone, and a bill outside the window is refused in words", () => {
  const rentId = benMoney.bills.find(bill => bill.biller === "Rent")!.id.split("@")[0];
  const marked = forecastView({ mark: rentId }, { state: benMoney }) as ViewResult<"step_line">;
  assert.deepEqual(marked.data!.marks, [{ index: 13, label: "Rent ¥82,000 · Nov 27" }]);
  assert.deepEqual(result.data!.marks, []);
  assert.deepEqual({ ...marked.data!, marks: [] }, result.data);
  assert.throws(() => forecastView({ mark: "no-such-bill" }, { state: benMoney }), /not due in the next 30 days/);
});

check("both lines have 30 integer points and the band lies between them", () => {
  const data = result.data!;
  assert.deepEqual(data.lines.map(l => [l.key, l.tone, l.points.length]), [["main", "main", 30], ["quiet", "quiet", 30]]);
  assert.ok(data.lines.every(l => l.points.every(Number.isInteger)));
  assert.deepEqual(data.band, ["quiet", "main"]);
  assert.deepEqual(data.xTicks.map(t => t.label).slice(0, 2), ["Today", "Nov 21"]);
});

check("Nov 27's day words name Rent", () => {
  const day = result.data!.dayWords.find(d => d.date === "2026-11-27")!;
  assert.ok(day.lines.join(" ").includes("Rent"));
  assert.ok(result.table!.rows.some(row => row.key === "2026-11-27"));
  assert.deepEqual(result.table!.head, ["Day", "What happens", "If clients pay late", "If as usual"]);
});

check("one case draws one line and no band", () => {
  const late = forecastView({ case: "late" }, { state: benMoney }) as ViewResult<"step_line">;
  assert.deepEqual(late.data!.lines.map(l => l.key), ["main"]);
  assert.equal(late.data!.band, null);
  assert.equal(late.table!.head.length, 3);
});

check("the Home panel has the legend, the aria summary and the table rows for event days", () => {
  const render = () => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(HomeViews, { state: benMoney, result, bankBalance: null })));
  const html = render();
  assert.match(html, /If clients pay late \(what safe to spend uses\)/);
  assert.match(html, /If as usual/);
  assert.match(html, /Depends on when they pay/);
  assert.match(html, /you are ¥18,780 short on Fri, Nov 27/);
  assert.match(html, /Short ¥18,780 on Fri, Nov 27/);
  assert.match(html, /Safe to spend now/);
});
check("the facts carry the Home sentence's parts and the line is built from them", () => {
  const facts = result.facts!;
  assert.equal(fact(facts, "safe_to_spend")!.value, 0);
  assert.equal(fact(facts, "low_point", "late")!.value, -18780);
  assert.equal(fact(facts, "low_point_day", "late")!.value, "2026-11-27");
  assert.equal(fact(facts, "short", "late")!.value, 18780);
  assert.equal(fact(facts, "days_until_short", "late")!.value, 13);
  assert.ok(fact(facts, "low_point", "as_usual") && fact(facts, "safe_to_spend_as_usual"));
  assert.deepEqual(facts.filter(item => item.name === "late_client").map(item => item.value), safeToSpend(benMoney).lateClients);
  assert.ok(facts.filter(item => item.name === "cost_before_low").some(item => item.about?.name === "Rent" && item.value === 82_000));
  assert.ok(facts.every(item => item.by === "engine" && item.from === "forecast" && (item.unit !== "money" || item.currency === "JPY")));
});

check("every number in the line is a fact and every fact name is a term, on both cases and one", () => {
  assert.equal(result.line, "If clients pay late you are ¥18,780 short on Fri, Nov 27.");
  for (const args of [{}, { case: "late" as const }, { case: "usual" as const }, { days: 7 }]) {
    const view = forecastView(args, { state: benMoney });
    assert.deepEqual(unconfirmedNumbers(view.line!, checkable(view.facts!), { today: benMoney.today }), [], JSON.stringify(args));
    assert.ok(view.facts!.every(item => TERMS.some(term => term.name === item.name)));
  }
});

check("with days, safe to spend is that period's, as safe to spend for a period", () => {
  const week = forecastView({ days: 7 }, { state: benMoney });
  const expected = Math.round(safeToSpend(benMoney, { days: 7 }).amount);
  const f = fact(week.facts!, "safe_to_spend_for_period")!;
  assert.equal(f.value, expected);
  assert.ok(expected > 0, "the 7-day window ends before the Nov 27 low");
  assert.deepEqual(f.period, { from: "2026-11-14", to: "2026-11-20" });
  assert.equal(fact(week.facts!, "safe_to_spend"), null);
});
console.log(`forecast: ${passed} checks passed`);
