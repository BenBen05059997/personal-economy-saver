// Spending day by day (D73, D77): monthPace and the month_pace view on Ben's sample, and the pace-lines form.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { lookBy, monthTrend } from "@/lib/money/look-by";
import { monthPace } from "@/lib/money/month-pace";
import { benMoney } from "@/lib/sample/ben";
import { PaceLines } from "@/components/views/forms/PaceLines";
import { monthPaceView } from "@/lib/views/v/month-pace";
import type { ViewResult } from "@/lib/views/types";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }
const ctx = { state: benMoney, spending: benMoney };
const pace = monthPace(benMoney, benMoney.today);
const result = monthPaceView({}, ctx) as ViewResult<"pace_lines">;
const data = result.data!;

check("November's running total on the 14th is what the month view calls spent; October's last point is 132,060", () => {
  assert.equal(pace.thisPoints.length, 14);
  assert.equal(pace.todayIndex, 13);
  assert.equal(pace.thisPoints[13], lookBy(benMoney, benMoney.today, "category", []).spent);
  assert.equal(pace.thisSoFarMinor, pace.thisPoints[13]);
  assert.equal(pace.lastPoints.length, 31);
  assert.equal(pace.lastPoints[30], 132_060);
  assert.equal(pace.lastTotalMinor, 132_060);
  assert.equal(pace.days, 31);
});

check("both lines only ever rise, in integer minor units", () => {
  for (const points of [pace.thisPoints, pace.lastPoints]) points.forEach((value, i) => { assert.ok(Number.isInteger(value)); if (i > 0) assert.ok(value >= points[i - 1]); });
  assert.equal(pace.lastSoFarMinor, pace.lastPoints[13]);
});

check("a past month runs to its end and is compared with the month before; the last point is the month trend's total", () => {
  const october = monthPace(benMoney, benMoney.today, "2026-10");
  assert.equal(october.todayIndex, null);
  assert.equal(october.thisPoints.length, 31);
  assert.equal(october.thisPoints[30], monthTrend(benMoney, benMoney.today).find(m => m.month === "2026-10")!.total);
  assert.equal(october.previous, "2026-09");
  assert.equal(october.lastPoints.length, 30);
  const future = monthPace(benMoney, benMoney.today, "2026-12");
  assert.deepEqual(future.thisPoints, []);
});

check("the view: two lines (this month, last month), today marked, a table of days and a line whose amounts are figures", () => {
  assert.deepEqual(data.lines.map(l => [l.key, l.label, l.tone]), [["this", "November", "main"], ["last", "October", "quiet"]]);
  assert.equal(data.todayIndex, 13);
  assert.equal(data.days, 31);
  assert.deepEqual(result.table!.head, ["Day", "November", "October"]);
  assert.equal(result.table!.rows.length, 31);
  assert.equal(result.table!.rows[20].cells[1], "–");
  assert.deepEqual(unconfirmedAmounts(result.line ?? "", [JSON.stringify(result.figures)]), []);
  for (const [key, value] of Object.entries(result.figures)) if (key.endsWith("Minor") && value !== null) assert.ok(Number.isInteger(value), key);
  assert.equal(result.figures.lastTotalMinor, 132_060);
  assert.match(result.line!, /By the 14th you have spent/);
});

check("a past month reads as a finished month in the line", () => {
  const view = monthPaceView({ month: "2026-10" }, ctx);
  assert.match(view.line!, /^October came to /);
  assert.deepEqual(unconfirmedAmounts(view.line ?? "", [JSON.stringify(view.figures)]), []);
});

check("no spending at all reads as empty with an Add a bill button", () => {
  const none = monthPaceView({}, { state: benMoney, spending: { ...benMoney, bills: [], charges: [] } });
  assert.equal(none.data, null);
  assert.equal(none.empty?.add, "bill");
});

check("the form draws one labelled group, a legend of two, the today mark and the direct label", () => {
  const html = renderToStaticMarkup(createElement(PaceLines, { result }));
  assert.ok(html.includes(`aria-label="${result.aria}"`));
  assert.equal((html.match(/class="pl-line/g) ?? []).length, 2);
  assert.ok(html.includes("pl-today") && html.includes("November") && html.includes("October"));
});

console.log(`month-pace: ${passed} passed`);
