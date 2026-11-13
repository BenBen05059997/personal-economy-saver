// The forecast view and the step line (D77), on Ben's sample.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { HomeViews } from "@/components/home/HomeViews";
import { low, series } from "@/lib/money/runway";
import { benMoney } from "@/lib/sample/ben";
import { forecastView } from "@/lib/views/v/forecast";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const result = forecastView({}, { state: benMoney }) as ViewResult<"step_line">;

check("the low and safe to spend match the engine", () => {
  const worst = low(series(benMoney, "worst"), benMoney.today);
  assert.equal(result.figures.lowLateMinor, -18780);
  assert.equal(result.figures.lowLateDate, "2026-11-27");
  assert.equal(result.figures.lowLateMinor, Math.round(worst.amount));
  assert.equal(result.figures.lowLateDate, worst.date);
  assert.equal(result.figures.safeToSpendMinor, 0);
  assert.equal(result.data!.low.label, "Short ¥18,780 on Fri, Nov 27");
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
  assert.deepEqual(result.table!.head, ["Day", "What happens", "If clients pay late", "If they pay on time"]);
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
  assert.match(html, /If they pay on time/);
  assert.match(html, /Depends on when they pay/);
  assert.match(html, /you are ¥18,780 short on Fri, Nov 27/);
  assert.match(html, /Short ¥18,780 on Fri, Nov 27/);
  assert.match(html, /Safe to spend now/);
});
console.log(`forecast: ${passed} checks passed`);
